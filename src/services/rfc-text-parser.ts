/**
 * RFC テキストパーサー
 * XMLが利用できない古いRFC用のフォールバック解析
 */

import type {
  Section,
  Requirement,
  Definition,
  ContentBlock,
  TextBlock,
  ParsedRFC,
  RFCReference,
} from '../types/index.js';
import { createRequirementRegex, SECTION_HEADER_PATTERN } from '../constants.js';
import {
  extractCrossReferences,
  extractRequirementMarkers as extractMarkers,
  looksLikeDiagram,
} from '../utils/text.js';
import {
  extractRequirementsFromSections,
  type RequirementFilter,
} from '../utils/requirement-extractor.js';

// ========================================
// Text Parser Configuration
// ========================================

/**
 * メタデータ抽出の設定
 */
const METADATA_EXTRACTION = {
  /** タイトル検索で走査する最大行数 */
  MAX_LINES_TO_SCAN: 30,
  /** 字下げ無しでも題名とみなす最小文字数（行幅いっぱいの題名） */
  WIDE_TITLE_MIN_LENGTH: 60,
  /** タイトルとして有効な最小文字数 */
  TITLE_MIN_LENGTH: 10,
  /**
   * タイトルとして有効な最大文字数。
   *
   * RFC 1521 の "MIME (Multipurpose Internet Mail Extensions) Part One:
   * Mechanisms for Specifying and Describing the Format of Internet Message
   * Bodies" は 133 文字あり、100 では落ちて `metadata.title` が空になっていた。
   */
  TITLE_MAX_LENGTH: 200,
} as const;

/**
 * 定義抽出の設定
 */
const DEFINITION_EXTRACTION = {
  /** 用語として認識する最小文字数 */
  MIN_TERM_LENGTH: 2,
  /** 定義として認識する最小文字数 */
  MIN_DEFINITION_LENGTH: 10,
} as const;

/**
 * RFC テキストをパースして構造化データに変換（中精度）
 */
export function parseRFCText(text: string, rfcNumber: number): ParsedRFC {
  const lines = stripPageFurniture(text).split('\n');

  return {
    metadata: extractTextMetadata(lines, rfcNumber),
    sections: extractTextSections(lines),
    references: extractTextReferences(lines, rfcNumber),
    definitions: extractTextDefinitions(lines),
  };
}

/** ページ末尾の行。"Fielding & Reschke   Standards Track   [Page 29]" */
const PAGE_FOOTER = /\[Page\s+\d+\]\s*$/;

/** ページ先頭の行。1 桁目から始まり、末尾が発行年月。 */
const PAGE_HEADER = /^\S.*\b(19|20)\d{2}\s*$/;

/**
 * ページの区切り（フッタ・改ページ・ヘッダ）を取り除く。
 *
 * RFC の .txt は 1 ページ 58 行で組まれており、段落の途中でもページが変わる。
 *
 * ```
 *    A client MUST NOT send a request containing Transfer-Encoding unless it knows the
 *
 * Fielding & Reschke           Standards Track                   [Page 29]
 * \f
 * RFC 7230           HTTP/1.1 Message Syntax and Routing         June 2014
 *
 *    server will handle HTTP/1.1 (or later) requests; such knowledge might
 * ```
 *
 * `createTextBlocks()` は空行で段落を切るため、この区切りで段落が 2 つに割れて
 * いた。要件文は "…unless it knows the" で終わり、`fullContext` にも続きが入らない。
 * RFC 7230 / 2616 / 8446 では、文末記号で終わらない要件がそれぞれ 2 / 6 / 5 件あった。
 *
 * 区切りを外したあと、**直前の行が文末で終わっていなければ空行を入れずに続ける**。
 * ページの変わり目が段落の切れ目でもあるかどうかはテキストからは判らないので、
 * 文が途中かどうかで決める。
 */
export function stripPageFurniture(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!PAGE_FOOTER.test(line)) {
      out.push(line);
      i++;
      continue;
    }

    // フッタの手前に入っているページ埋めの空行を落とす
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    i++;

    // 改ページ（\f）とその前後の空行
    let sawFormFeed = false;
    while (i < lines.length && (lines[i].trim() === '' || lines[i].includes('\f'))) {
      if (lines[i].includes('\f')) sawFormFeed = true;
      i++;
    }

    // ページ先頭の見出し行。改ページがあったか、行の形が見出しらしいときだけ落とす。
    if (i < lines.length && (sawFormFeed || PAGE_HEADER.test(lines[i]))) {
      i++;
      while (i < lines.length && lines[i].trim() === '') i++;
    }

    // 文が途中なら段落を続ける。終わっていれば段落の切れ目として残す。
    const previous = out.length > 0 ? out[out.length - 1] : '';
    if (!previous.trim() || /[.:;?!]\s*$/.test(previous)) out.push('');
  }

  return out.join('\n');
}

/** 参考文献の欄の見出し。番号の有無どちらもある。 */
const REFERENCE_HEADING_PATTERN =
  /^(?:\d+(?:\.\d+)*\.?\s+)?((?:normative|informative)\s+)?references\s*$/i;

/**
 * 参考文献の 1 項目の始まり。
 *
 * ```
 *    [RFC2119]  Bradner, S., "Key words for use in RFCs to Indicate
 *               Requirement Levels", BCP 14, RFC 2119, March 1997.
 * ```
 *
 * 見出しの角括弧は 4 桁目から始まり、続きの行はさらに深く字下げされる。
 */
const REFERENCE_ENTRY_PATTERN = /^ {0,6}\[([^\]\s][^\]]*)\]/;

/**
 * 参考文献の欄（"14.1 Normative References" / "14.2 Informative References"）から
 * 参照を取り出す。
 *
 * v0.6.5 までは本文全体を `RFC\s*(\d+)` で走査していた。そのため
 *
 * - 規範的参照と参考的参照を区別できず、すべて `informative` に入っていた
 *   （RFC 6455 は normative 11 件 / informative 11 件だが、22 件すべてが
 *   informative に出ていた）。
 * - 参考文献に載っていない言及まで参照として数えていた。RFC 6455 の
 *   「RFC 5741」は Status of This Memo の定型文、「RFC 6202」は §1.1 の地の文である。
 * - 題名が取れず `title: "RFC 2119"` という仮置きしか返せなかった。
 *
 * 節見出しの検出は v0.6.5 で直った規則（1 桁目から始まる行だけを見出しとする）に
 * 従う。ページの区切り（"[Page 68]" の行と、次ページ冒頭の
 * "RFC 6455 … December 2011" の行）は字下げが無いので、見出しとして通らなかった
 * 行を読み飛ばすことで一緒に落ちる。
 *
 * 参考文献の欄が 1 つしかない RFC では、そこにある参照はすべて `informative` に入る。
 * テキストからは規範性を判別できないためである。
 */
