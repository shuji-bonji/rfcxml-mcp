/**
 * 共通定数
 * BCP 14 / RFC 2119 キーワードとパターン
 */

import type { RequirementLevel } from './types/index.js';

/**
 * BCP 14 / RFC 2119 キーワード
 * 長いキーワードから順に並べる（"MUST NOT" を "MUST" より先にマッチさせるため）
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
 * キーワードの正規表現（長い順にマッチ）
 */
export const REQUIREMENT_REGEX = new RegExp(`\\b(${REQUIREMENT_KEYWORDS.join('|')})\\b`, 'g');

// RFC 関連の設定は config.ts に集約されています
// - RFC_CONFIG.xmlAvailableFrom
// - isRFCXMLLikelyAvailable()
