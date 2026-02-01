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
  /** Maximum retry attempts */
  maxRetries: 3,
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
 * Defined in priority order
 */
export const RFC_XML_SOURCES = {
  /** RFC Editor official */
  rfcEditor: (num: number) => `https://www.rfc-editor.org/rfc/rfc${num}.xml`,
  /** IETF Tools */
  ietfTools: (num: number) => `https://xml2rfc.ietf.org/public/rfc/rfc${num}.xml`,
  /** Datatracker */
  datatracker: (num: number) => `https://datatracker.ietf.org/doc/rfc${num}/xml/`,
} as const;

/**
 * RFC text source URLs
 * Defined in priority order
 */
export const RFC_TEXT_SOURCES = {
  /** RFC Editor official (text) */
  rfcEditor: (num: number) => `https://www.rfc-editor.org/rfc/rfc${num}.txt`,
  /** IETF Tools */
  ietfTools: (num: number) => `https://tools.ietf.org/rfc/rfc${num}.txt`,
} as const;

/**
 * IETF Datatracker API
 */
export const DATATRACKER_API = {
  /** RFC document information */
  document: (num: number) => `https://datatracker.ietf.org/api/v1/doc/document/rfc${num}/`,
} as const;

/**
 * Check if RFC is likely available in XML format
 */
export function isRFCXMLLikelyAvailable(rfcNumber: number): boolean {
  return rfcNumber >= RFC_CONFIG.xmlAvailableFrom;
}
