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
/** 3 語以上の並びを示す語。"either A, B, or C" の either。 */
const SERIES_MARKERS = /\b(?:either|neither|both|one of|any of|all of)\b/i;

/** 読点の直後に接続詞が来る形。"…, or one of the reserved opcodes" */
const COORDINATOR_AFTER_COMMA = /^\s*(?:or|and|nor)\s+/i;

/** 読点のあとにもう 1 項目あり、そのあとに接続詞が来る形。"…, binary, or one of …" */
const SERIES_ITEM_AFTER_COMMA = /^\s*[^,.;]{1,60},\s*(?:or|and|nor)\s+/i;

/**
 * その読点が並列の区切りか（節の切れ目ではないか）。
 *
 * 判定は 2 通り。
 *
 * 1. 読点のあとにもう 1 項目あり、そのあとに接続詞が来る（3 項目以上の並び）。
 *    これは並列の証拠として十分なので、他の条件は要らない。
 * 2. 読点の直後が接続詞である。これだけでは節の連結
 *    （"…in the order sent by the sender, and the receiver MUST …"）と
 *    区別できないため、直前に `either` などの並列の目印があるか、
 *    すでに並列の読点を通っていることを求める。
 */
function isSeriesComma(text: string, index: number, seenSeriesComma: boolean): boolean {
  const after = text.slice(index + 1);

  if (SERIES_ITEM_AFTER_COMMA.test(after)) return true;
  if (!COORDINATOR_AFTER_COMMA.test(after)) return false;

  return seenSeriesComma || SERIES_MARKERS.test(text.slice(0, index));
}

export function clipAtClauseEnd(text: string): string {
  let depth = 0;
  let seenSeriesComma = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      // 並列（"A, B, or C"）の読点では切らない。切ると RFC 6455 §5.4 の
      // "MUST be either text, binary, or one of the reserved opcodes" の
      // action が "be either text" になる。
      if (isSeriesComma(text, i, seenSeriesComma)) {
        seenSeriesComma = true;
        continue;
      }
      return text.slice(0, i).trim();
    } else if (isSentenceEnd(text, i)) return text.slice(0, i).trim();
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

// ========================================
// 要件文の切り出し（テキスト経路）
// ========================================

/**
 * ABNF の注釈行。RFC のテキストでは規範的な文がここに書かれることがある。
 *
 * ```
 * frame-rsv1              = %x0 / %x1
 *                           ; 1 bit in length, MUST be 0 unless
 *                           ; negotiated otherwise
 * ```
 */
const ABNF_COMMENT_LINE = /^\s*;\s?/;

/**
 * 図・ABNF らしい体裁か。
 *
 * テキスト経路（RFC 8650 未満）には `<sourcecode>` や `<artwork>` にあたる目印が
 * 無いため、体裁で見分けるほかない。当たった段落では空白を畳まない。畳むと
 * RFC 6455 §5.2 のフレーム図や ABNF の桁揃えが崩れる。
 */
const DIAGRAM_PATTERNS: RegExp[] = [
  /^[ \t]*[A-Za-z][\w-]*[ \t]*=[ \t]/m, // ABNF の規則（"frame-rsv1 = %x0 / %x1"）
  / {2};/, // ABNF の注釈（2 個以上の空白のあとのセミコロン）
  /[-+]{4,}/, // 図の罫線
  /\|[ \t]{2,}/, // 図の縦罫（"|   F   |"）
  /^[ \t]*\|.*\|[ \t]*$/m, // 罫線で囲んだ行（"|F|R|R|R| opcode|M| Payload len |"）
  /\S {3,}\S[^\n]* {3,}\S/, // 空白で桁を揃えた表の行（"Message   SHOULD   SHOULD   SHOULD"）
];

/**
 * 散文にも現れる書き方は目印にしない。
 *
 * - `%x0A` — RFC 7230 §3 の "the octet LF (%x0A)" は散文である。ABNF の本体には
 *   規則の行があるので、そちらで当たる。
 * - `|` のあとの改行 — RFC 6455 は本文でヘッダ名を `|Origin|` と括る。図の縦罫は
 *   同じ行の中で空白が続くので、改行を含めずに見る。
 * - 行の途中の `|` — 同じ理由。図の行は `|` で始まり `|` で終わる。
 */
