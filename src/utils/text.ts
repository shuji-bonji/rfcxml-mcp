/**
 * テキスト処理ユーティリティ
 * RFC パーサー共通のテキスト抽出・解析関数
 */

import type { CrossReference } from '../types/index.js';
import {
  createExternalSectionRegexes,
  createRequirementRegex,
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

  // 句点のあとに閉じ括弧・閉じ引用符が来ることがある。RFC 9051 は
  // `(See Section 6.3.9.7 for more details.) Mailboxes created in one IMAP
  // session MAY …` と書く。`.` の次が `)` なので文末と見ておらず、要件文が
  // **注記の括弧から始まって**いた（実測 80 件）。
  let after = index + 1;
  while (after < text.length && SENTENCE_CLOSERS.includes(text[after])) after++;

  const next = text[after];
  if (next !== undefined && !/\s/.test(next)) return false;

  if (char !== '.') return true;

  const tail = text.slice(Math.max(0, index - 4), index + 1).toLowerCase();
  return !ABBREVIATIONS.some((abbreviation) => tail.endsWith(abbreviation));
}

/**
 * 句点のあとに続きうる閉じ記号。**括弧だけ**にする。
 *
 * 閉じ引用符を入れると、引用の中の疑問符が文末になる。RFC 2616 §13.9 の
 * `query URLs (those containing a "?" in the rel_path part) to perform …` は
 * `"?"` の `?` が文末と読まれ、要件文が **`in the rel_path part) to perform …`**
 * と括弧の途中から始まっていた。
 */
const SENTENCE_CLOSERS = ')]}';

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

  // 句点のあとの閉じ記号は、この文のものである。落とすと括弧が釣り合わない。
  let stop = end + 1;
  while (stop < text.length && SENTENCE_CLOSERS.includes(text[stop])) stop++;

  // 直前の文の閉じ記号が頭に残ることがある。
  let from = start;
  while (from < stop && (SENTENCE_CLOSERS.includes(text[from]) || /\s/.test(text[from]))) from++;

  return text.substring(from, stop).trim();
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
  /^[ \t]*[A-Za-z][\w-]*[ \t]*::=/m, // ASN.1 の型定義（"TBSCertificate ::= SEQUENCE {"）
  /\[\d+\]\s+(?:IMPLICIT|EXPLICIT)\b/, // ASN.1 のタグ（"[0] EXPLICIT Version"）
  /\/\*|\*\//, // 擬似コードの注釈（"/* OPTIONAL error counter step */"）
  /[{}][ \t]*$|^[ \t]*[{}]/m, // 擬似コードの波括弧
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

/**
 * 引用符に囲まれたキーワードの前後に来る文字。
 *
 * 開き側と閉じ側を別に持つ。`"MUST"` のように、開いて閉じているときだけ
 * 「語について書いている」とみなす。
 */
