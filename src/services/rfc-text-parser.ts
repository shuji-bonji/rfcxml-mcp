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
  RequirementLevel,
  RFCReference,
} from '../types/index.js';
import { createRequirementRegex, SECTION_HEADER_PATTERN } from '../constants.js';
import { extractCrossReferences } from '../utils/text.js';
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
  /** タイトルとして有効な最小文字数 */
  TITLE_MIN_LENGTH: 10,
  /** タイトルとして有効な最大文字数 */
  TITLE_MAX_LENGTH: 100,
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
  const lines = text.split('\n');

  return {
    metadata: extractTextMetadata(lines, rfcNumber),
    sections: extractTextSections(lines),
    references: extractTextReferences(lines, rfcNumber),
    definitions: extractTextDefinitions(lines),
  };
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
const REFERENCE_ENTRY_PATTERN = /^ {1,6}\[([^\]\s][^\]]*)\]/;

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
        }
      }
      continue;
    }

    if (!bucket) continue;

    const entry = line.match(REFERENCE_ENTRY_PATTERN);
    if (entry) {
      flush();
      anchor = entry[1].trim();
      buffer = [line];
    } else if (anchor) {
      buffer.push(line);
    }
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

  let rfcNumber: number | undefined;
  const fromAnchor = /^RFC\s*(\d+)$/i.exec(anchor);
  if (fromAnchor) {
    rfcNumber = parseInt(fromAnchor[1], 10);
  } else {
    const inline = [...entry.matchAll(/\bRFC\s+(\d+)\b/g)];
    if (inline.length > 0) {
      rfcNumber = parseInt(inline[inline.length - 1][1], 10);
    }
  }

  const title = /"([^"]+)"/.exec(entry)?.[1].trim() || titleWithoutQuotes(entry);

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
  const parts = entry
    .split(/\.\s+/)
    .map((part) => part.replace(/\.$/, '').trim())
    .filter((part) => part.length > 0);

  if (parts.length < 2) return undefined;

  const longest = parts.reduce((best, part) => (part.length > best.length ? part : best), '');
  if (longest.length < 12) return undefined;

  return longest.slice(0, UNQUOTED_TITLE_MAX_LENGTH).trim();
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

  // 中央寄せなので字下げがある。無ければ題名ではない。
  if (!/^\s/.test(lines[index])) return undefined;

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

function isValidSectionHeader(sectionNum: string, title: string): boolean {
  // 目次の行は節ではない
  if (isTableOfContentsEntry(title)) return false;

  // セクション番号の検証
  const numParts = sectionNum.split('.');
  const depth = numParts.length;

  // 深すぎる階層は除外（通常5レベル以下）
  if (depth > 5) return false;

  // 最初の番号が大きすぎる場合は除外（ステータスコードの可能性）
  // 例: "1000", "1001" はセクション番号ではなくステータスコード
  const firstNum = parseInt(numParts[0], 10);
  if (firstNum > 99) return false;

  // タイトルの検証
  const trimmedTitle = title.trim();

  // タイトルが短すぎる（リスト項目の可能性）
  if (trimmedTitle.length < 3) return false;

  // タイトルが小文字のみで始まる場合（リスト項目の可能性が高い）
  // ただし "a", "an", "the" で始まる正式なタイトルもあるので注意
  if (/^[a-z]/.test(trimmedTitle) && trimmedTitle.length < 20) {
    // 短い小文字始まりの行はセクションタイトルではない可能性が高い
    return false;
  }

  // 典型的なセクションタイトルキーワードをチェック
  const sectionKeywords = [
    'introduction',
    'overview',
    'background',
    'requirements',
    'specification',
    'protocol',
    'format',
    'security',
    'considerations',
    'references',
    'acknowledgments',
    'appendix',
    'terminology',
    'definitions',
    'abstract',
    'scope',
    'normative',
    'informative',
    'implementation',
    'examples',
    'error',
    'status',
    'codes',
    'messages',
    'operations',
  ];

  const lowerTitle = trimmedTitle.toLowerCase();
  for (const keyword of sectionKeywords) {
    if (lowerTitle.includes(keyword)) {
      return true;
    }
  }

  // 大文字で始まり、適度な長さがあればセクションタイトルとして受け入れる
  if (/^[A-Z]/.test(trimmedTitle) && trimmedTitle.length >= 5) {
    return true;
  }

  // それ以外は厳密にチェック
  // セクション番号にドットが含まれる場合はより信頼性が高い（1.1, 2.3 など）
  if (depth >= 2) {
    return true;
  }

  return false;
}

/**
 * セクション構造の抽出（テキストから）
 */
function extractTextSections(lines: string[]): Section[] {
  const sections: Section[] = [];
  let currentSection: Section | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    // 節見出しは 1 桁目から始まる。字下げされた行は本文の番号付きリスト項目である。
    //
    // 以前は `line.trim()` してから照合していたため字下げが失われ、
    // RFC 6455 の
    //   "   1.  The handshake MUST be a valid HTTP request ..."
    // のようなリスト項目を節として拾っていた（目次を除いたあとでも 141 節のうち
    // 52 件が節番号の重複だった）。番号だけが同じ「節」がいくつも並ぶと
    // `findSection` がどれを引くか定まらず、要件の `sectionTitle` にも本文の
    // 1 行目が出る。
    const match = line.replace(/\s+$/, '').match(SECTION_HEADER_PATTERN);

    if (match) {
      const sectionNum = match[1].replace(/\.$/, '');
      const title = match[2];

      // セクションヘッダーとして妥当性を検証
      if (isValidSectionHeader(sectionNum, title)) {
        // 前のセクションを保存
        if (currentSection) {
          currentSection.content = createTextBlocks(currentContent.join('\n'));
          sections.push(currentSection);
        }

        // 新しいセクションを開始
        currentSection = {
          number: sectionNum,
          title: title,
          content: [],
          subsections: [],
        };
        currentContent = [];
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

  // セクションを階層構造に整理
  return organizeSections(sections);
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
function createTextBlocks(text: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // 要件マーカーを抽出
    const requirements: TextBlock['requirements'] = [];
    const regex = createRequirementRegex();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(trimmed)) !== null) {
      requirements.push({
        level: match[1] as RequirementLevel,
        position: match.index,
      });
    }

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