function extractTextReferences(lines: string[], currentRfcNumber: number): ParsedRFC['references'] {
  const result = {
    normative: [] as RFCReference[],
    informative: [] as RFCReference[],
  };
  const seen = new Set<string>();

  let bucket: 'normative' | 'informative' | null = null;
  let anchor = '';
  let buffer: string[] = [];

  const flush = (): void => {
    if (bucket && anchor) {
      const ref = parseTextReference(anchor, buffer.join(' '), bucket);
      const key = `${bucket}\u0000${ref.anchor}`;
      if (ref.rfcNumber !== currentRfcNumber && !seen.has(key)) {
        seen.add(key);
        result[bucket].push(ref);
      }
    }
    anchor = '';
    buffer = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line) continue;

    // 項目の始まりは字下げの有無を問わない。RFC 1122 は 1 桁目から
    // "[TCP:8] \"Modularity and Efficiency ...\"" と書く。
    const entryStart = bucket ? line.match(REFERENCE_ENTRY_PATTERN) : null;
    if (entryStart) {
      flush();
      anchor = entryStart[1].trim();
      buffer = [line];
      continue;
    }

    // 中央寄せの見出し（RFC 793 の "                REFERENCES"）。
    // 番号を持たず字下げされるので、上の 1 桁目の規則では拾えない。
    if (/^\s/.test(line) && line.length <= 60 && REFERENCE_HEADING_PATTERN.test(line.trim())) {
      flush();
      bucket = /normative/i.test(line) ? 'normative' : 'informative';
      continue;
    }

    // 1 桁目から始まる行だけが見出しになりうる。
    if (!/^\s/.test(line)) {
      const headerMatch = line.match(SECTION_HEADER_PATTERN);
      const heading = headerMatch
        ? isValidSectionHeader(headerMatch[1].replace(/\.$/, ''), headerMatch[2])
          ? headerMatch[2]
          : null
        : line;

      if (heading !== null) {
        const asReferences = REFERENCE_HEADING_PATTERN.exec(heading.trim());
        if (asReferences) {
          flush();
          bucket = /normative/i.test(asReferences[1] ?? '') ? 'normative' : 'informative';
          continue;
        }
        // 参考文献ではない節に入ったら欄を閉じる。ページの区切りの行は
        // `isValidSectionHeader` を通らないので、ここには来ない。
        if (headerMatch) {
          flush();
          bucket = null;
          continue;
        }
      }

      // 1 桁目から続く項目の本体。RFC 1305 は目印だけを 1 行に置き、
      // 引用を次の行から 1 桁目で書く。
      //
      // ```
      // [ABA89]
      //
      // Abate, et al. AT&T's new approach to the synchronization of
      // telecommunication networks. IEEE Communications Magazine (April 1989).
      // ```
      //
      // 落としていたため、48 件の題名が目印（`ABA89`）のままだった。
      if (bucket && anchor) buffer.push(line);
      continue;
    }

    if (!bucket) continue;
    if (anchor) buffer.push(line);
  }

  flush();

  return result;
}

/**
 * 参考文献の 1 項目を `RFCReference` にする。
 *
 * - RFC 番号: 角括弧の中が `RFC2119` ならそこから。`[HTTP/1.1]` のような
 *   略号のときは、項目の末尾に置かれる連番（"…, BCP 14, RFC 2119, March 1997."）の
 *   最後の 1 つを採る。"for use in RFCs to Indicate" のような地の文は
 *   数字が続かないので当たらない。
 * - 題名: 最初の二重引用符で囲まれた部分。
 */
function parseTextReference(
  anchor: string,
  rawEntry: string,
  type: 'normative' | 'informative'
): RFCReference {
  const entry = rawEntry.replace(/\s+/g, ' ').trim();

  const quoted = /"([^"]+)"/.exec(entry);

  let rfcNumber: number | undefined;
  const fromAnchor = /^RFC[\s-]*(\d+)$/i.exec(anchor);
  if (fromAnchor) {
    rfcNumber = parseInt(fromAnchor[1], 10);
  } else {
    // 題名を外してから探す。
    //
    // RFC 1123 の `[SMTP:5b] "Addendum to RFC-987," S. Kille, RFC-???, …` は
    // 題名の中の 987 を拾い、実在しない別文書を指していた。
    //
    // **最初の**番号を採る。項目のあとに注釈の段落が続く RFC があり、
    // 最後の番号を採ると注釈の中の番号になる。RFC 1123 の
    // `[DNS:1] "Domain Names - Concepts and Facilities," P. Mockapetris,
    // RFC-1034, November 1987.` は、注釈の
    // "obsolete RFC-882, RFC-883, RFC-973" から 973 を拾っていた。
    const body = quoted ? entry.replace(quoted[0], ' ') : entry;
    // "RFC 2119" と "RFC-817"（古い RFC の書き方）の双方を拾う
    const inline = /\bRFC[\s-]+(\d+)\b/.exec(body);
    if (inline) {
      rfcNumber = parseInt(inline[1], 10);
    }
  }

  // 題名の引用符の中に読点が入る（`"Assigned Numbers," J. Reynolds, …`）。
  // 実測（テキスト経路の参照 859 件）で 121 件（14.1%）が読点で終わっていた。
  const quotedTitle = quoted ? quoted[1].trim() : '';
  const title = (quotedTitle || titleWithoutQuotes(entry) || '').replace(/[,;]$/, '');

  return {
    anchor,
    type,
    rfcNumber,
    title: title || (rfcNumber ? `RFC ${rfcNumber}` : anchor),
  };
}

/** 引用符を使わない書式の項目から、題名にあたる部分を取る最大の長さ。 */
const UNQUOTED_TITLE_MAX_LENGTH = 120;

/**
 * 二重引用符を使わない古い書式の項目から題名を取る。
 *
 * RFC 2616 の `[21]` `[22]` は引用符を使わない。
 *
 * ```
 * [21] US-ASCII. Coded Character Set - 7-Bit American Standard Code for
 *      Information Interchange. Standard ANSI X3.4-1986, ANSI, 1986.
 * ```
 *
 * ピリオドで区切ったうちの最も長い部分を採る。上の例では
 * "Coded Character Set - 7-Bit American Standard Code for Information Interchange" になる。
 * 短すぎる断片（略称や発行年）を避けるためで、書誌の構造を解析しているわけではない。
 * 何も取れなければ呼び出し側が anchor に戻す。
 */
