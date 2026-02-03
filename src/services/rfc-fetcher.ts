/**
 * RFC Fetcher Service
 * RFCXML source fetching and cache management
 */

import type { RFCMetadata } from '../types/index.js';
import { LRUCache } from '../utils/cache.js';
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
 * Fetch RFCXML (parallel fetch)
 * Sends concurrent requests to multiple sources and returns the first successful response
 */
export async function fetchRFCXML(rfcNumber: number): Promise<string> {
  // Check cache
  const cached = xmlCache.get(rfcNumber);
  if (cached) {
    return cached;
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
 * Fetch RFC metadata (IETF Datatracker API)
 */
export async function fetchRFCMetadata(rfcNumber: number): Promise<RFCMetadata> {
  // Check cache
  const cached = metadataCache.get(rfcNumber);
  if (cached) {
    return cached;
  }

  const url = DATATRACKER_API.document(rfcNumber);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HTTP_CONFIG.timeout);

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

    const data = (await response.json()) as {
      title?: string;
      time?: string;
      std_level?: string;
      stream?: string;
      abstract?: string;
    };

    const metadata: RFCMetadata = {
      number: rfcNumber,
      title: data.title || `RFC ${rfcNumber}`,
      authors: [], // TODO: Fetch from separate API
      date: data.time || '',
      category: mapCategory(data.std_level ?? null),
      stream: mapStream(data.stream ?? null),
      abstract: data.abstract || undefined,
    };

    metadataCache.set(rfcNumber, metadata);
    return metadata;
  } catch (_error) {
    // Fallback: minimal metadata
    return {
      number: rfcNumber,
      title: `RFC ${rfcNumber}`,
      authors: [],
      date: '',
      category: 'info',
      stream: 'IETF',
    };
  } finally {
    clearTimeout(timeoutId);
  }
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
 * Clear all caches
 */
export function clearCache(): void {
  xmlCache.clear();
  textCache.clear();
  metadataCache.clear();
}

// Helper functions

function mapCategory(stdLevel: string | null): RFCMetadata['category'] {
  switch (stdLevel?.toLowerCase()) {
    case 'proposed standard':
    case 'draft standard':
    case 'internet standard':
      return 'std';
    case 'best current practice':
      return 'bcp';
    case 'experimental':
      return 'exp';
    case 'historic':
      return 'historic';
    default:
      return 'info';
  }
}

function mapStream(stream: string | null): RFCMetadata['stream'] {
  switch (stream?.toLowerCase()) {
    case 'ietf':
      return 'IETF';
    case 'iab':
      return 'IAB';
    case 'irtf':
      return 'IRTF';
    case 'ise':
      return 'independent';
    default:
      return 'IETF';
  }
}
