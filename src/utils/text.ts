/**
 * テキスト処理ユーティリティ
 * RFC パーサー共通のテキスト抽出・解析関数
 */

import type { CrossReference } from '../types/index.js';
import { createRFCReferenceRegex, createSectionReferenceRegex } from '../constants.js';

/**
 * 指定位置を含む文を抽出
 * @param text - 対象テキスト
 * @param position - キーワードの位置
 * @returns 文全体
 */
export function extractSentence(text: string, position: number): string {
  // 文の開始を探す
  let start = position;
  while (start > 0 && !/[.!?]\s/.test(text.substring(start - 1, start + 1))) {
    start--;
  }

  // 文の終了を探す
  let end = position;
  while (end < text.length && !/[.!?]/.test(text[end])) {
    end++;
  }

  return text.substring(start, end + 1).trim();
}

/**
 * クロスリファレンスの抽出
 * RFC参照（RFC 1234）とセクション参照（Section 1.2）を検出
 * @param text - 対象テキスト
 * @returns クロスリファレンスの配列
 */
export function extractCrossReferences(text: string): CrossReference[] {
  const refs: CrossReference[] = [];

  // RFC参照パターン
  const rfcPattern = createRFCReferenceRegex();
  let match;
  while ((match = rfcPattern.exec(text)) !== null) {
    refs.push({
      target: `RFC${match[1]}`,
      type: 'rfc',
    });
  }

  // セクション参照パターン
  const sectionPattern = createSectionReferenceRegex();
  while ((match = sectionPattern.exec(text)) !== null) {
    refs.push({
      target: match[1],
      type: 'section',
      section: match[1],
    });
  }

  return refs;
}

/**
 * 配列に正規化
 * @param value - 単一値または配列
 * @returns 配列
 */
export function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