function titleWithoutQuotes(entry: string): string | undefined {
  // 開き引用符だけがあって閉じていない項目がある。RFC 2131 の
  // `[4] Braden, R., Editor, "Requirements for Internet Hosts --
  //  Application and Support, STD 3, RFC 1123, …` は閉じ引用符が無い
  //（原文の誤り）。開き引用符から、出典の切れ目までを題名とみなす。
  const unbalanced = /"([^"]+?)(?:,\s*(?:STD|RFC|BCP|Work in Progress)\b|$)/.exec(entry);
  if (unbalanced && (entry.match(/"/g) ?? []).length === 1) {
    const candidate = unbalanced[1].trim();
    if (candidate.length >= 12) return candidate.slice(0, UNQUOTED_TITLE_MAX_LENGTH);
  }

  // 目印は題名ではない。RFC 1305 は `[BEL86]` を 1 行に置き、次の行から
  // 引用を書くため、繋いだ項目が目印で始まる。
  const body = entry.replace(/^\[[^\]]+\]\s*/, '').trim();

  const parts = body
    .split(/\.\s+/)
    .map((part) => part.replace(/\.$/, '').trim())
    .filter((part) => part.length > 0);

  // 出典の部分は題名ではない。RFC 1305 の
  // `Defense Advanced Research Projects Agency. Internet Protocol. DARPA
  //  Network Working Group Report RFC-791, USC Information Sciences
  //  Institute, September 1981.`
  // で最長の部分を採ると、題名が出典と日付の塊になっていた。
  // RFC 番号・西暦・ページ範囲を含む部分を落としてから選ぶ。
  const withoutImprint = parts.filter(
    (part) => !/\bRFC[\s-]*\d+\b|\b(?:19|20)\d{2}\b|\b\d+-{1,2}\d+\b/.test(part)
  );
  const candidates = withoutImprint.length > 0 ? withoutImprint : parts;

  const longest = candidates.reduce((best, part) => (part.length > best.length ? part : best), '');
  if (longest.length >= 12 && parts.length >= 2) {
    return longest.slice(0, UNQUOTED_TITLE_MAX_LENGTH).trim();
  }

  // 文の切れ目が無い引用がある。RFC 5246 の
  // `[X680] ITU-T Recommendation X.680 (2002) | ISO/IEC 8824-1:2002,
  //  Information technology - Abstract Syntax Notation One (ASN.1)…`
  // は句点で割れない。目印を外した本文をそのまま題名にする。
  // 落とすと、題名が目印（`X680`）のままになる。
  if (body.length >= 12) {
    return body.slice(0, UNQUOTED_TITLE_MAX_LENGTH).trim();
  }

  return undefined;
}

/**
 * メタデータ抽出（テキストから）
 */
function extractTextMetadata(lines: string[], rfcNumber: number): ParsedRFC['metadata'] {
  return {
    title: extractTextTitle(lines),
    number: rfcNumber,
    date: extractTextPublicationDate(lines),
  };
}

/** 題名の位置に来ることがある見出し。当たったら題名は取れていない。 */
const FRONT_MATTER_HEADINGS = new Set([
  'abstract',
  'status of this memo',
  'status of memo',
  'copyright notice',
  'table of contents',
]);

/**
 * テキスト版 RFC の題名を取り出す。
 *
 * 先頭は必ず次の形をしている。発行者と著者が 2 段組で並ぶ「ヘッダ塊」があり、
 * 空行を挟んで、中央寄せの題名が来る。
 *
 * ```
 * Internet Engineering Task Force (IETF)                          B. Leiba
 * Request for Comments: 8174                           Huawei Technologies
 * BCP: 14                                                         May 2017
 * Updates: 2119
 * Category: Best Current Practice
 * ISSN: 2070-1721
 *
 *
 *       Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words
 *
 * Abstract
 * ```
 *
 * 以前は「コロンを含まない適度な長さの行」を上から探していたため、ヘッダ塊の
 * 1 行目（"Internet Engineering Task Force (IETF)      B. Leiba"）を題名として
 * 拾っていた。ヘッダ塊を空行で終端し、その次の非空行から取る。
 *
 * @returns 題名。判別できなければ `undefined`（呼び出し側が API の題名へ落とす）
 */
function extractTextTitle(lines: string[]): string | undefined {
  const limit = Math.min(METADATA_EXTRACTION.MAX_LINES_TO_SCAN, lines.length);

  // ヘッダ塊の始まり
  let index = 0;
  while (index < limit && lines[index].trim() === '') index++;
  if (index >= limit) return undefined;

  // ヘッダ塊の終わり（最初の空行）
  while (index < limit && lines[index].trim() !== '') index++;

  // 題名の始まり
  while (index < limit && lines[index].trim() === '') index++;
  if (index >= limit) return undefined;

  // 中央寄せなので字下げがある。ただし行幅いっぱいの題名は 1 桁目から始まる。
  // RFC 7489 の
  // "Domain-based Message Authentication, Reporting, and Conformance (DMARC)"
  // は 71 文字あり、字下げを課すと `metadata.title` が空になっていた。
  if (
    !/^\s/.test(lines[index]) &&
    lines[index].trim().length < METADATA_EXTRACTION.WIDE_TITLE_MIN_LENGTH
  ) {
    return undefined;
  }

  // 空行までを 1 つの題名として繋ぐ（2 行に折り返す題名がある）
  const parts: string[] = [];
  while (index < limit && lines[index].trim() !== '' && parts.length < 3) {
    parts.push(lines[index].trim());
    index++;
  }

  const title = parts.join(' ');
  if (title.length < METADATA_EXTRACTION.TITLE_MIN_LENGTH) return undefined;
  if (title.length > METADATA_EXTRACTION.TITLE_MAX_LENGTH) return undefined;
  if (FRONT_MATTER_HEADINGS.has(title.toLowerCase())) return undefined;

  return title;
}

/** ヘッダ行に現れる月名 → 月番号 */
const TEXT_MONTHS: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

/**
 * テキスト版 RFC のヘッダから公開年月を取り出す。
 *
 * 先頭のヘッダ塊は右寄せで発行者と日付が並ぶ。
 *
 * ```
 * Internet Engineering Task Force (IETF)                     W. Eddy, Ed.
 * Request for Comments: 9293                                 MTI Systems
 * STD: 7                                                     August 2022
 * ```
 *
 * 本文中の "August 2022" を拾わないよう、走査はヘッダの範囲に限る。
 */
function extractTextPublicationDate(lines: string[]): string | undefined {
  const pattern =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i;

  for (let i = 0; i < Math.min(METADATA_EXTRACTION.MAX_LINES_TO_SCAN, lines.length); i++) {
    const match = pattern.exec(lines[i]);
    if (match) {
      return `${match[2]}-${TEXT_MONTHS[match[1].toLowerCase()]}`;
    }
  }

  return undefined;
}

/**
 * セクションヘッダーとして妥当かを検証
 * 誤検出を防ぐためのヒューリスティクス
 */
/**
 * 目次の行かどうか。
 *
 * 目次は「題名 + リーダー + ページ番号」で終わる。リーダーの書き方は 2 通りある。
 *
 * ```
 * 1.  Introduction . . . . . . . . . . . . . . . . . . . . . . . .   4   (RFC 6455)
 * 1. Introduction ....................................................6   (RFC 8446)
 * ```
 *
 * 除外しないと、同じ節番号が目次と本文の 2 回現れる。RFC 6455 では 228 節のうち
 * 87 件が目次の行だった。節番号が重複すると `findSection` がどちらを引くか定まらない。
 */
function isTableOfContentsEntry(title: string): boolean {
  return /(?:\.\s?){3,}\s*\d+\s*$/.test(title.trim());
}

