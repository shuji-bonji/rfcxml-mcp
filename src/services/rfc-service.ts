/**
 * RFC Service
 * Centralized RFC fetching and parsing with caching
 */

import { fetchRFCXML, fetchRFCText, RFCXMLNotAvailableError } from './rfc-fetcher.js';
import { parseRFCXML, type ParsedRFC } from './rfcxml-parser.js';
import { parseRFCText } from './rfc-text-parser.js';
import { LRUCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';
import { CACHE_CONFIG } from '../config.js';

/**
 * Parsed RFC with source information
 */
export interface ParsedRFCWithSource {
  data: ParsedRFC;
  source: 'xml' | 'text';
}

/**
 * Source note context types
 */
export type SourceNoteContext =
  | 'structure'
  | 'requirements'
  | 'definitions'
  | 'sections'
  | 'checklist'
  | 'validation'
  | 'dependencies';

/**
 * Get source note for text-based parsing
 */
export function getTextSourceNote(context: SourceNoteContext): string {
  const notes: Record<SourceNoteContext, string> = {
    structure: 'Parsed from text format. Accuracy may be limited.',
    requirements: 'Parsed from text format. Requirement extraction accuracy may be limited.',
    definitions: 'Parsed from text format. Definition extraction accuracy may be limited.',
    sections: 'Parsed from text format. Related section accuracy may be limited.',
    checklist: 'Parsed from text format. Checklist accuracy may be limited.',
    validation: 'Parsed from text format. Validation accuracy may be limited.',
    dependencies: 'Parsed from text format. Reference information is not available.',
  };
  return `Warning: ${notes[context]}`;
}

/**
 * Parsed RFC cache (main cache)
 * Parsing is CPU-intensive, so we cache the results
 */
const parseCache = new LRUCache<number, ParsedRFCWithSource>(CACHE_CONFIG.parsed);

/**
 * Clear parse cache (for testing)
 */
export function clearParseCache(): void {
  parseCache.clear();
}

/**
 * Get parse cache size (for testing/monitoring)
 */
export function getParseCacheSize(): number {
  return parseCache.size;
}

/**
 * Fetch and parse RFC (with cache and fallback support)
 * Tries XML first, falls back to text for older RFCs
 */
export async function getParsedRFC(rfcNumber: number): Promise<ParsedRFCWithSource> {
  const cached = parseCache.get(rfcNumber);
  if (cached) {
    return cached;
  }

  // Try XML first
  try {
    const xml = await fetchRFCXML(rfcNumber);
    const parsed = parseRFCXML(xml);
    const result: ParsedRFCWithSource = { data: parsed, source: 'xml' };
    parseCache.set(rfcNumber, result);
    return result;
  } catch (xmlError) {
    // XML fetch failed -> text fallback
    if (xmlError instanceof RFCXMLNotAvailableError && xmlError.isOldRFC) {
      logger.info(`RFC ${rfcNumber}`, 'XML not available, trying text fallback...');
      try {
        const text = await fetchRFCText(rfcNumber);
        const parsed = parseRFCText(text, rfcNumber);
        const result: ParsedRFCWithSource = { data: parsed, source: 'text' };
        parseCache.set(rfcNumber, result);
        return result;
      } catch (textError) {
        // Text also failed
        throw new Error(
          `Failed to fetch RFC ${rfcNumber}.\n` +
            `XML: ${xmlError.message}\n` +
            `Text: ${textError instanceof Error ? textError.message : String(textError)}`
        );
      }
    }
    // For newer RFCs, propagate the error as-is
    throw xmlError;
  }
}
