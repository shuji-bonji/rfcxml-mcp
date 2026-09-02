/**
 * テキスト処理ユーティリティ
 * RFC パーサー共通のテキスト抽出・解析関数
 */

import type { CrossReference } from '../types/index.js';
import {
  createExternalSectionRegexes,
  createRFCReferenceRegex,
  createSectionReferenceRegex,
} from '../constants.js';

/**
 * 文末とみなさない略語。ピリオドの直前をここと照合する。
 */
const ABBREVIATIONS = ['e.g.', 'i.e.', 'etc.', 'cf.', 'vs.', 'fig.', 'no.', 'al.'];

/**
 * その位置が文の終わりかどうか。
 *
 * ピリオドを無条件に文末とみなすと、節番号や略語で文が切れる。
 * RFC 本文には "(see Section 5.3 for further details)." や "(e.g., ...)" が
 * 頻出するため、要件文が "…(see Section 5." のように途中で切れていた。
 *
 * 文末の条件は 2 つ。
 * 1. 句読点のあとに空白が来るか、文字列が終わること（"5.3" の "." は次が数字なので違う）
 * 2. 直前が略語でないこと（"e.g. the client" のような書き方への備え）
 */
export function isSentenceEnd(text: string, index: number): boolean {
  const char = text[index];
  if (char !== '.' && char !== '!' && char !== '?') return false;

  const next = text[index + 1];
  if (next !== undefined && !/\s/.test(next)) return false;

  if (char !== '.') return true;

  const tail = text.slice(Math.max(0, index - 4), index + 1).toLowerCase();
  return !ABBREVIATIONS.some((abbreviation) => tail.endsWith(abbreviation));
}

/**
 * 指定位置を含む文を抽出
 * @param text - 対象テキスト
 * @param position - キーワードの位置
 * @returns 文全体
 */
export function extractSentence(text: string, position: number): string {
  // 文の開始を探す
  let start = position;
  while (start > 0 && !isSentenceEnd(text, start - 1)) {
    start--;
  }

  // 文の終了を探す
  let end = position;
  while (end < text.length && !isSentenceEnd(text, end)) {
    end++;
  }

  return text.substring(start, end + 1).trim();
}

/**
 * 節（clause）の終わりまでを切り出す。
 *
 * 条件節や要求アクションの取り出しに使う。従来は `[^,.]+` で「最初のカンマか
 * ピリオドまで」としていたため、"this fails (e.g., the server's certificate …"
 * が "this fails (e" になっていた。
 *
 * - 括弧の中のカンマでは切らない（"(e.g., ...)" を割らない）
 * - ピリオドは {@link isSentenceEnd} が文末と認めたときだけ切る
 */
export function clipAtClauseEnd(text: string): string {
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) return text.slice(0, i).trim();
    else if (isSentenceEnd(text, i)) return text.slice(0, i).trim();
  }

  return text.trim();
}

/**
 * クロスリファレンスの抽出
 *
 * 3 種類を区別する。
 *
 * - `rfc`      : "RFC 1234"
 * - `external` : "Section 11.2 of [HTTP/1.1]" — **別文書**の節
 * - `section`  : "Section 1.2" — この RFC の節
 *
 * 別文書の節を先に取り除いてから節参照を探すことが要点である。混ぜると
 * "Section 11.2 of [HTTP/1.1]" の 11.2 をこの RFC の §11.2 と取り違え、
 * 無関係な節の題名を確信ありげに返してしまう。
 *
 * @param text - 対象テキスト
 * @returns クロスリファレンスの配列
 */
export function extractCrossReferences(text: string): CrossReference[] {
  const refs: CrossReference[] = [];
  const seen = new Set<string>();

  const add = (ref: CrossReference): void => {
    const key = `${ref.type}\u0000${ref.target}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  // RFC参照パターン
  const rfcPattern = createRFCReferenceRegex();
  let match;
  while ((match = rfcPattern.exec(text)) !== null) {
    add({ target: `RFC${match[1]}`, type: 'rfc' });
  }

  // 別文書の節。取り出したうえで、節参照の走査対象から外す。
  let localText = text;
  for (const { pattern, sectionGroup, documentGroup } of createExternalSectionRegexes()) {
    localText = localText.replace(pattern, (matched, ...groups: string[]) => {
      const section = groups[sectionGroup - 1];
      const document = groups[documentGroup - 1];
      add({
        target: document,
        type: 'external',
        section,
        displayText: matched,
      });
      // 数字を残すと、後段の節参照の走査が拾ってしまう
      return ' [external] ';
    });
  }

  // 残った節参照はこの RFC の節
  const sectionPattern = createSectionReferenceRegex();
  while ((match = sectionPattern.exec(localText)) !== null) {
    // 文末の句点を巻き込むことがある（"see Section 6.1." → "6.1."）
    const section = match[1].replace(/\.+$/, '');
    if (!section) continue;
    add({ target: section, type: 'section', section });
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