/**
 * 節見出しとして妥当か。
 *
 * ここに来る行は、1 桁目から始まり「番号 + 空白 + 題名」の形をしている
 * （`extractTextSections` が字下げのある行を弾いている）。RFC の .txt は本文を
 * 3 桁目から組むので、この形の行はほぼ節見出しである。残る除外は目次の行と、
 * 節番号として不自然な数だけでよい。
 *
 * v0.6.8 まではここで題名の長さと語彙も見ていた。「3 文字未満は落とす」
 * 「小文字で始まり 20 文字未満なら落とす」「決まった語を含むか、大文字で始まり
 * 5 文字以上か、階層が 2 段以上」という条件で、実在する節が落ちていた。
 *
 * | RFC | 節 | 題名 | 落ちた理由 |
 * |---|---|---|---|
 * | 2616 | 14.39 | `TE` | 3 文字未満 |
 * | 7230 | 4.3 | `TE` | 3 文字未満 |
 * | 7230 | 2.7.1 | `http URI Scheme` | 小文字始まりで 20 文字未満 |
 * | 8446 | 8 | `0-RTT and Anti-Replay` | 語彙に無く、数字始まりで、1 段 |
 *
 * 落ちた節は `get_rfc_structure` に出ないだけでなく、その節の要件が手前の節に
 * 付く。`get_related_sections` が返す参照先も引けなくなる。
 */
function isValidSectionHeader(sectionNum: string, title: string): boolean {
  // 目次の行は節ではない
  if (isTableOfContentsEntry(title)) return false;

  const parts = sectionNum.split('.');
  if (parts.length > 6) return false;

  const first = Number(parts[0]);
  if (!Number.isInteger(first) || first < 1 || first > 99) return false;

  const trimmed = title.trim();
  if (trimmed.length === 0) return false;

  // 題名は文を含まない。折り返した本文が数字から始まると節に見える。
  // RFC 1035 の "…the 26th bit corresponds to TCP port" の次の行は
  // "25 (SMTP).  If this bit is set, a SMTP server should be listening on TCP"
  // で、番号 25 の節として通っていた。句点のあとに語が続く題名は本文である。
  // RFC 8446 §7.4 "(EC)DHE Shared Secret Calculation" のように括弧で始まる
  // 題名はあるので、先頭の文字では判定しない。
  return !containsSentenceBreak(trimmed);
}

/**
 * 題名の中の略語。ここに挙げた語のあとの `.` は文の終わりではない。
 *
 * RFC 1123 は出典を題名に書く。
 * "3.2.1  Option Negotiation: RFC-854, pp. 2-3" の `pp.` を文の終わりと見ると、
 * §3.2.1 から §3.2.8 の 8 節が丸ごと落ちる（v0.6.14 まで落ちていた）。
 */
const TITLE_ABBREVIATION =
  /(?:^|[\s(])(?:pp?|vol|nos?|secs?|chs?|figs?|eds?|al|etc|cf|vs|e\.g|i\.e|[A-Z]|[IVX]{1,4})\.$/i;

/** 題名の中に、略語でない句点があるか。あればそれは題名ではなく本文である。 */
function containsSentenceBreak(title: string): boolean {
  const pattern = /[.!?]\s+\S/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(title)) !== null) {
    const head = title.slice(0, match.index + 1);
    // 三点リーダは文の終わりではない（RFC 1866 §5.4 "Headings: H1 ... H6"）。
    if (/\.\.$/.test(head)) continue;
    if (!TITLE_ABBREVIATION.test(head)) return true;
  }
  return false;
}

/**
 * セクション構造の抽出（テキストから）
 */
/**
 * 題名らしい大文字の並びか。
 *
 * 小文字で始まる題名を、本文の折り返しと見分ける 3 つ目の手がかりである。
 * RFC 2445 §4 の `4 iCalendar Object Specification` は、番号に句点が無く、
 * ページの区切りの直後なので直前も空行ではない。それでも題名である。
 *
 * - `iCalendar Object Specification` → 3 語中 3 語が大文字始まり
 * - `characters, arriving from the user at 200ms intervals, would` → 0 語
 *
 * 1 語だけの題名（`origin-form`）はこの手がかりを使わない。判断できない。
 */
function looksLikeTitleCase(title: string): boolean {
  const words = title
    .trim()
    .split(/\s+/)
    .filter((word) => /[A-Za-z]{3}/.test(word));
  if (words.length < 2) return false;

  const capitalized = words.filter((word) => /^[A-Z]/.test(word)).length;
  return capitalized * 2 >= words.length;
}

/**
 * 付録の見出しか。番号と題名を返す。付録でなければ `null`。
 *
 * RFC は付録に文字を振る。数字だけを見ていたため、**付録が 1 つも
 * 構造に出ていなかった。** テキスト経路で付録を持つ corpus の RFC 20 本すべてで
 * 0 個だった。RFC 8446 は 46 個、RFC 5246 は 37 個、RFC 7489 は 22 個ある。
 *
 * 付録の中身は直前の節に吸い込まれる。RFC 8446 では付録 A〜E の 381 ブロックが
 * §12.2「Informative References」の中身になっていた。
 *
 * ```
 * Appendix A.  State Machine
 * A.1.  Client
 * B.  Protocol Data Structures
 * ```
 *
 * 1 文字の大文字 + 句点は本文にも出る（著者名の "J. Postel" など）。
 * **順番で見分ける。** 付録は A から始まり 1 つずつ進む。
 */
