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
  // 2 語のキーワードは 72 桁の折り返しで改行をまたぐ。RFC 3261 の
  // `"NOT\nRECOMMENDED"` を `RECOMMENDED` 単独で拾うと、引用符の判定が外れる。
  const alternation = REQUIREMENT_KEYWORDS.map((keyword) => keyword.replace(/ /g, '\\s+')).join(
    '|'
  );
  return new RegExp(`\\b(${alternation})\\b`, 'g');
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
  // 最上位の番号は 2 桁まで。RFC 4949 は米国法を
  // `Section 111(d)` `Section 552 (FOIA)` `Title 40 U.S.C. Section 1552` と
  // 引くので、3 桁以上の番号を節として拾っていた（実測: RFC 127 本で 5 件、
  // 3 桁以上の節を持つ RFC は 1 本も無い）。
  // 後ろに数字が続かないことを求める。求めないと `111` の頭 2 桁を採る。
  return /[Ss]ection\s+(\d{1,2}(?:\.\d+)*)(?!\d)/g;
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
    // 番号のあとに句点が入ることがある。RFC 8628 §3.1 は
    // `as described in Section 3.2.1. of [RFC6749].` と書く。句点を認めて
    // いなかったため、RFC 8628 に無い §3.2.1 をこの RFC の節として返していた。
    {
      pattern: /[Ss]ections?\s+(\d+(?:\.\d+)*)\.?\s+of\s+\[([^\]]+)\]/g,
      sectionGroup: 1,
      documentGroup: 2,
    },
    // 地の文が文書名を書く形。`sectionFormat="bare"` の xref はこの形になる。
    //   "GET_MAXSIZES in Section 3.4 of RFC 1122."
    //   "as explained in RFC 6691, Section 3.1."
    {
      pattern: /[Ss]ections?\s+(\d+(?:\.\d+)*)\.?\s+of\s+(RFC\s*\d+)/gi,
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
    //
    // 番号のあとにコロンが来ることがある。RFC 6376 §3.2 は
    // `Quoted-Printable [RFC2045], Section 6.7: any character MAY be encoded`
    // と書く。コロンを認めていなかったため、RFC 2045 の §6.7 が
    // 「この RFC の §6.7」になっていた（RFC 6376 に §6.7 は無い）。
    {
      pattern: /\[([^\]]+)\],?\s+[Ss]ections?\s+(\d+(?:\.\d+)*)(?=[\s,.;:)]|$)/g,
      sectionGroup: 2,
      documentGroup: 1,
    },
    // 前置詞が `in` の形。RFC 5751 §2.5 は
    //   `- Message Digest (section (Section 11.2 in [CMS])`
    // と書く。`of` だけを見ていたため、RFC 5751 に無い §11.2 を返していた。
    {
      pattern: /[Ss]ections?\s+(\d+(?:\.\d+)*)\.?\s+in\s+\[([^\]]+)\]/g,
      sectionGroup: 1,
      documentGroup: 2,
    },
    {
      pattern: /\[([^\]]+)\]\s+\([Ss]ections?\s+(\d+(?:\.\d+)*)\)/g,
      sectionGroup: 2,
      documentGroup: 1,
    },
    // 番号と `of` の間に補足が入り、文書名が角括弧の手前に置かれる形。
    //   "as specified in Section 15.12 ("The JSON Object") of ECMAScript 5.1
    //    [ECMAScript]"（RFC 7519 §4）
    // 番号だけを見ると、この RFC の §15.12 を指していると読める。RFC 7519 に
    // §15.12 は無く、`get_related_sections` が実在しない節を返していた。
    //
    // `of` のあとに置けるのは、版番号を含む語 3 つまでとする。句点で終わる語は
    // 認めない（"of this specification. See [RFC1234]" を拾わないため）。
    {
      pattern:
        /[Ss]ections?\s+(\d+(?:\.\d+)*)\s*(?:\([^)]*\)\s*)?of\s+(?:[A-Za-z0-9][\w/-]*(?:\.\d+)*\s+){0,3}\[([^\]]+)\]/g,
      sectionGroup: 1,
      documentGroup: 2,
    },
  ];
}

// RFC-related configuration is centralized in config.ts
// - RFC_CONFIG.xmlAvailableFrom
// - isRFCXMLLikelyAvailable()
