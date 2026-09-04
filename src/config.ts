/**
 * Application Configuration
 * Centralized configuration management
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { name: string; version: string };

/**
 * Package information (dynamically loaded from package.json)
 */
export const PACKAGE_INFO = {
  name: packageJson.name,
  version: packageJson.version,
} as const;

/**
 * HTTP request configuration
 */
export const HTTP_CONFIG = {
  /** User-Agent header */
  userAgent: `${PACKAGE_INFO.name}/${PACKAGE_INFO.version}`,
  /** Timeout in milliseconds */
  timeout: 30000,
  // リトライは実装していない（`maxRetries` は v0.6.52 まで未使用のまま置かれていた）。
  // 一時的な失敗への備えは `fetchFromMultipleSources` の Promise.any による
  // 並列取得（rfc-editor + datatracker）で代替している。
} as const;

/**
 * Cache configuration
 */
export const CACHE_CONFIG = {
  /** XML raw data cache (smaller since parsed cache is primary) */
  xml: {
    maxSize: 20,
    name: 'XMLCache',
  },
  /** Text raw data cache */
  text: {
    maxSize: 20,
    name: 'TextCache',
  },
  /** Metadata cache (lightweight, so larger) */
  metadata: {
    maxSize: 100,
    name: 'MetadataCache',
  },
  /** Parsed RFC cache (main cache) */
  parsed: {
    maxSize: 50,
    name: 'ParseCache',
  },
} as const;

/**
 * RFC-related configuration
 */
export const RFC_CONFIG = {
  /**
   * Minimum RFC number where RFCXML v3 is reliably available
   * RFC 8650 (December 2019) and later use official RFCXML v3 format
   */
  xmlAvailableFrom: 8650,
} as const;

/**
 * RFC XML source URLs
 * Defined in priority order.
 *
 * NOTE: `xml2rfc.ietf.org` and `datatracker.ietf.org/doc/rfcN/xml/` both
 * effectively redirect to / share the same backing storage as `rfc-editor.org`,
 * so adding them as parallel race candidates does not improve latency in any
 * meaningful way. They are kept here only as a defensive fallback (e.g., when
 * the primary CDN is having transient issues). `tools.ietf.org` was retired in
 * 2021 and is no longer included.
 */
export const RFC_XML_SOURCES = {
  /** RFC Editor official (primary) */
  rfcEditor: (num: number) => `https://www.rfc-editor.org/rfc/rfc${num}.xml`,
  /** Datatracker (redirects to rfc-editor.org) — defensive fallback only */
  datatracker: (num: number) => `https://datatracker.ietf.org/doc/rfc${num}/xml/`,
} as const;

/**
 * RFC text source URLs
 * Defined in priority order.
 *
 * NOTE: `tools.ietf.org/rfc/rfcN.txt` was retired in February 2021 and now only
 * 301-redirects to `rfc-editor.org`. We removed it because including it as a
 * parallel race candidate just sends an extra request to the same backend.
 */
export const RFC_TEXT_SOURCES = {
  /** RFC Editor official (primary) */
  rfcEditor: (num: number) => `https://www.rfc-editor.org/rfc/rfc${num}.txt`,
} as const;

/**
 * IETF Datatracker API
 *
 * Tastypie-based REST API. All endpoints are read-only / unauthenticated.
 * See https://datatracker.ietf.org/api/ for the self-describing index.
 */
export const DATATRACKER_API = {
  /** RFC document core information (title, abstract, std_level, stream, group, time) */
  document: (num: number) => `https://datatracker.ietf.org/api/v1/doc/document/rfc${num}/`,
  /** Authors of an RFC (joined to /api/v1/person/person/...) */
  documentAuthor: (num: number, limit = 50) =>
    `https://datatracker.ietf.org/api/v1/doc/documentauthor/?document__name=rfc${num}&limit=${limit}`,
  /** Recent document events (publication, changes, errata, etc.) */
  docEvent: (num: number, limit = 20) =>
    `https://datatracker.ietf.org/api/v1/doc/docevent/?doc__name=rfc${num}&order_by=-time&limit=${limit}`,
  /** Documents that reference a given RFC (normative/informative, RFC sources only) */
  referencedBy: (num: number, limit = 100) =>
    `https://datatracker.ietf.org/api/v1/doc/relateddocument/?target__name=rfc${num}&relationship__slug__in=refnorm,refinfo&source__type__slug=rfc&limit=${limit}`,
  /** Documents that this RFC references (normative/informative, RFC targets only) */
  references: (num: number, limit = 200) =>
    `https://datatracker.ietf.org/api/v1/doc/relateddocument/?source__name=rfc${num}&relationship__slug__in=refnorm,refinfo&limit=${limit}`,
} as const;

/**
 * Check if RFC is likely available in XML format
 */
export function isRFCXMLLikelyAvailable(rfcNumber: number): boolean {
  return rfcNumber >= RFC_CONFIG.xmlAvailableFrom;
}