function appendixHeader(
  line: string,
  previousLetter: string | null
): { number: string; title: string } | null {
  // 下位の付録はわずかに字下げすることがある（RFC 1521 の "   E.1  …"）。
  const indent = line.length - line.trimStart().length;
  if (indent > APPENDIX_MAX_INDENT) return null;

  const match = APPENDIX_HEADER_PATTERN.exec(line.trim());
  if (!match) return null;

  const [, explicit, letter, digits, title] = match;
  const trimmed = title.trim();
  if (trimmed.length < 3) return null;
  if (containsSentenceBreak(trimmed)) return null;

  // 深い段（A.1、A.1.2）は親の文字と同じであること。
  // 親の文字が一致していれば十分なので、題名の先頭は問わない。
  // RFC 6749 の `A.1.  "client_id" Syntax`、RFC 5321 の `F.4.  #-literals`、
  // RFC 7489 の `B.5.  mailto Transport Example` のように、引用符・記号・
  // 小文字で始まる題名がある。
  if (digits) {
    if (previousLetter !== letter) return null;
    return { number: `${letter}${digits}`, title: trimmed };
  }

  // 1 段目は字下げしない
  if (indent > 0) return null;
  if (!/^["'([]?[A-Z0-9]/.test(trimmed)) return null;

  // 1 段目は A から始まり、1 つずつ進む
  const expected = previousLetter ? String.fromCharCode(previousLetter.charCodeAt(0) + 1) : 'A';
  if (letter !== expected) return null;
  // `Appendix` と書いていない 1 文字の見出しは、A から始まるものだけ認める。
  // 本文の "B. Smith" のような行を拾わないため。
  if (!explicit && !previousLetter && letter !== 'A') return null;

  return { number: letter, title: trimmed };
}

/**
 * `Appendix A.  Title` / `A.1.  Title` / `Appendix A - Title` に当たる。
 */
const APPENDIX_HEADER_PATTERN =
  /^(Appendix\s+)?([A-Z])((?:\.\d+)*)\.?(?:\s*[-–]+\s*|\s{1,3})(\S.*)$/;

/** 下位の付録に許す字下げ。 */
const APPENDIX_MAX_INDENT = 3;

/** 1 段目の節番号に許す飛び。RFC には欠番がある。 */
const MAX_SECTION_NUMBER_GAP = 5;

/** 字下げした見出しの、1 段あたりの字下げ幅。 */
const INDENTED_HEADER_STEP = 3;

/** 字下げ幅の許容差。 */
const INDENTED_HEADER_TOLERANCE = 2;

/**
 * 節番号が、直前の節の次に来る番号か。
 *
 * 字下げした見出しを拾うときに、本文の番号付きリストと区別するための検査である。
 * RFC 6455 §4.1 の `   1.  The handshake MUST be ...` は、直前の節が §4.1 なので
 * "1" は次に来る番号ではない。
 *
 * 次に来る番号とみなすのは 3 通り。
 *
 * - 子: `1.1` のあとの `1.1.1`
 * - 兄弟: `1.1.1` のあとの `1.1.2`
 * - 祖先の兄弟: `1.1.4` のあとの `1.2`
 *
 * 番号の飛びは 5 まで許す（RFC には欠番がある）。
 */
function isSuccessorSectionNumber(previous: string | null, candidate: string): boolean {
  if (!previous) return false;

  const prev = previous.split('.').map(Number);
  const cand = candidate.split('.').map(Number);
  if (prev.some((n) => !Number.isInteger(n)) || cand.some((n) => !Number.isInteger(n)))
    return false;

  if (cand.length === prev.length + 1) {
    return cand.slice(0, prev.length).every((n, i) => n === prev[i]) && cand[cand.length - 1] === 1;
  }

  if (cand.length <= prev.length) {
    const head = cand.length - 1;
    if (!cand.slice(0, head).every((n, i) => n === prev[i])) return false;
    const step = cand[head] - prev[head];
    return step >= 1 && step <= 5;
  }

  return false;
}

/**
 * その行が字下げした節見出しなら、番号と題名を返す。
 *
 * 古い RFC は下位の節見出しを深さに応じて字下げする。RFC 1122 は
 *
 * ```
 * 1.  INTRODUCTION
 *
 *    1.1  The Internet Architecture
 *
 *       1.1.1  Internet Hosts
 * ```
 *
 * と書く。1 桁目の規則だけでは 1 段目の 5 節しか拾えず、130 近い節と
 * その要件が 5 つの節に押し込まれる。
 *
 * 本文の番号付きリストと区別するため、次をすべて満たすときだけ拾う。
 *
 * - 2 段目以降であること（1 段目の見出しは 1 桁目から始まる）
 * - 字下げが深さに見合うこと（1 段につき 3 桁、許容差 2）
 * - 前後が空行
 * - 題名が大文字で始まり、3 文字以上で、読点や句点で終わらない
 * - 直前の節の次に来る番号であること（`isSuccessorSectionNumber`）
 */
function indentedSectionHeader(
  lines: string[],
  index: number,
  previousNumber: string | null
): { number: string; title: string } | null {
  const line = lines[index];
  const indent = line.length - line.trimStart().length;
  if (indent < 1 || indent > 12) return null;

  const match = line.trim().match(SECTION_HEADER_PATTERN);
  if (!match) return null;

  const number = match[1].replace(/\.$/, '');
  const depth = number.split('.').length;
  if (depth < 2) return null;
  if (Math.abs(indent - (depth - 1) * INDENTED_HEADER_STEP) > INDENTED_HEADER_TOLERANCE)
    return null;

  let title = match[2].trim();

  // 題名が読点で終わるときは、次の行が続きである。
  // RFC 1122 §4.2.2.8 の
  //   "4.2.2.8  TCP Connection State Diagram: RFC-793 Section 3.2,"
  //   "   page 23"
  // は 2 行に分かれる。「次の行が空く」だけを課すと §4.2.2.8 から §4.2.2.11 の
  // 4 節が落ちる。
  let end = index;
  const continuation = wrappedHeaderContinuation(lines, index, indent);
  if (continuation !== null) {
    title = `${title} ${continuation}`;
    end = index + 1;
  }

  // 先頭は大文字。引用符や括弧で始まる題名があるので、それは読み飛ばす
  // （RFC 1123 §4.1.4.2 の `"QUOTE" Command`）。
  if (title.length < 3 || !/^["'“([]?[A-Z]/.test(title) || /[.,;]$/.test(title)) return null;
  if (!isValidSectionHeader(number, title)) return null;
  if (!isSuccessorSectionNumber(previousNumber, number)) return null;

  // 見出しの次の行は空く。直前は図や表の行のことがあるので問わない
  // （RFC 1122 §1.4 と §4.2 は図表の直後に置かれている）。
  const after = end + 1 < lines.length ? lines[end + 1] : '';
  if (after.trim() !== '') return null;

  return { number, title };
}

/** 折り返した見出しとみなす続きの行の、最大の長さ。 */
const HEADER_CONTINUATION_MAX_LENGTH = 40;

/**
 * 折り返しが起きたとみなす、見出しの行の最小の幅。
 *
 * RFC のテキストは 72 桁で折り返す。これより短い行は折り返されていないので、
 * 次の行は続きではなく本文である。
 */
const HEADER_WRAP_WIDTH = 60;

/**
 * 見出しの続きの行を返す。続きでなければ `null`。
 *
 * RFC 1122 は出典を題名に書くため、題名が 72 桁で折り返す。
 *
 * ```
 *          4.2.2.9  Initial Sequence Number Selection: RFC-793 Section
 *             3.3, page 27
 *
 *             A TCP MUST use the specified clock-driven selection of
 * ```
 *
 * 「次の行が空く」だけを課すと §4.2.2.8 から §4.2.2.11 の 4 節が落ち、
 * その節の要件が §4.2.2.7 に付く。
 *
 * 折り返しとみなす条件は 3 つ。
 *
 * - 見出しの行が 60 桁以上ある（折り返しが起きる幅に達している）
 * - 次の行が見出しより深く字下げされ、40 文字以下である
 * - その次の行が空く（本文の段落は 2 行目で終わらない）
 */
function wrappedHeaderContinuation(lines: string[], index: number, indent: number): string | null {
  const line = lines[index].replace(/\s+$/, '');
  if (line.length < HEADER_WRAP_WIDTH) return null;

  const next = index + 1 < lines.length ? lines[index + 1] : '';
  const trimmed = next.trim();
  if (trimmed === '' || trimmed.length > HEADER_CONTINUATION_MAX_LENGTH) return null;
  if (next.length - next.trimStart().length <= indent) return null;

  const after = index + 2 < lines.length ? lines[index + 2] : '';
  if (after.trim() !== '') return null;

  return trimmed;
}

/** 中央寄せの見出しとみなす最小の字下げ。 */
const CENTERED_HEADER_MIN_INDENT = 8;

/**
 * その行が中央寄せの節見出しなら、番号と題名を返す。
 *
 * 条件をすべて満たすときだけ見出しとみなす。
 *
 * - 字下げが 8 桁以上
 * - 「番号 + 空白 + 題名」の形で、番号が 1 段（"2." であって "2.1." ではない）
 * - 題名に小文字が無く、3 文字以上
 * - 前後が空行
 */
function centeredSectionHeader(
  lines: string[],
  index: number
): { number: string; title: string } | null {
  const line = lines[index];
  const indent = line.length - line.trimStart().length;
  if (indent < CENTERED_HEADER_MIN_INDENT) return null;

  const match = line.trim().match(SECTION_HEADER_PATTERN);
  if (!match) return null;

  const number = match[1].replace(/\.$/, '');
  if (number.includes('.')) return null;

  const title = match[2].trim();
  if (title.length < 3 || /[a-z]/.test(title)) return null;
  // 1 桁目の見出しと同じ検査を通す。RFC 793 §3.9 の表
  // "0       0     SEG.SEQ = RCV.NXT" は番号が 0 なのでここで落ちる。
  if (!isValidSectionHeader(number, title)) return null;

  const before = index > 0 ? lines[index - 1] : '';
  const after = index + 1 < lines.length ? lines[index + 1] : '';
  if (before.trim() !== '' || after.trim() !== '') return null;

  return { number, title };
}

/**
 * その節番号を、いま新しい節として受け入れてよいか。
 *
 * `SECTION_HEADER_PATTERN` は「数字 + 空白 + 何か」に当たるので、本文の中の
 * 次のような行も節見出しに見える。
 *
 * | RFC | 行 | 実体 |
 * |---|---|---|
 * | 1123 | `1.   Unless there is private agreement between particular resolver and` | 要件一覧表の脚注 |
 * | 1305 | 注釈 `test 1` の折り返しで、閉じ記号だけが残った行 | C の注釈 |
 * | 1305 | `4 is used, this is the size of the clock filter …` | `Section` から折り返した本文 |
 * | 1305 | `1.7 hours and a settling time to within one percent of the initial` | 折り返した本文 |
 *
 * どれも、その番号の節がすでに出たあとに現れる。RFC の節番号は文書の中で
 * 一度しか使われず、前に戻ることもないので、次の 2 つで落とす。
 *
 * - すでに出した番号と同じ
 * - 1 段目の番号が、いままでの最大より小さい
 *
 * RFC 1123 ではこれが実害になっていた。脚注の `1.` を節として受け入れると
 * 直前の節番号が "1" に戻り、`isSuccessorSectionNumber` から見て §6.2 が
 * 「次に来る番号」でなくなる。§6.2 以降の 8 節が丸ごと落ち、その節の要件が
 * §6.1.5 に付いていた。
 */
function acceptsSectionNumber(
  state: { seen: Set<string>; maxTopLevel: number },
  candidate: string
): boolean {
  if (state.seen.has(candidate)) return false;

  // 付録は文字で番号を振る。数字の単調増加の検査は当てはまらない。
  if (/^[A-Z]/.test(candidate)) return true;

  const topLevel = Number(candidate.split('.')[0]);
  if (!Number.isInteger(topLevel)) return false;
  if (state.seen.size > 0 && topLevel < state.maxTopLevel) return false;
  // 1 段目の番号が大きく飛ぶ行は節ではない。
  //
  // RFC 2068 は Warning ヘッダの警告コードを表にして、`99 Miscellaneous warning`
  // を 1 桁目に置く。これを §99 として受け入れると `maxTopLevel` が 99 になり、
  // **そのあとの §14.46・§15・§15.1〜15.9・§16 が丸ごと落ちていた（30 節）。**
  // 節番号は 1 ずつ増える。欠番があっても数個である。
  if (state.seen.size > 0 && topLevel > state.maxTopLevel + MAX_SECTION_NUMBER_GAP) return false;

  return true;
}

function extractTextSections(lines: string[]): Section[] {
  const sections: Section[] = [];
  let currentSection: Section | null = null;
  let currentContent: string[] = [];
  let lastSectionNumber: string | null = null;
  /** すでに節として出した番号と、1 段目の最大値。 */
  const numbering = { seen: new Set<string>(), maxTopLevel: 0 };
  /** 直前に出した付録の文字。付録が A から 1 つずつ進むことの確認に使う。 */
  let lastAppendixLetter: string | null = null;

  const claimSectionNumber = (number: string): void => {
    numbering.seen.add(number);
    numbering.maxTopLevel = Math.max(numbering.maxTopLevel, Number(number.split('.')[0]) || 0);
    lastSectionNumber = number;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    // 古い RFC は上位の節見出しを中央に寄せる（RFC 793 の "2.  PHILOSOPHY"）。
    // 1 桁目の規則だけでは §1 / §2 / §3 が丸ごと落ち、その節の要件が
    // 手前の節に付く。字下げが深く、題名が全部大文字で、前後が空行の
    // 1 段目の見出しだけを拾う。RFC 793 の状態遷移図にある
    // "  2.  SYN-SENT --> ..." は字下げが浅く、小文字を含むので当たらない。
    const candidate: { number: string; title: string } | null =
      centeredSectionHeader(lines, index) ?? indentedSectionHeader(lines, index, lastSectionNumber);
    const header =
      candidate && acceptsSectionNumber(numbering, candidate.number) ? candidate : null;
    if (header) {
      if (currentSection) {
        currentSection.content = createTextBlocks(currentContent.join('\n'));
        sections.push(currentSection);
      }
      currentSection = {
        number: header.number,
        title: header.title,
        content: [],
        subsections: [],
      };
      claimSectionNumber(header.number);
      currentContent = [];
      continue;
    }

    // 節見出しは 1 桁目から始まる。字下げされた行は本文の番号付きリスト項目である。
    //
    // 以前は `line.trim()` してから照合していたため字下げが失われ、
    // RFC 6455 の
    //   "   1.  The handshake MUST be a valid HTTP request ..."
    // のようなリスト項目を節として拾っていた（目次を除いたあとでも 141 節のうち
    // 52 件が節番号の重複だった）。番号だけが同じ「節」がいくつも並ぶと
    // `findSection` がどれを引くか定まらず、要件の `sectionTitle` にも本文の
    // 1 行目が出る。
    // 付録は文字で番号を振る。数字の見出しを試す前に見る。
    const appendix = appendixHeader(line, lastAppendixLetter);
    if (appendix && acceptsSectionNumber(numbering, appendix.number)) {
      if (currentSection) {
        currentSection.content = createTextBlocks(currentContent.join('\n'));
        sections.push(currentSection);
      }
      currentSection = {
        number: appendix.number,
        title: appendix.title,
        content: [],
        subsections: [],
      };
      numbering.seen.add(appendix.number);
      lastAppendixLetter = appendix.number[0];
      currentContent = [];
      continue;
    }

    const match = line.replace(/\s+$/, '').match(SECTION_HEADER_PATTERN);

    if (match) {
      const sectionNum = match[1].replace(/\.$/, '');
      const title = match[2];

      // セクションヘッダーとして妥当性を検証
      // 小文字で始まる題名は、番号が句点で終わるか、直前が空行のときだけ
      // 節とみなす。
      //
      // RFC 896 の本文は "…and would be sent immediately.  The next" のあと
      // "24 characters, arriving from the user at 200ms  intervals,  would"
      // と折り返す。これが番号 24 の節として通っていた。この RFC には節が
      // 1 つも無いので、`get_rfc_structure` はこの 1 件だけを返していた。
      //
      // 2 つの条件はどちらか一方では足りない。
      //
      // | RFC | 行 | 番号の句点 | 直前が空行 |
      // |---|---|---|---|
      // | 7230 §5.3.1 | `5.3.1.  origin-form` | あり | 無し（前ページの最終行が ABNF の `/ asterisk-form`） |
      // | 2616 §3.2.2 | `3.2.2 http URL` | 無し | あり |
      // | 896（本文） | `24 characters, arriving from…` | 無し | 無し |
      //
      // 大文字で始まる題名には課さない。RFC 1122 §1.4 と §4.2 は図表の直後に
      // 置かれており、空行を課すと 123 節が 64 節に減る。
      const startsLowercase = /^[a-z]/.test(title.trim());
      const numberEndsWithPeriod = match[1].endsWith('.');
      const followsBlankLine = (index > 0 ? lines[index - 1] : '').trim() === '';

      if (
        isValidSectionHeader(sectionNum, title) &&
        acceptsSectionNumber(numbering, sectionNum) &&
        (!startsLowercase || numberEndsWithPeriod || followsBlankLine || looksLikeTitleCase(title))
      ) {
        // 前のセクションを保存
        if (currentSection) {
          currentSection.content = createTextBlocks(currentContent.join('\n'));
          sections.push(currentSection);
        }

        // 見出しと本文が 1 行に入っている RFC がある（RFC 1035 §6.4.1 の
        // "6.4.1. The contents of inverse queries and responses          Inverse"）。
        // 4 個以上の空白で切り、残りは本文に回す。
        const [headline, ...rest] = title.split(/ {4,}/);

        // 新しいセクションを開始
        currentSection = {
          number: sectionNum,
          title: headline.trim(),
          content: [],
          subsections: [],
        };
        claimSectionNumber(sectionNum);
        currentContent = rest.length > 0 ? [rest.join(' ').trim()] : [];
      } else if (currentSection) {
        // 検証に失敗した行はコンテンツとして扱う
        currentContent.push(line);
      }
    } else if (currentSection) {
      currentContent.push(line);
    }
  }

  // 最後のセクションを保存
  if (currentSection) {
    currentSection.content = createTextBlocks(currentContent.join('\n'));
    sections.push(currentSection);
  }

  // 番号の付いた見出しが無い RFC は、番号なしの見出しで取り直す。
  if (sections.length < MIN_NUMBERED_SECTIONS) {
    const unnumbered = extractUnnumberedSections(lines);
    if (unnumbered.length > sections.length) return unnumbered;
  }

  // セクションを階層構造に整理
  return organizeSections(sections);
}

/** ここに満たないときは、番号なしの見出しで取り直す。 */
const MIN_NUMBERED_SECTIONS = 2;

/** 番号なしの見出しとみなす行の、文字数・語数・字下げの上限。 */
const UNNUMBERED_HEADER_MAX_LENGTH = 60;
const UNNUMBERED_HEADER_MAX_WORDS = 8;
const UNNUMBERED_HEADER_MAX_INDENT = 12;

/** 番号なしの見出しで取り直すのに必要な、見出しの最小数。 */
const MIN_UNNUMBERED_HEADINGS = 2;

/** 番号なしの見出しで作る階層の深さの上限。 */
const UNNUMBERED_HEADER_MAX_DEPTH = 4;

/**
 * 番号なしの見出しで節を取る。
 *
 * 1980 年代の RFC は節に番号を振らない。
 *
 * ```
 * INTRODUCTION
 *
 *    The purpose of the TELNET Protocol is to provide a fairly general,
 *    bi-directional, eight-bit byte oriented communications facility.
 * ```
 *
 * 番号を頼りにすると 1 つも取れない。実測（1980 年代の RFC 29 本）で
 * 14 本が節 0〜1 だった。RFC 792（ICMP）、RFC 826（ARP）、RFC 854（Telnet）、
 * RFC 894（IP over Ethernet）が含まれる。どれも RFC 1122 や RFC 1123 が
 * 繰り返し参照する文書で、`get_rfc_structure` が何も返していなかった。
 *
 * 見出しとみなす条件は 6 つ。
 *
 * - 前後が空行
 * - 3 文字以上 60 文字以下、8 語以下
 * - 文末記号（`.` `!` `?` `,` `;` `:`）で終わらない
 * - 小文字だけの行ではない
 * - ページの飾り（`RFC 792`）や表の見出しではない
 * - 字下げが 12 桁以内
 *
 * **番号は字下げの深さから作る。** 原文に番号は無いので、`§3.2` はこちらが
 * 振った番号である。RFC 854 は `THE NETWORK VIRTUAL TERMINAL` の下に
 * `TRANSMISSION OF DATA` を 3 桁字下げ、その下に `Interrupt Process (IP)` を
 * 6 桁字下げで置く。文書の見た目だけが唯一の構造である。
 */
function extractUnnumberedSections(lines: string[]): Section[] {
  const candidates = unnumberedHeadings(lines);
  if (candidates.length < MIN_UNNUMBERED_HEADINGS) return [];

  // 字下げの深さを段の深さに直す。値そのものではなく、**そこまでに現れた**
  // 字下げを浅い順に並べた順位を使う。
  //
  // 文書全体の字下げを先に集めると、上位の見出しが後ろに出る文書で番号が
  // 狂う。RFC 855 は `Section 1 - …` を 3 桁字下げで先に並べ、そのあとに
  // 1 桁目の `A Note on "Subnegotiation"` を置く。先に集めると 3 桁が 2 段目に
  // なり、親のない `1.1` から始まってしまう。
  const seen: number[] = [];
  const counters: number[] = [];

  const numberFor = (indent: number): string => {
    if (!seen.includes(indent)) {
      seen.push(indent);
      seen.sort((a, b) => a - b);
    }
    const depth = Math.min(seen.indexOf(indent), UNNUMBERED_HEADER_MAX_DEPTH - 1);
    while (counters.length <= depth) counters.push(0);
    counters.length = depth + 1;
    counters[depth] += 1;
    return counters.map((n) => Math.max(n, 1)).join('.');
  };

  const flat: Section[] = [];
  let current: Section | null = null;
  let content: string[] = [];
  let next = 0;

  for (let index = 0; index < lines.length; index++) {
    if (next < candidates.length && candidates[next].index === index) {
      if (current) {
        current.content = createTextBlocks(content.join('\n'));
        flat.push(current);
      }
      const heading = candidates[next++];
      current = {
        number: numberFor(heading.indent),
        title: heading.title,
        content: [],
        subsections: [],
      };
      content = [];
      continue;
    }
    if (current) content.push(lines[index]);
  }

  if (current) {
    current.content = createTextBlocks(content.join('\n'));
    flat.push(current);
  }

  return organizeSections(flat);
}

/** 番号なしの見出しの候補を、文書に現れる順に返す。 */
function unnumberedHeadings(
  lines: string[]
): Array<{ index: number; indent: number; title: string }> {
  const found: Array<{ index: number; indent: number; title: string }> = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.length < 3 || trimmed.length > UNNUMBERED_HEADER_MAX_LENGTH) continue;
    if (!/^[A-Za-z]/.test(trimmed)) continue;
    if (/[.!?,;:]$/.test(trimmed)) continue;
    if (trimmed.split(/\s+/).length > UNNUMBERED_HEADER_MAX_WORDS) continue;
    if (trimmed === trimmed.toLowerCase()) continue;
    // ページの飾り。RFC 792 はページ見出しを "RFC 792" の 1 行で書くため、
    // 前後が空行になり見出しの条件を満たしてしまう。
    if (/^RFC[\s-]*\d+$/i.test(trimmed)) continue;
    // 表の見出し（RFC 854 の "NAME                  CODE         MEANING"）。
    if (looksLikeDiagram(trimmed)) continue;

    const indent = line.length - line.trimStart().length;
    if (indent > UNNUMBERED_HEADER_MAX_INDENT) continue;

    const before = index > 0 ? lines[index - 1] : '';
    const after = index + 1 < lines.length ? lines[index + 1] : '';
    if (before.trim() !== '' || after.trim() !== '') continue;

    found.push({ index, indent, title: trimmed });
  }

  return found;
}

/**
 * セクションを階層構造に整理
 */
function organizeSections(flatSections: Section[]): Section[] {
  const root: Section[] = [];
  const stack: { section: Section; depth: number }[] = [];

  for (const section of flatSections) {
    const depth = section.number?.split('.').length || 1;

    // スタックを適切な親まで巻き戻し
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(section);
    } else {
      stack[stack.length - 1].section.subsections.push(section);
    }

    stack.push({ section, depth });
  }

  return root;
}

/**
 * テキストからコンテンツブロックを作成
 */
/** 文が途中で終わる段落を、いくつ先まで繋ぐか。 */
const MAX_PARAGRAPH_JOINS = 3;

/**
 * 文の途中で終わっている段落を、次の段落と繋ぐ。
 *
 * RFC は列挙や表示例を空行で挟んで書く。
 *
 * ```
 *       Origin servers that accept byte-range requests MAY send
 *
 *           Accept-Ranges: bytes
 *
 *       but are not required to do so.
 * ```
 *
 * 空行で段落を切ると、要件文が "…MAY send" で終わる。RFC 9110 §9.3.5 の
 * "the origin server SHOULD send" と続く箇条書き、RFC 2616 §8.2.4 の
 * "the client" と続く "- SHOULD NOT continue and" も同じ形である。
 *
 * 図・ABNF で終わる段落は繋がない。`acceptable-ranges = 1#range-unit | "none"` の
 * ように、文末記号が無いのが普通だからである。
 */
/** 表示ブロックの 1 行にある語数の上限。 */
const DISPLAY_BLOCK_MAX_WORDS = 3;

/**
 * 値を並べただけの塊か。
 *
 * RFC 8259 §3 は取りうる値を字下げして並べる。
 *
 * ```
 *    A JSON value MUST be an object, array, number, or string, or one of
 *    the following three literal names:
 *
 *       false
 *       null
 *       true
 *
 *    The literal names MUST be lowercase.  No other literal names are
 *    allowed.
 * ```
 *
 * この塊は文末記号を持たないので、続く段落と繋がれて要件文が
 * "false null true The literal names MUST be lowercase." になっていた。
 *
 * `looksLikeDiagram` は当たらない。ABNF の規則でも罫線でもなく、
 * 空白で桁を揃えてもいない、ただの短い語の並びである。
 */
function looksLikeDisplayBlock(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) return false;
  return lines.every((line) => {
    const trimmed = line.trim();
    if (/[.!?]$/.test(trimmed)) return false;
    return trimmed.split(/\s+/).length <= DISPLAY_BLOCK_MAX_WORDS;
  });
}

