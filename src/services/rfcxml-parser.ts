/**
 * RFCXML パーサー
 * RFCXML の構造解析と意味的要素の抽出
 */

import { XMLParser } from 'fast-xml-parser';
import type {
  Section,
  Requirement,
  RequirementLevel,
  Definition,
  RFCReference,
  TextBlock,
  ContentBlock,
  ParsedRFC,
} from '../types/index.js';

// Re-export types for use in handlers
export type { Section, ParsedRFC };
import { createRequirementRegex } from '../constants.js';
import { extractCrossReferences, toArray } from '../utils/text.js';
import {
  extractRequirementsFromSections,
  type RequirementFilter,
} from '../utils/requirement-extractor.js';

/**
 * XML パーサー設定
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  preserveOrder: false,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

/**
 * RFCXML をパースして構造化データに変換
 */
export function parseRFCXML(xml: string): ParsedRFC {
  const parsed = parser.parse(xml);
  const rfc = parsed.rfc || parsed;

  return {
    metadata: extractMetadata(rfc),
    sections: extractSections(rfc.middle?.section || []),
    references: extractReferences(rfc.back?.references || []),
    definitions: extractDefinitions(rfc),
  };
}

/**
 * メタデータ抽出
 */
function extractMetadata(rfc: any): ParsedRFC['metadata'] {
  const front = rfc.front || {};

  return {
    title: extractText(front.title) || 'Untitled',
    docName: rfc['@_docName'],
    number: rfc['@_number'] ? parseInt(rfc['@_number'], 10) : undefined,
  };
}

/**
 * セクション構造の抽出
 */
function extractSections(sections: any | any[]): Section[] {
  if (!sections) return [];

  const sectionArray = Array.isArray(sections) ? sections : [sections];

  return sectionArray.map(
    (sec): Section => ({
      anchor: sec['@_anchor'],
      number: sec['@_pn'] || sec['@_numbered'],
      title: extractText(sec.name) || 'Untitled Section',
      content: extractContent(sec),
      subsections: extractSections(sec.section),
    })
  );
}

/**
 * コンテンツブロックの抽出
 */
function extractContent(section: any): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  // テキストパラグラフ <t>
  const paragraphs = toArray(section.t);
  for (const t of paragraphs) {
    const text = extractText(t);
    if (text) {
      blocks.push(createTextBlock(text));
    }
  }

  // リスト <ul>, <ol>, <dl>
  for (const list of toArray(section.ul)) {
    blocks.push({
      type: 'list',
      style: 'symbols',
      items: toArray(list.li).map((li) => {
        const content = extractText(li);
        return {
          content,
          requirements: extractRequirementMarkers(content),
        };
      }),
    });
  }

  for (const list of toArray(section.ol)) {
    blocks.push({
      type: 'list',
      style: 'numbers',
      items: toArray(list.li).map((li) => {
        const content = extractText(li);
        return {
          content,
          requirements: extractRequirementMarkers(content),
        };
      }),
    });
  }

  // ソースコード <sourcecode>
  for (const code of toArray(section.sourcecode)) {
    blocks.push({
      type: 'sourcecode',
      language: code['@_type'],
      content: extractText(code),
    });
  }

  // アートワーク <artwork>
  for (const art of toArray(section.artwork)) {
    blocks.push({
      type: 'artwork',
      content: extractText(art),
    });
  }

  return blocks;
}

/**
 * テキストブロックを作成
 */
function createTextBlock(text: string): TextBlock {
  return {
    type: 'text',
    content: text,
    requirements: extractRequirementMarkers(text),
    crossReferences: extractCrossReferences(text),
  };
}

/**
 * 要件マーカーの抽出（<bcp14> 要素またはテキストから）
 */
function extractRequirementMarkers(text: string): TextBlock['requirements'] {
  const markers: TextBlock['requirements'] = [];
  const regex = createRequirementRegex();

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    markers.push({
      level: match[1] as RequirementLevel,
      position: match.index,
    });
  }

  return markers;
}

/**
 * 要件の完全抽出（文脈付き）
 * 共通ユーティリティのラッパー
 */
export function extractRequirements(
  sections: Section[],
  filter?: RequirementFilter
): Requirement[] {
  return extractRequirementsFromSections(sections, filter, { parseComponents: true });
}