const QUOTE_OPEN = /["'“‘`]$/;
/**
 * 閉じ側。引用符のほか `-` も許す。
 *
 * RFC 9293 は要求に識別子を付けて `"MUST-14"` と書く。この `-` を閉じ側と
 * みなさないと、§2.1 の説明文（"Sentences using \"MUST\" are labeled as
 * \"MUST-X\""）から要件が出る。
 */
const QUOTE_CLOSE = /^(?:["'”’`]|-\w)/;

/**
 * 引用符に囲まれたキーワードは、要件ではなく語の紹介である。
 *
 * RFC はほぼすべて、冒頭に BCP 14 の定型文を置く。
 *
 * > The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
 * > "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
 * > "OPTIONAL" in this document are to be interpreted as described in
 * > BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all
 * > capitals, as shown here.
 *
 * この 1 文から 11 件の要件が出ていた。RFC 8259 の `generate_checklist` は
 * 21 項目のうち 11 項目がこの文だった。
 *
 * 同じことは定型文以外でも起きる。RFC 9293 §2.1 の
 * "Sentences using \"MUST\" are labeled as \"MUST-X\"" や、RFC 5322 §1.2.1 の
 * "When the terms \"MUST\", \"SHOULD\", … appear capitalized" も語の説明である。
 *
 * 実測（RFC 49 本・要件 8,164 件）: 引用符に囲まれたキーワード 364 件（4.5%）。
 * 内訳は BCP 14 の定型文 324 件と、語の説明 40 件。要件は 1 件も無かった。
 */
export function isQuotedKeyword(text: string, position: number, length: number): boolean {
  if (position <= 0) return false;
  return (
    QUOTE_OPEN.test(text.slice(position - 1, position)) &&
    QUOTE_CLOSE.test(text.slice(position + length))
  );
}

/**
 * 段落から要件マーカーを取り出す。
 *
 * XML 経路とテキスト経路で同じものを使う。片方だけに条件を足すと、
 * 同じ RFC が経路によって違う要件を返す。
 */
/**
 * BCP 14 の定型文。ここからは要件を出さない。
 *
 * 引用符を付けない書き方がある。RFC 5652 §1.2 は
 *
 * > In this document, the key words MUST, MUST NOT, REQUIRED, SHOULD,
 * > SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL are to be interpreted as
 * > described in [STDWORDS].
 *
 * と書く。`isQuotedKeyword` は当たらないので、8 件の要件が出ていた。
 * RFC 4253 §1.1 も同じ書き方である。
 */
const BCP14_BOILERPLATE =
  /\bkey\s?words?\b[\s\S]{0,400}?\bare\s+to\s+be\s+interpreted\s+as\s+described\s+in\b/i;

/**
 * ASN.1 の定義の行。`OPTIONAL` はここでは BCP 14 のキーワードではない。
 *
 * RFC 5652 §5.3 は SignerInfo を次のように定義する。
 *
 * ```
 * SignerInfo ::= SEQUENCE {
 *   version CMSVersion,
 *   signedAttrs [0] IMPLICIT SignedAttributes OPTIONAL,
 *   unsignedAttrs [1] IMPLICIT UnsignedAttributes OPTIONAL }
 * ```
 *
 * `[0] IMPLICIT` と `::=` は ASN.1 の構文で、散文には現れない。
 * 実測（RFC 90 本・要件 10,196 件）で 42 件（0.41%）。
 * すべて型定義で、要件は 1 件も無かった。RFC 5280 と RFC 5652 に出る。
 */
const ASN1_DEFINITION = /\[\d+\]\s+(?:IMPLICIT|EXPLICIT)\b|::=/;

/** その位置を含む 1 行を返す。 */
function lineAt(text: string, position: number): string {
  const start = text.lastIndexOf('\n', position - 1) + 1;
  const end = text.indexOf('\n', position);
  return text.slice(start, end === -1 ? text.length : end);
}

export function extractRequirementMarkers(
  text: string
): Array<{ level: string; position: number }> {
  if (BCP14_BOILERPLATE.test(text)) return [];

  const markers: Array<{ level: string; position: number }> = [];
  const regex = createRequirementRegex();

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (isQuotedKeyword(text, match.index, match[0].length)) continue;
    if (ASN1_DEFINITION.test(lineAt(text, match.index))) continue;
    // 2 語のキーワードは改行をまたぐことがある。レベルは 1 個の空白に畳む。
    markers.push({ level: match[1].replace(/\s+/g, ' '), position: match.index });
  }

  return markers;
}

// ========================================
// 定義の絞り込み（XML 経路・テキスト経路の共通）
// ========================================

/**
 * 定義の用語として認めない見出し。
 *
 * RFC の表紙（`Request for Comments: 7519`）、末尾の著者欄（`EMail: …`）、
 * 本文の注記（`NOTE: …`）、IANA 登録票の項目（`o  Type name: application`）は
 * どれも「用語: 説明」と同じ形をしているが、用語ではない。
 */
const NOT_A_TERM =
  /^(?:Request for Comments|Category|ISSN|Obsoletes|Updates|Network Working Group|BCP|STD|FYI|EMail|Email|E-Mail|URI|URL|Phone|Fax|Tel|Telephone|NOTE|Note|Notes|Example|EXAMPLE|Examples|IMPLEMENTATION NOTE|Implementation Note|NB)$|^o\s/;

/**
 * 文の書き出しに来る語。これで始まる「用語」は、折り返した文の途中である。
 * RFC 6455 の "The protocol has two parts: a handshake and the data transfer."
 */
export const SENTENCE_OPENER =
  /^(?:The|This|These|Those|That|It|Its|A|An|Each|Every|All|There|If|When|Note that)\s/;

/**
 * 用語の中に現れると、用語ではなく文の一部であることを示す語。
 * RFC 9110 の IANA 登録票 "Applications that use this media type"。
 */
export const RELATIVE_CLAUSE = /\s(?:that|which|who|have|has|are|is|be|was|were)\s/i;

/** 同じ用語がこの回数以上出たら、定義ではなく登録票・例示の並びとみなす。 */
const MAX_TERM_OCCURRENCES = 3;

/**
 * 定義になっていないものを落とす。
 *
 * 2 種類ある。
 *
 * 1. 用語の位置に来る、用語でない見出し（`NOT_A_TERM`）。
 * 2. 文の書き出し・関係節を含むもの（`SENTENCE_OPENER` / `RELATIVE_CLAUSE`）。
 * 3. 同じ用語が何度も出るもの。IANA 登録票は `Name:` `Description:`
 *    `Reference:` を項目の数だけ繰り返す（RFC 9209 は 34 回）。見出し
 *    フィールドの例示も同じ形になる（RFC 6265 §3.1 の `Set-Cookie:` が
 *    10 回以上）。用語の定義なら 1 つの RFC に 1 回か 2 回しか出ない。
 */
export function dropNonDefinitions<T extends { term: string }>(definitions: T[]): T[] {
  const count = new Map<string, number>();
  for (const definition of definitions) {
    count.set(definition.term, (count.get(definition.term) ?? 0) + 1);
  }
  return definitions.filter(
    (definition) =>
      !NOT_A_TERM.test(definition.term) &&
      !SENTENCE_OPENER.test(definition.term) &&
      !RELATIVE_CLAUSE.test(definition.term) &&
      (count.get(definition.term) ?? 0) < MAX_TERM_OCCURRENCES
  );
}

/**
 * 上限で切る。語の途中では切らず、末尾に三点リーダを置く。
 *
 * 切ったことが分からないと、読み手はそれが全部だと読む。実例:
 *
 * - RFC 2616 §14.9.2 の no-store の定義が
 *   "This directive applies to both non" で終わっていた。
 * - RFC 2822 の `[ASCII]` の題名が
 *   "… American National Standard Code for Informatio" で終わっていた。
 */
export function clipAtWord(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const head = trimmed.slice(0, max);
  const cut = head.lastIndexOf(' ');
  return `${(cut > max / 2 ? head.slice(0, cut) : head).replace(/[\s,;:-]+$/, '')}…`;
}