function joinUnterminatedParagraphs(paragraphs: string[]): string[] {
  const joined: string[] = [];
  const joinCount: number[] = [];

  for (const paragraph of paragraphs) {
    const last = joined.length - 1;
    const previous = joined[last];
    const canJoin =
      previous !== undefined &&
      !/[.!?:;]\s*$/.test(previous) &&
      !looksLikeDiagram(previous) &&
      !looksLikeDisplayBlock(previous) &&
      joinCount[last] < MAX_PARAGRAPH_JOINS &&
      // どちらかに BCP 14 キーワードがあること。要件に関わらない箇所では繋がない。
      // RFC 3261 §7.3.1 は "is equivalent to" と表示例を交互に並べる。繋ぐと
      // 要件文に "content-disposition: Session;HANDLING=OPTIONAL" が入る。
      (createRequirementRegex().test(previous) || createRequirementRegex().test(paragraph));

    if (canJoin) {
      joined[last] = `${previous}\n${paragraph}`;
      joinCount[last] += 1;
      continue;
    }

    joined.push(paragraph);
    joinCount.push(0);
  }

  return joined;
}

function createTextBlocks(text: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const paragraphs = joinUnterminatedParagraphs(text.split(/\n\s*\n/).filter((p) => p.trim()));

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // 要件マーカーを抽出（XML 経路と同じもの）
    const requirements = extractMarkers(trimmed) as TextBlock['requirements'];

    blocks.push({
      type: 'text',
      content: trimmed,
      requirements,
      crossReferences: extractCrossReferences(trimmed),
    });
  }

  return blocks;
}

