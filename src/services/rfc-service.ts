/**
 * RFC Service
 * Centralized RFC fetching and parsing with caching
 */

import { fetchRFCXML, fetchRFCText, RFCXMLNotAvailableError } from './rfc-fetcher.js';
import { parseRFCXML, type ParsedRFC } from './rfcxml-parser.js';
import { parseRFCText } from './rfc-text-parser.js';
import { InFlightMap, LRUCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';
import { CACHE_CONFIG } from '../config.js';

/**
 * Parsed RFC with source information
 */
export interface ParsedRFCWithSource {
  data: ParsedRFC;
  source: 'xml' | 'text';
  /**
   * XML の取得が 404 以外で失敗してテキストに落ちたときの理由（Issue #20）。
   * 404（XML が無い）のときは付けない。付いているときは一時的な失敗の可能性が
   * あり、各ツールの `_sourceNote` にその旨を足す。
   */
  xmlFetchError?: string;
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
 * Get source note only if source is 'text' (helper for conditional inclusion)
 * Returns undefined for 'xml' source (won't appear in JSON output)
 */
export function getSourceNoteIfText(
  source: 'xml' | 'text',
  context: SourceNoteContext,
  xmlFetchError?: string
): string | undefined {
  if (source !== 'xml' && xmlFetchError) {
    return `${getTextSourceNote(context)} ${getXMLFetchFailureNote(xmlFetchError)}`;
  }
  return source === 'text' ? getTextSourceNote(context) : undefined;
}

/**
 * XML が 404 以外で取れずにテキストへ落ちたときの一文（Issue #20）。
 */
export function getXMLFetchFailureNote(xmlFetchError: string): string {
  return `XML fetch failed (${xmlFetchError}); this may be temporary, so the text format was used instead. Retry later for XML-based results.`;
}

/**
 * Parsed RFC cache (main cache)
 * Parsing is CPU-intensive, so we cache the results
 */
const parseCache = new LRUCache<number, ParsedRFCWithSource>(CACHE_CONFIG.parsed);

/**
 * 取得と解析が終わるまでのあいだ、同じ RFC への呼び出しをまとめる（Issue #15）。
 * `parseRFCXML` は CPU を使うので、fetch をまとめるだけでは足りない。
 */
const parseInFlight = new InFlightMap<number, ParsedRFCWithSource>();

/**
 * Clear parse cache (for testing)
 */
export function clearParseCache(): void {
  parseCache.clear();
  parseInFlight.clear();
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

  return parseInFlight.share(rfcNumber, () => fetchAndParse(rfcNumber));
}

async function fetchAndParse(rfcNumber: number): Promise<ParsedRFCWithSource> {
  // Try XML first
  try {
    const xml = await fetchRFCXML(rfcNumber);
    const parsed = parseRFCXML(xml);
    const result: ParsedRFCWithSource = { data: parsed, source: 'xml' };
    parseCache.set(rfcNumber, result);
    return result;
  } catch (xmlError) {
    // XML が取れなかった。テキストに落ちる条件は 2 つ（Issue #20）:
    //   - 8650 より前（XML が無いのが普通）
    //   - 番号を問わず、失敗が 404 以外（5xx・タイムアウト・DNS）
    // 8650 以上で全取得元が 404 なら「未公開」として従来どおり失敗する。
    // v0.6.52 までは `isOldRFC` だけを見ていたので、rfc-editor.org が一時的に
    // 5xx を返すと RFC 9110 でも `.txt` を試さずに失敗していた。
    if (xmlError instanceof RFCXMLNotAvailableError && (xmlError.isOldRFC || !xmlError.notFound)) {
      const transient = !xmlError.notFound;
      logger.info(
        `RFC ${rfcNumber}`,
        transient
          ? 'XML fetch failed (not a 404), trying text fallback...'
          : 'XML not available, trying text fallback...'
      );
      try {
        const text = await fetchRFCText(rfcNumber);
        const parsed = parseRFCText(text, rfcNumber);
        const result: ParsedRFCWithSource = { data: parsed, source: 'text' };
        if (transient) {
          result.xmlFetchError = summarizeFetchError(xmlError.message);
          // 一時的な失敗の結果は残さない。次の呼び出しで XML をもう一度試す。
          return result;
        }
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

/**
 * `RFCXMLNotAvailableError.message` の `Details:` 行（取得元ごとの失敗）だけを取り出す。
 * 無ければ 1 行目を返す。
 */
function summarizeFetchError(message: string): string {
  const details = /Details:\s*(.+)$/s.exec(message);
  const line = (details ? details[1] : message.split('\n')[0]).replace(
    /^All sources failed:\s*/,
    ''
  );
  return line.trim();
}
