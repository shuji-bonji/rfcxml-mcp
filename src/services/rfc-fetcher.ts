/**
 * RFC Fetcher Service
 * RFCXML source fetching and cache management
 */

import type { Author, RFCMetadata, ReferencedByEntry } from '../types/index.js';
import { LRUCache } from '../utils/cache.js';
import { DiskCache } from '../utils/disk-cache.js';
import { fetchFromMultipleSources } from '../utils/fetch.js';
import { logger } from '../utils/logger.js';
import {
  CACHE_CONFIG,
  RFC_XML_SOURCES,
  RFC_TEXT_SOURCES,
  DATATRACKER_API,
  HTTP_CONFIG,
  RFC_CONFIG,
} from '../config.js';

// LRU caches (configuration from config.ts)
const xmlCache = new LRUCache<number, string>(CACHE_CONFIG.xml);
const textCache = new LRUCache<number, string>(CACHE_CONFIG.text);
const metadataCache = new LRUCache<number, RFCMetadata>(CACHE_CONFIG.metadata);

/**
 * Disk-backed XML cache (Phase 3). Lazily initialized so tests / the prefetch
 * CLI can mutate `RFCXML_CACHE_DIR` before any fetch happens. `null` when the
 * env var is unset, in which case all disk-cache code paths are no-ops.
 *
 * Use {@link getDiskCache} to read; call {@link resetDiskCacheForTesting} from
 * tests when changing the env var mid-run.
 */
let diskCacheInstance: DiskCache | null | undefined;
let textDiskCacheInstance: DiskCache | null | undefined;

function getDiskCache(): DiskCache | null {
  if (diskCacheInstance === undefined) {
    diskCacheInstance = DiskCache.fromEnv();
  }
  return diskCacheInstance;
}

/**
 * テキストのディスクキャッシュ。
 *
 * RFCXML が無い RFC（RFC 8650 より前のほとんど）はテキストで読む。v0.6.14 まで
 * テキストはメモリの LRU にしか入らず、MCP サーバを再起動するたびに取り直して
 * いた。RFC 1122 の本文は 200 KB あり、`rfcxml-prefetch` を通しても効かなかった。
 */
function getTextDiskCache(): DiskCache | null {
  if (textDiskCacheInstance === undefined) {
    textDiskCacheInstance = DiskCache.fromEnv('text');
  }
  return textDiskCacheInstance;
}

/**
 * Reset the lazily-initialized disk cache. Tests use this to re-read the
 * `RFCXML_CACHE_DIR` env var after mutating it. Not exposed in the MCP tool
 * surface.
 */
export function resetDiskCacheForTesting(): void {
  diskCacheInstance = undefined;
  textDiskCacheInstance = undefined;
}

// Person info is shared across many RFCs (a single author appears in many RFCs),
// so a dedicated cache pays off — keep it in-process LRU.
const personCache = new LRUCache<number, string>({ maxSize: 500, name: 'PersonCache' });
// Authors / docevents are per-RFC and small, but worth caching to avoid repeat
// hits when the same metadata is requested in multiple tools within one session.
const authorsCache = new LRUCache<number, Author[]>({ maxSize: 100, name: 'AuthorsCache' });

/**
 * Options for {@link fetchRFCXML}.
 */
export interface FetchRFCXMLOptions {
  /**
   * When true, bypass the in-memory LRU cache and the disk cache and force a
   * fresh network fetch. Used by the prefetch CLI to refresh stale entries.
   * The fresh result still gets written to both caches.
   */
  forceFresh?: boolean;
}

/**
 * Fetch RFCXML.
 *
 * Cache hierarchy (Phase 3):
 *   1. in-memory LRU cache (`xmlCache`)
 *   2. on-disk cache (`DiskCache`, opt-in via `RFCXML_CACHE_DIR`)
 *   3. parallel network fetch from `RFC_XML_SOURCES`
 *
 * On a network fetch, the result is written back to both layers so the next
 * call short-circuits at the in-memory layer.
 */