/**
 * 定義の抽出（テキストから）
 * 「term - definition」または「term: definition」形式を探す
 */
function extractTextDefinitions(lines: string[]): Definition[] {
  const definitions: Definition[] = [];
  const defPattern = /^\s*([A-Za-z][A-Za-z0-9\s-]*[A-Za-z0-9])\s*[-:]\s+(.+)$/;

  let currentSection = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // セクションを追跡
    const sectionMatch = trimmed.match(SECTION_HEADER_PATTERN);
    if (sectionMatch) {
      currentSection = sectionMatch[1].replace(/\.$/, '');
      continue;
    }

    // 定義パターンを探す
    const defMatch = trimmed.match(defPattern);
    if (defMatch) {
      const term = defMatch[1].trim();
      const definition = defMatch[2].trim();

      // 短すぎる用語や一般的な単語は除外
      if (
        term.length >= DEFINITION_EXTRACTION.MIN_TERM_LENGTH &&
        definition.length >= DEFINITION_EXTRACTION.MIN_DEFINITION_LENGTH
      ) {
        definitions.push({
          term,
          definition,
          section: currentSection,
        });
      }
    }
  }

  return definitions;
}

/**
 * テキストから要件を抽出
 * 共通ユーティリティのラッパー（テキストパース時はparseComponentsをオフ）
 */
export function extractTextRequirements(
  sections: Section[],
  filter?: RequirementFilter
): Requirement[] {
  return extractRequirementsFromSections(sections, filter, { parseComponents: false });
}