export function looksLikeDiagram(text: string): boolean {
  return DIAGRAM_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * 行頭の箇条書き記号を落とす。
 *
 * RFC のテキストでは "o  " が黒丸の代わりに使われる。要件文が
 * `"o  Message fragments MUST be delivered …"` のように始まっていた。
 * 数字や括弧付きの記号も同様に落とす。
 */
export function stripListMarker(text: string): string {
  return text.replace(/^\s*(?:o {2}|[-*•] |\d+\.\s{2}|\(\d+\)\s|[a-z]\)\s)/, '');
}

/** 段落内の改行と字下げを 1 個の空白に畳む。 */
export function foldWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 要件文を切り出す元になる文字列と、その中でのキーワードの位置。
 */
export interface RequirementSource {
  /** 切り出しの対象 */
  text: string;
  /** `text` の中でのキーワードの位置 */
  position: number;
  /** 散文として扱えるか。false なら空白を畳まない */
  prose: boolean;
}

/**
 * 要件文の切り出し元を決める。
 *
 * 3 通りある。
 *
 * 1. **ABNF の注釈の中** — 続く注釈行をまとめ、";" を外して 1 行の散文にする。
 *    RFC 6455 §5.2 の
 *    `"; 1 bit in length, MUST be 0 unless" / "; negotiated otherwise"` は
 *    `"1 bit in length, MUST be 0 unless negotiated otherwise"` になる。
 *    v0.6.5 まではキーワードのある行だけが `frame-rsv1 = %x0 / %x1` と一緒に
 *    切り出され、"…, MUST " で切れていた。
 * 2. **図・ABNF の本体** — そのまま切り出し、空白は畳まない。
 * 3. **散文** — そのまま切り出し、空白を畳む。
 */
export function requirementSource(
  content: string,
  position: number,
  level: string
): RequirementSource {
  const lineStart = content.lastIndexOf('\n', position - 1) + 1;
  const lineEndIndex = content.indexOf('\n', position);
  const lineEnd = lineEndIndex === -1 ? content.length : lineEndIndex;
  const line = content.slice(lineStart, lineEnd);

  if (ABNF_COMMENT_LINE.test(line)) {
    const lines = content.split('\n');
    const index = content.slice(0, lineStart).split('\n').length - 1;

    let first = index;
    while (first > 0 && ABNF_COMMENT_LINE.test(lines[first - 1])) first--;
    let last = index;
    while (last + 1 < lines.length && ABNF_COMMENT_LINE.test(lines[last + 1])) last++;

    const text = foldWhitespace(
      lines
        .slice(first, last + 1)
        .map((l) => l.replace(ABNF_COMMENT_LINE, ''))
        .join(' ')
    );
    const keyword = text.indexOf(level);
    return { text, position: keyword === -1 ? 0 : keyword, prose: true };
  }

  // 図・表の行に当たっているなら、**その 1 行だけ**を切り出しの対象にする。
  //
  // 段落全体を返すと、表の全行が 1 件の要件になる。RFC 2131 §4.3.1 の Table 3 は
  // 2 ページにわたるため、`generate_checklist` に 2,000 文字の「要件」が
  // レベルごとに 4 回並んでいた。表の中のキーワードは、その行の話である。
  if (looksLikeDiagram(line)) {
    return { text: line, position: position - lineStart, prose: false };
  }

  // 1 つの段落に図と散文が混じることがある。RFC 2616 §14.27 は ABNF の 1 行の
  // あとに続けて散文を書き、RFC 8446 §4.2 は表のすぐあとに散文を書く。
  // 段落全体を図と見なすと散文まで畳まれず、`generate_checklist` の Markdown が
  // 崩れる。キーワードのある行を含む「図でない行の連なり」だけを切り出しの
  // 対象にする。
  const lines = content.split('\n');
  const lineIndex = content.slice(0, lineStart).split('\n').length - 1;

  let first = lineIndex;
  while (first > 0 && !looksLikeDiagram(lines[first - 1])) first--;
  let last = lineIndex;
  while (last + 1 < lines.length && !looksLikeDiagram(lines[last + 1])) last++;

  const runStart = lines.slice(0, first).join('\n').length + (first > 0 ? 1 : 0);
  const runEnd = lines.slice(0, last + 1).join('\n').length;

  return {
    text: content.slice(runStart, runEnd),
    position: position - runStart,
    prose: true,
  };
}
