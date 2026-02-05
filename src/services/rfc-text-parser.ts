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
    references: {
      normative: [],
      informative: [],
    },
    definitions: extractTextDefinitions(lines),
  };
}

/**
 * メタデータ抽出（テキストから）
 */
function extractTextMetadata(lines: string[], rfcNumber: number): ParsedRFC['metadata'] {
  let title = `RFC ${rfcNumber}`;

  // タイトルを探す（通常は最初の数行にある）
  for (let i = 0; i < Math.min(METADATA_EXTRACTION.MAX_LINES_TO_SCAN, lines.length); i++) {
    const line = lines[i].trim();
    // 空行を挟んで大文字で始まるタイトルっぽい行を探す
    if (
      line.length > METADATA_EXTRACTION.TITLE_MIN_LENGTH &&
      line.length < METADATA_EXTRACTION.TITLE_MAX_LENGTH &&
      !line.includes(':') &&
      !line.match(/^\d/)
    ) {
      // RFC番号の行ではない
      if (!line.toLowerCase().includes('request for comments')) {
        title = line;
        break;
      }
    }
  }

  return {
    title,
    number: rfcNumber,
  };
}

/**
 * セクション構造の抽出（テキストから）
 */
function extractTextSections(lines: string[]): Section[] {
  const sections: Section[] = [];
  let currentSection: Section | null = null;
  let currentContent: string[] = [];

  // セクション番号パターン（例: "1.", "1.1", "1.1.1"）

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(SECTION_HEADER_PATTERN);

    if (match) {
      // 前のセクションを保存
      if (currentSection) {
        currentSection.content = createTextBlocks(currentContent.join('\n'));
        sections.push(currentSection);
      }

      // 新しいセクションを開始
      currentSection = {
        number: match[1].replace(/\.$/, ''),
        title: match[2],
        content: [],
        subsections: [],
      };
      currentContent = [];
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