/**
 * 参照の抽出
 */
function extractReferences(referenceSections: any | any[]): ParsedRFC['references'] {
  const result = {
    normative: [] as RFCReference[],
    informative: [] as RFCReference[],
  };

  // 入れ子構造に対応: 外側のreferencesコンテナをフラット化
  function collectReferenceSections(sections: any | any[]): any[] {
    const collected: any[] = [];
    const sectionArray = toArray(sections);

    for (const section of sectionArray) {
      // 直接 reference を持つセクション
      if (section.reference || section.referencegroup) {
        collected.push(section);
      }
      // 入れ子の references を持つ場合（親コンテナ）
      if (section.references) {
        collected.push(...collectReferenceSections(section.references));
      }
    }

    return collected;
  }

  const flatSections = collectReferenceSections(referenceSections);

  for (const refSection of flatSections) {
    // normative/informative の判定: name, anchor, pn, slugifiedName をチェック
    const sectionName = extractText(refSection.name)?.toLowerCase() || '';
    const anchorAttr = (refSection['@_anchor'] || '').toLowerCase();
    const pnAttr = (refSection['@_pn'] || '').toLowerCase();
    const slugAttr = refSection.name?.['@_slugifiedName']?.toLowerCase() || '';

    const isNormative =
      sectionName.includes('normative') ||
      anchorAttr.includes('normative') ||
      pnAttr.includes('normative') ||
      slugAttr.includes('normative');

    const refs = toArray(refSection.reference).concat(
      toArray(refSection.referencegroup).flatMap((g: any) => toArray(g.reference))
    );

    for (const ref of refs) {
      const rfcRef = parseReference(ref, isNormative ? 'normative' : 'informative');
      if (isNormative) {
        result.normative.push(rfcRef);
      } else {
        result.informative.push(rfcRef);
      }
    }
  }

  return result;
}

/**
 * 個別参照のパース
 */
function parseReference(ref: any, type: 'normative' | 'informative'): RFCReference {
  const front = ref.front || {};
  const seriesInfo = toArray(ref.seriesInfo);

  let rfcNumber: number | undefined;
  for (const info of seriesInfo) {
    if (info['@_name'] === 'RFC') {
      rfcNumber = parseInt(info['@_value'], 10);
    }
  }

  return {
    anchor: ref['@_anchor'] || '',
    type,
    rfcNumber,
    title: extractText(front.title) || '',
    target: ref['@_target'],
  };
}

/**
 * 定義の抽出（<dl> 定義リストから）
 */
function extractDefinitions(rfc: any): Definition[] {
  const definitions: Definition[] = [];

  // 再帰的に <dl> を探す
  function findDefinitionLists(obj: any, section: string = '') {
    if (!obj || typeof obj !== 'object') return;

    if (obj.dl) {
      const dls = toArray(obj.dl);
      for (const dl of dls) {
        const dts = toArray(dl.dt);
        const dds = toArray(dl.dd);

        for (let i = 0; i < dts.length; i++) {
          const term = extractText(dts[i]);
          const definition = extractText(dds[i]);

          if (term && definition) {
            definitions.push({
              term,
              definition,
              section,
            });
          }
        }
      }
    }

    // 再帰
    for (const key of Object.keys(obj)) {
      if (key === 'section') {
        const sections = toArray(obj[key]);
        for (const sec of sections) {
          const secNum = sec['@_pn'] || sec['@_anchor'] || '';
          findDefinitionLists(sec, secNum);
        }
      } else if (typeof obj[key] === 'object') {
        findDefinitionLists(obj[key], section);
      }
    }
  }

  findDefinitionLists(rfc);
  return definitions;
}

// ========================================
// ユーティリティ関数
// ========================================

/**
 * テキストコンテンツを抽出（ネストされた要素を含む）
 * 最適化: 配列を1回だけ生成し、文字列結合を最小化
 */
function extractText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node['#text']) return String(node['#text']);

  const parts: string[] = [];

  for (const key of Object.keys(node)) {
    if (key.startsWith('@_')) continue; // 属性をスキップ

    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = extractText(item);
        if (text) parts.push(text);
      }
    } else {
      const text = extractText(value);
      if (text) parts.push(text);
    }
  }

  return parts.join(' ');
}
