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
import {
  createRequirementRegex,
  SECTION_HEADER_PATTERN,
  createRFCReferenceRegex,
} from '../constants.js';
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
    references: extractTextReferences(text, rfcNumber),
    definitions: extractTextDefinitions(lines),
  };
}

/**
 * テキストからRFC参照を抽出
 * テキストでは normative/informative の区別ができないため、すべて informative として扱う
 */
function extractTextReferences(text: string, currentRfcNumber: number): ParsedRFC['references'] {
  const refs: RFCReference[] = [];
  const seenRfcs = new Set<number>();
  const regex = createRFCReferenceRegex();

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const rfcNum = parseInt(match[1], 10);
    // 自己参照と重複を除外
    if (rfcNum !== currentRfcNumber && !seenRfcs.has(rfcNum)) {
      seenRfcs.add(rfcNum);
      refs.push({
        anchor: `RFC${rfcNum}`,
        type: 'informative', // テキストでは区別不可のため informative
        rfcNumber: rfcNum,
        title: `RFC ${rfcNum}`,
      });
    }
  }

  return {
    normative: [],
    informative: refs,
  };
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
    const trimmed = line.trim();
    const match = trimmed.match(SECTION_HEADER_PATTERN);

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
