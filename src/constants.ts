/**
 * Common Constants
 * BCP 14 / RFC 2119 keywords and patterns
 */

import type { RequirementLevel } from './types/index.js';

// ========================================
// RFC Number Limits
// ========================================

/**
 * RFC number validation limits
 * Current highest RFC is around 9700 (as of 2025)
 */
export const RFC_NUMBER_LIMITS = {
  /** Minimum valid RFC number */
  MIN: 1,
  /** Maximum valid RFC number (reasonable upper bound) */
  MAX: 99999,
} as const;

// ========================================
// BCP 14 / RFC 2119 Keywords
// ========================================

/**
 * BCP 14 / RFC 2119 keywords
 * Ordered by length (longer first to match "MUST NOT" before "MUST")
 */
export const REQUIREMENT_KEYWORDS: RequirementLevel[] = [
  'MUST NOT',
  'MUST',
  'REQUIRED',
  'SHALL NOT',
  'SHALL',
  'SHOULD NOT',
  'SHOULD',
  'RECOMMENDED',
  'NOT RECOMMENDED',
  'MAY',
  'OPTIONAL',
];

/**
 * Create a new requirement regex instance
 * Safe for use in loops with exec() - avoids lastIndex state issues
 *
 * NOTE: RFC 1122 の系譜を引く RFC（RFC 9293 など）は本文に `(MUST-14)` `(MAY-3)`
 * という要求 ID ラベルを埋め込む。`\bMUST\b` はハイフンの直前でも単語境界が
 * 成立するため、ラベルもキーワードとして一致する。これは意図した挙動である。
 * ラベルだけで要求を示す文（RFC 9293 §3.7.1 の MUST-67 など）を取りこぼさないため、
 * ここでは除外しない。同じ文が二重に出る問題は
 * `extractRequirementsFromSections` の重複排除で解決している。
 */
export function createRequirementRegex(): RegExp {
  return new RegExp(`\\b(${REQUIREMENT_KEYWORDS.join('|')})\\b`, 'g');
}

/**
 * Keyword regex (matches longest first)
 * Note: When using with exec() in loops, prefer createRequirementRegex() to avoid lastIndex issues
 */
export const REQUIREMENT_REGEX = createRequirementRegex();

// ========================================
// Section Patterns
// ========================================

/**
 * Section number pattern for parsing RFC text
 * Matches: "1.", "1.1", "1.1.1", etc. followed by title
 * Used in text-based RFC parsing
 */
export const SECTION_HEADER_PATTERN = /^(\d+(?:\.\d+)*\.?)\s+(.+)$/;

/**
 * Create a section header pattern regex instance
 * Safe for use in loops with exec()
 */
export function createSectionHeaderRegex(): RegExp {
  return new RegExp(SECTION_HEADER_PATTERN.source);
}

// ========================================
// Cross-Reference Patterns
// ========================================

/**
 * RFC reference pattern (e.g., "RFC 1234", "RFC1234")
 */
export function createRFCReferenceRegex(): RegExp {
  return /RFC\s*(\d+)/gi;
}

/**
 * Section reference pattern (e.g., "Section 1.2", "section 3.4.5")
 */
export function createSectionReferenceRegex(): RegExp {
  return /[Ss]ection\s+([\d.]+)/g;
}

/**
 * 別文書の節を指す言い回し。
 *
 * RFCXML の `<xref target="HTTP11" section="11.2" sectionFormat="..."/>` は、
 * RFC 本文では次のいずれかの形で印字される。ここに挙げた形は「この RFC の節」
 * ではないので、`get_related_sections` の対象にしてはならない。
 *
 * - `of`     : "Section 11.2 of [HTTP/1.1]"
 * - `comma`  : "[HTTP/1.1], Section 11.2"
 * - `parens` : "[HTTP/1.1] (Section 11.2)"
 *
 * 取り出す組は「節番号」と「文書ラベル」。
 */
export function createExternalSectionRegexes(): Array<{
  pattern: RegExp;
  sectionGroup: number;
  documentGroup: number;
}> {
  return [
    {
      pattern: /[Ss]ections?\s+(\d+(?:\.\d+)*)\s+of\s+\[([^\]]+)\]/g,
      sectionGroup: 1,
      documentGroup: 2,
    },
    // 地の文が文書名を書く形。`sectionFormat="bare"` の xref はこの形になる。
    //   "GET_MAXSIZES in Section 3.4 of RFC 1122."
    //   "as explained in RFC 6691, Section 3.1."
    {
      pattern: /[Ss]ections?\s+(\d+(?:\.\d+)*)\s+of\s+(RFC\s*\d+)/gi,
      sectionGroup: 1,
      documentGroup: 2,
    },
    {
      pattern: /(RFC\s*\d+),?\s+[Ss]ections?\s+(\d+(?:\.\d+)*)(?=[\s,.;)]|$)/gi,
      sectionGroup: 2,
      documentGroup: 1,
    },
    // 読点は無くてもよい。RFC 6749 は "([RFC3986] Section 3.4)" と書く。
    // 読点を必須にしていたため、この形が「この RFC の §3.4」として扱われ、
    // `get_related_sections` が実在しない節を返していた（RFC 6749 に §3.4 は無い）。
    {
      pattern: /\[([^\]]+)\],?\s+[Ss]ections?\s+(\d+(?:\.\d+)*)(?=[\s,.;)]|$)/g,
      sectionGroup: 2,
      documentGroup: 1,
    },
    {
      pattern: /\[([^\]]+)\]\s+\([Ss]ections?\s+(\d+(?:\.\d+)*)\)/g,
      sectionGroup: 2,
      documentGroup: 1,
    },
  ];
}

// RFC-related configuration is centralized in config.ts
// - RFC_CONFIG.xmlAvailableFrom
// - isRFCXMLLikelyAvailable()