export async function fetchRFCXML(
  rfcNumber: number,
  options: FetchRFCXMLOptions = {}
): Promise<string> {
  if (!options.forceFresh) {
    const cached = xmlCache.get(rfcNumber);
    if (cached) return cached;

    const disk = getDiskCache();
    if (disk) {
      const fromDisk = await disk.get(rfcNumber);
      if (fromDisk) {
        xmlCache.set(rfcNumber, fromDisk);
        logger.info(`RFC ${rfcNumber}`, `Loaded from disk cache (${disk.dir})`);
        return fromDisk;
      }
    }
  }

  // Build source list
  const sources = Object.entries(RFC_XML_SOURCES).map(([name, urlFn]) => ({
    name,
    url: urlFn(rfcNumber),
  }));

  try {
    // Parallel fetch (returns first successful response)
    const { text: xml, source } = await fetchFromMultipleSources(sources, {
      headers: { Accept: 'application/xml, text/xml' },
      validate: (text) => text.includes('<?xml') || text.includes('<rfc'),
    });

    xmlCache.set(rfcNumber, xml);
    const disk = getDiskCache();
    if (disk) {
      // Awaited rather than fire-and-forget: the latency cost is a single
      // local file write (~1ms typical), and awaiting means the next call
      // observes a consistent disk state. Errors are swallowed inside
      // DiskCache.set, so this never throws.
      await disk.set(rfcNumber, xml);
    }
    logger.info(`RFC ${rfcNumber}`, `Fetched from ${source}`);
    return xml;
  } catch (error) {
    // All sources failed
    throw new RFCXMLNotAvailableError(rfcNumber, [
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

/**
 * Options for fetchRFCMetadata.
 *
 * `includeAuthors` adds an extra parallel fetch to the documentauthor API and
 * resolves person fullnames. Defaults to false to keep the base call cheap.
 */
export interface FetchRFCMetadataOptions {
  includeAuthors?: boolean;
}

/**
 * Fetch RFC metadata (IETF Datatracker API).
 *
 * The base call hits a single endpoint (`/api/v1/doc/document/rfcN/`) and
 * returns the core fields. Pass `includeAuthors: true` to also resolve the
 * author list in parallel; it costs `1 + N` extra requests (1 for the
 * documentauthor list, N for each person), but those are cached aggressively.
 */
export async function fetchRFCMetadata(
  rfcNumber: number,
  options: FetchRFCMetadataOptions = {}
): Promise<RFCMetadata> {
  // Check cache: only reuse when the cached entry has at least the requested
  // depth (i.e., if authors are requested, only return cached if they are
  // already populated).
  const cached = metadataCache.get(rfcNumber);
  if (cached && (!options.includeAuthors || cached.authors.length > 0)) {
    return cached;
  }

  const [coreResult, authorsResult] = await Promise.allSettled([
    fetchDocumentCore(rfcNumber),
    options.includeAuthors ? fetchAuthors(rfcNumber) : Promise.resolve([] as Author[]),
  ]);

  // Core fetch failed -> fallback to minimal metadata (preserve previous behavior)
  if (coreResult.status === 'rejected') {
    logger.warn(
      `RFC ${rfcNumber}`,
      `Metadata fetch failed: ${
        coreResult.reason instanceof Error ? coreResult.reason.message : String(coreResult.reason)
      }`
    );
    return {
      number: rfcNumber,
      title: `RFC ${rfcNumber}`,
      authors: authorsResult.status === 'fulfilled' ? authorsResult.value : [],
      datatrackerUpdated: '',
      category: 'info',
      stream: 'IETF',
    };
  }

  const core = coreResult.value;
  const authors = authorsResult.status === 'fulfilled' ? authorsResult.value : [];

  const metadata: RFCMetadata = {
    number: rfcNumber,
    title: core.title || `RFC ${rfcNumber}`,
    authors,
    datatrackerUpdated: core.time || '',
    category: mapCategory(core.std_level ?? null),
    stream: mapStream(core.stream ?? null),
    abstract: core.abstract || undefined,
  };

  metadataCache.set(rfcNumber, metadata);
  return metadata;
}

/**
 * Datatracker `/api/v1/doc/document/rfcN/` response shape (subset we consume).
 */
interface DataTrackerDocument {
  title?: string;
  time?: string;
  std_level?: string;
  stream?: string;
  abstract?: string;
  group?: string;
  rfc_number?: number;
}

/**
 * Fetch the core document record. Internal helper for fetchRFCMetadata.
 */
async function fetchDocumentCore(rfcNumber: number): Promise<DataTrackerDocument> {
  const data = await fetchJson<DataTrackerDocument>(DATATRACKER_API.document(rfcNumber));
  return data;
}

/**
 * Fetch RFC text (parallel fetch)
 * Sends concurrent requests to multiple sources and returns the first successful response
 */
export async function fetchRFCText(rfcNumber: number): Promise<string> {
  // Check cache
  const cached = textCache.get(rfcNumber);
  if (cached) {
    return cached;
  }

  const disk = getTextDiskCache();
  if (disk) {
    const fromDisk = await disk.get(rfcNumber);
    if (fromDisk) {
      textCache.set(rfcNumber, fromDisk);
      logger.info(`RFC ${rfcNumber}`, `Text loaded from disk cache (${disk.dir})`);
      return fromDisk;
    }
  }

  // Build source list
  const sources = Object.entries(RFC_TEXT_SOURCES).map(([name, urlFn]) => ({
    name,
    url: urlFn(rfcNumber),
  }));

  try {
    // Parallel fetch (returns first successful response)
    const { text, source } = await fetchFromMultipleSources(sources, {
      headers: { Accept: 'text/plain' },
      validate: (t) => t.includes('Request for Comments') || t.includes('RFC '),
    });

    textCache.set(rfcNumber, text);
    if (disk) await disk.set(rfcNumber, text);
    logger.info(`RFC ${rfcNumber}`, `Text fetched from ${source}`);
    return text;
  } catch (error) {
    // All sources failed
    throw new Error(
      `Failed to fetch RFC ${rfcNumber} text from all sources. ` +
        `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generic JSON fetch helper (Datatracker API and similar).
 *
 * Centralized so the User-Agent / timeout / Accept headers are uniform.
 * Throws on non-2xx response or timeout. Caller decides on fallback.
 */
async function fetchJson<T>(url: string, timeoutMs = HTTP_CONFIG.timeout): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': HTTP_CONFIG.userAgent,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Datatracker `/api/v1/doc/relateddocument/` response shape (subset).
 */
interface DataTrackerRelatedDocResponse {
  meta: { total_count: number; next: string | null };
  objects: Array<{
    source: string; // e.g. "/api/v1/doc/document/rfc9511/"
    target: string; // e.g. "/api/v1/doc/document/rfc9000/"
    relationship: string; // e.g. "/api/v1/name/docrelationshipname/refnorm/"
  }>;
}

/**
 * Datatracker `/api/v1/doc/documentauthor/` response shape (subset).
 */
interface DataTrackerAuthorResponse {
  meta: { total_count: number };
  objects: Array<{
    affiliation: string;
    email: string; // URI like "/api/v1/person/email/foo@bar.com/"
    person: string; // URI like "/api/v1/person/person/16400/"
    order: number;
  }>;
}

/**
 * Datatracker `/api/v1/person/person/N/` response shape (subset).
 */
interface DataTrackerPerson {
  id: number;
  name: string;
  ascii: string;
}

/**
 * Datatracker `/api/v1/doc/docevent/` response shape (subset).
 */
interface DataTrackerDocEventResponse {
  meta: { total_count: number };
  objects: Array<{
    type: string;
    desc: string;
    time: string;
    rev: string | null;
  }>;
}

/**
 * Doc event entry exposed to handlers.
 */
export interface DocEventEntry {
  type: string;
  desc: string;
  time: string;
  rev: string | null;
}

/**
 * Resolve a person URI to a fullname via Datatracker API.
 * Cached per process to avoid redundant lookups across RFCs.
 */
async function fetchPersonName(personUri: string): Promise<string | null> {
  const idMatch = personUri.match(/\/person\/(\d+)\/?$/);
  if (!idMatch) return null;
  const id = parseInt(idMatch[1], 10);

  const cached = personCache.get(id);
  if (cached) return cached;

  try {
    const data = await fetchJson<DataTrackerPerson>(`https://datatracker.ietf.org${personUri}`);
    const name = data.ascii || data.name;
    if (name) personCache.set(id, name);
    return name || null;
  } catch (error) {
    logger.warn(
      `Person ${id}`,
      `name fetch failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * Fetch authors of an RFC via Datatracker `documentauthor` API.
 * Resolves each author's fullname in parallel against the person endpoint.
 * Returns an empty array on failure (graceful degradation).
 */
export async function fetchAuthors(rfcNumber: number): Promise<Author[]> {
  const cached = authorsCache.get(rfcNumber);
  if (cached) return cached;

  try {
    const data = await fetchJson<DataTrackerAuthorResponse>(
      DATATRACKER_API.documentAuthor(rfcNumber)
    );

    // Sort by order so the returned list matches the document's author order.
    const objects = [...data.objects].sort((a, b) => a.order - b.order);

    const authors: Author[] = await Promise.all(
      objects.map(async (a) => {
        const fullname = (await fetchPersonName(a.person)) ?? 'Unknown';
        const emailMatch = a.email.match(/\/email\/([^/]+)\/?$/);
        const email = emailMatch ? decodeURIComponent(emailMatch[1]) : undefined;
        return {
          fullname,
          email,
          organization: a.affiliation || undefined,
        };
      })
    );

    authorsCache.set(rfcNumber, authors);
    logger.info(`RFC ${rfcNumber}`, `Resolved ${authors.length} authors`);
    return authors;
  } catch (error) {
    logger.warn(
      `RFC ${rfcNumber}`,
      `authors fetch failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

/**
 * Fetch recent document events (publication, sync, errata-tagging, etc.).
 *
 * Note: Datatracker's tastypie API does not allow ordering by `time` directly,
 * so we rely on the natural id-descending order returned by the endpoint
 * (events are inserted monotonically) and limit on the server side.
 * Returns an empty array on failure.
 */
export async function fetchDocEvents(rfcNumber: number, limit = 20): Promise<DocEventEntry[]> {
  try {
    const data = await fetchJson<DataTrackerDocEventResponse>(
      DATATRACKER_API.docEvent(rfcNumber, limit)
    );
    return data.objects.map((o) => ({
      type: o.type,
      desc: o.desc,
      time: o.time,
      rev: o.rev,
    }));
  } catch (error) {
    logger.warn(
      `RFC ${rfcNumber}`,
      `docEvent fetch failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

/**
 * Extract a slug from a Datatracker name URI.
 *   "/api/v1/name/docrelationshipname/refnorm/" -> "refnorm"
 * Returns null when the URI does not look like a Datatracker name URI.
 */
function extractTrailingSlug(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const m = uri.match(/\/([^/]+)\/?$/);
  return m ? m[1] : null;
}

/**
 * Extract the RFC name (e.g., "rfc9110") from a Datatracker document URI.
 *   "/api/v1/doc/document/rfc9110/" -> "rfc9110"
 */
function extractDocName(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const m = uri.match(/\/document\/([^/]+)\/?$/);
  return m ? m[1] : null;
}

/**
 * Fetch RFCs that reference this RFC (via IETF Datatracker API).
 * Returns only published RFCs (not drafts) with normative/informative relationships.
 */
export async function fetchReferencedBy(rfcNumber: number): Promise<ReferencedByEntry[]> {
  try {
    const data = await fetchJson<DataTrackerRelatedDocResponse>(
      DATATRACKER_API.referencedBy(rfcNumber)
    );

    const entries: ReferencedByEntry[] = [];
    for (const obj of data.objects) {
      const sourceName = extractDocName(obj.source);
      if (!sourceName) continue;
      const rfcMatch = sourceName.match(/^rfc(\d+)$/);
      if (!rfcMatch) continue;

      const relSlug = extractTrailingSlug(obj.relationship);
      if (relSlug !== 'refnorm' && relSlug !== 'refinfo') continue;

      entries.push({
        rfcNumber: parseInt(rfcMatch[1], 10),
        name: sourceName.toUpperCase(),
        relationship: relSlug,
      });
    }

    entries.sort((a, b) => a.rfcNumber - b.rfcNumber);
    logger.info(`RFC ${rfcNumber}`, `Found ${entries.length} RFCs that reference this RFC`);
    return entries;
  } catch (error) {
    logger.warn(
      `RFC ${rfcNumber}`,
      `referencedBy fetch failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

/**
 * A reference entry as returned by `fetchReferences` — i.e., RFCs that the
 * given RFC points to via normative or informative reference.
 *
 * Distinct from `RFCReference` (which is parsed out of the XML/text body and
 * carries anchor/title information). This API-based variant only carries the
 * RFC number and relationship slug, but works even when the XML is unavailable
 * (RFCs published before 8650 / RFCXML v3).
 */
export interface ReferenceEntry {
  rfcNumber: number;
  name: string; // e.g., "RFC9000"
  relationship: 'refnorm' | 'refinfo';
}

/**
 * Fetch RFCs that this RFC references (normative + informative) via the
 * Datatracker `relateddocument` API.
 *
 * Why this exists: `getParsedRFC` extracts references from XML/text body, but
 * for old RFCs (< 8650) we lose the references entirely when XML is not
 * available. Hitting the Datatracker API gives us a structured fallback that
 * is independent of the body format.
 *
 * The API target field can point to BCP/STD aliases (`bcp35`, `std97`) as well
 * as actual RFCs (`rfc9000`). Aliases are filtered out here — only real RFC
 * targets are returned. Callers wanting alias resolution can call the
 * documentauthor / docalias endpoints separately.
 */
export async function fetchReferences(rfcNumber: number): Promise<ReferenceEntry[]> {
  try {
    const data = await fetchJson<DataTrackerRelatedDocResponse>(
      DATATRACKER_API.references(rfcNumber)
    );

    const entries: ReferenceEntry[] = [];
    for (const obj of data.objects) {
      const targetName = extractDocName(obj.target);
      if (!targetName) continue;
      const rfcMatch = targetName.match(/^rfc(\d+)$/);
      if (!rfcMatch) continue;

      const relSlug = extractTrailingSlug(obj.relationship);
      if (relSlug !== 'refnorm' && relSlug !== 'refinfo') continue;

      entries.push({
        rfcNumber: parseInt(rfcMatch[1], 10),
        name: targetName.toUpperCase(),
        relationship: relSlug,
      });
    }

    entries.sort((a, b) => a.rfcNumber - b.rfcNumber);
    logger.info(`RFC ${rfcNumber}`, `Found ${entries.length} RFC references via API`);
    return entries;
  } catch (error) {
    logger.warn(
      `RFC ${rfcNumber}`,
      `references fetch failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

/**
 * Check if RFC is available in XML format
 * Note: RFC 8650 (December 2019) and later use official RFCXML v3
 */
export function isRFCXMLAvailable(rfcNumber: number): boolean {
  return rfcNumber >= RFC_CONFIG.xmlAvailableFrom;
}

/**
 * RFC XML fetch error
 */
export class RFCXMLNotAvailableError extends Error {
  public readonly rfcNumber: number;
  public readonly isOldRFC: boolean;
  public readonly suggestion: string;

  constructor(rfcNumber: number, originalErrors: string[] = []) {
    const threshold = RFC_CONFIG.xmlAvailableFrom;
    const isOldRFC = rfcNumber < threshold;
    const suggestion = isOldRFC
      ? `RFC ${rfcNumber} was published before RFCXML v3 format, XML may not be available. ` +
        `Consider using text format (use ietf MCP get_ietf_doc).`
      : `Failed to fetch RFC ${rfcNumber} XML. Check network connection.`;

    super(
      `Could not fetch RFC ${rfcNumber} XML.\n` +
        `Reason: ${isOldRFC ? `Old RFC (< ${threshold}), XML may not be available` : 'Network error'}\n` +
        `Suggestion: ${suggestion}` +
        (originalErrors.length > 0 ? `\nDetails: ${originalErrors.join(', ')}` : '')
    );

    this.name = 'RFCXMLNotAvailableError';
    this.rfcNumber = rfcNumber;
    this.isOldRFC = isOldRFC;
    this.suggestion = suggestion;
  }
}

/**
 * Clear all caches.
 * Includes the secondary caches added for Phase 1 API enrichment.
 */
export function clearCache(): void {
  xmlCache.clear();
  textCache.clear();
  metadataCache.clear();
  authorsCache.clear();
  personCache.clear();
}

// Helper functions

/**
 * Map a Datatracker `std_level` value to the RFCMetadata category.
 *
 * Accepts both the legacy human-readable form (`"Proposed Standard"`) and the
 * tastypie URI form (`"/api/v1/name/stdlevelname/ps/"`) — the latter is what
 * the API actually returns today, so the original string-comparison logic was
 * silently falling through to `'info'` for every RFC. We extract the trailing
 * slug when given a URI and normalize.
 */
function mapCategory(stdLevel: string | null | undefined): RFCMetadata['category'] {
  const slug = (extractTrailingSlug(stdLevel) ?? stdLevel ?? '').toLowerCase();
  switch (slug) {
    case 'std': // Internet Standard
    case 'ps': // Proposed Standard
    case 'ds': // Draft Standard (legacy)
    case 'proposed standard':
    case 'draft standard':
    case 'internet standard':
      return 'std';
    case 'bcp':
    case 'best current practice':
      return 'bcp';
    case 'exp':
    case 'experimental':
      return 'exp';
    case 'hist':
    case 'historic':
      return 'historic';
    default:
      return 'info';
  }
}

/**
 * Map a Datatracker `stream` value to the RFCMetadata stream.
 * See {@link mapCategory} for why URI-form normalization is required.
 */
function mapStream(stream: string | null | undefined): RFCMetadata['stream'] {
  const slug = (extractTrailingSlug(stream) ?? stream ?? '').toLowerCase();
  switch (slug) {
    case 'ietf':
      return 'IETF';
    case 'iab':
      return 'IAB';
    case 'irtf':
      return 'IRTF';
    case 'ise':
    case 'independent':
      return 'independent';
    case 'editorial':
      return 'editorial';
    default:
      return 'IETF';
  }
}
