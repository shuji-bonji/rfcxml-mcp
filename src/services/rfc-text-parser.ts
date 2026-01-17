/**
 * RFC テキストパーサー
 * XMLが利用できない古いRFC用のフォールバック解析
 */

import type {
  Section,
  Requirement,
  RequirementLevel,
  Definition,
  ContentBlock,
  TextBlock,
} from '../types/index.js';
import type { ParsedRFC } from './rfcxml-parser.js';

// BCP 14 / RFC 2119 キーワード
const REQUIREMENT_KEYWORDS: RequirementLevel[] = [
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

const REQUIREMENT_REGEX = new RegExp(`\\b(${REQUIREMENT_KEYWORDS.join('|')})\\b`, 'g');

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
  for (let i = 0; i < Math.min(30, lines.length); i++) {
    const line = lines[i].trim();
    // 空行を挟んで大文字で始まるタイトルっぽい行を探す
    if (line.length > 10 && line.length < 100 && !line.includes(':') && !line.match(/^\d/)) {
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
  const sectionPattern = /^(\d+(?:\.\d+)*\.?)\s+(.+)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(sectionPattern);

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
    let match: RegExpExecArray | null;
    while ((match = REQUIREMENT_REGEX.exec(trimmed)) !== null) {
      requirements.push({
        level: match[1] as RequirementLevel,
        position: match.index,
      });
    }

    blocks.push({
      type: 'text',
      content: trimmed,
      requirements,
      crossReferences: extractTextCrossReferences(trimmed),
    });
  }

  return blocks;
}

/**
 * クロスリファレンスの抽出（テキストから）
 */
function extractTextCrossReferences(text: string): TextBlock['crossReferences'] {
  const refs: TextBlock['crossReferences'] = [];

  // RFC参照
  const rfcPattern = /RFC\s*(\d+)/gi;
  let match;
  while ((match = rfcPattern.exec(text)) !== null) {
    refs.push({
      target: `RFC${match[1]}`,
      type: 'rfc',
    });
  }

  // セクション参照
  const sectionPattern = /[Ss]ection\s+([\d.]+)/g;
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
 * 定義の抽出（テキストから）
 * 「term - definition」または「term: definition」形式を探す
 */
function extractTextDefinitions(lines: string[]): Definition[] {
  const definitions: Definition[] = [];
  const defPattern = /^\s*([A-Za-z][A-Za-z0-9\s-]*[A-Za-z0-9])\s*[-:]\s+(.+)$/;

  let currentSection = '';
  const sectionPattern = /^(\d+(?:\.\d+)*\.?)\s+(.+)$/;

  for (const line of lines) {
    const trimmed = line.trim();

    // セクションを追跡
    const sectionMatch = trimmed.match(sectionPattern);
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
      if (term.length >= 2 && definition.length >= 10) {
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
 */
export function extractTextRequirements(
  sections: Section[],
  filter?: { section?: string; level?: RequirementLevel }
): Requirement[] {
  const requirements: Requirement[] = [];
  let idCounter = 1;

  function processSection(section: Section, path: string) {
    const sectionId = section.number || path;

    if (filter?.section && !sectionId.startsWith(filter.section)) {
      // フィルタリング
    }

    for (const block of section.content) {
      if (block.type === 'text' && block.requirements.length > 0) {
        for (const marker of block.requirements) {
          if (filter?.level && marker.level !== filter.level) {
            continue;
          }

          const sentence = extractSentence(block.content, marker.position);

          requirements.push({
            id: `R-${sectionId}-${idCounter++}`,
            level: marker.level,
            text: sentence.trim(),
            section: sectionId,
            sectionTitle: section.title,
            fullContext: block.content,
          });
        }
      }
    }

    for (const subsection of section.subsections) {
      processSection(subsection, `${sectionId}.${subsection.number || ''}`);
    }
  }

  for (const section of sections) {
    processSection(section, section.number || '');
  }

  return requirements;
}

/**
 * 指定位置を含む文を抽出
 */
function extractSentence(text: string, position: number): string {
  let start = position;
  while (start > 0 && !/[.!?]\s/.test(text.substring(start - 1, start + 1))) {
    start--;
  }

  let end = position;
  while (end < text.length && !/[.!?]/.test(text[end])) {
    end++;
  }

  return text.substring(start, end + 1).trim();
}
