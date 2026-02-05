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
  CrossReference,
} from '../types/index.js';

// Re-export types for use in handlers
export type { Section, ParsedRFC };
import { createRequirementRegex } from '../constants.js';
import { extractCrossReferences, toArray } from '../utils/text.js';
import {
  extractRequirementsFromSections,
  type RequirementFilter,
} from '../utils/requirement-extractor.js';

// ========================================
// XML Parser Types
// ========================================

/**
 * fast-xml-parser の出力ノード型
 * XMLパース結果は動的なため、Record型でインデックスアクセスを許可
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XmlNode = Record<string, any>;

/**
 * RFC XML のルート構造
 */
interface RfcXml extends XmlNode {
  '@_docName'?: string;
  '@_number'?: string;
  front?: XmlNode;
  middle?: { section?: XmlNode | XmlNode[] };
  back?: { references?: XmlNode | XmlNode[] };
}

/**
 * XML パーサー設定（メイン: preserveOrder: false）
 * 構造化データの抽出に使用
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
 * BCP 14 タグを正規化
 * <bcp14>MUST</bcp14> → MUST に置換してテキストに統合
 *
 * 複数行にまたがる場合や属性付きの場合も考慮
 */
function normalizeBcp14Tags(xml: string): string {
  // <bcp14>KEYWORD</bcp14> → KEYWORD
  // 属性付きの場合も対応: <bcp14 class="...">KEYWORD</bcp14>
  return xml.replace(/<bcp14[^>]*>([^<]+)<\/bcp14>/gi, '$1');
}

/**
 * RFCXML をパースして構造化データに変換
 */
export function parseRFCXML(xml: string): ParsedRFC {
  // BCP 14 タグを正規化してテキストに統合
  const normalizedXml = normalizeBcp14Tags(xml);
  const parsed = parser.parse(normalizedXml);
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
function extractMetadata(rfc: RfcXml): ParsedRFC['metadata'] {
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
function extractSections(sections: XmlNode | XmlNode[]): Section[] {
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
function extractContent(section: XmlNode): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  // テキストパラグラフ <t>
  const paragraphs = toArray(section.t);
  for (const t of paragraphs) {
    const text = extractText(t);
    if (text) {
      blocks.push(createTextBlock(text, t));
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
 * @param text - 抽出されたテキスト内容
 * @param node - 元のXMLノード（xref抽出用、オプション）
 */
function createTextBlock(text: string, node?: XmlNode): TextBlock {
  // テキストパターンからのクロスリファレンス
  const textRefs = extractCrossReferences(text);

  // XMLのxrefタグからのクロスリファレンス
  const xrefRefs = node ? extractXrefReferences(node) : [];

  // 重複を除いてマージ
  const allRefs = [...textRefs];
  const existingTargets = new Set(textRefs.map((r) => r.target));
  for (const ref of xrefRefs) {
    if (!existingTargets.has(ref.target)) {
      allRefs.push(ref);
    }
  }

  return {
    type: 'text',
    content: text,
    requirements: extractRequirementMarkers(text),
    crossReferences: allRefs,
  };
}

/**
 * XMLノードから<xref>タグを抽出
 * <xref target="section-3.5"/> → セクション参照
 * <xref target="RFC2119"/> → RFC参照
 */
function extractXrefReferences(node: XmlNode): CrossReference[] {
  const refs: CrossReference[] = [];

  function traverse(obj: XmlNode | unknown) {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        traverse(item);
      }
      return;
    }

    const xmlObj = obj as XmlNode;

    // xref要素を検出
    if (xmlObj.xref) {
      const xrefs = toArray(xmlObj.xref);
      for (const xref of xrefs) {
        const target = xref['@_target'];
        if (target) {
          // section-X.Y 形式はセクション参照
          if (target.startsWith('section-') || /^\d+(\.\d+)*$/.test(target)) {
            const sectionNum = target.replace(/^section-/, '');
            refs.push({
              target: sectionNum,
              type: 'section',
              section: sectionNum,
            });
          }
          // RFC参照
          else if (/^RFC\d+$/i.test(target)) {
            refs.push({
              target: target.toUpperCase(),
              type: 'rfc',
            });
          }
          // その他の参照（アンカー等）
          else {
            refs.push({
              target,
              type: 'section',
              section: target,
            });
          }
        }
      }
    }

    // 再帰的に子要素を探索
    for (const key of Object.keys(xmlObj)) {
      if (key.startsWith('@_')) continue; // 属性をスキップ
      traverse(xmlObj[key]);
    }
  }

  traverse(node);
  return refs;
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
function extractReferences(referenceSections: XmlNode | XmlNode[]): ParsedRFC['references'] {
  const result = {
    normative: [] as RFCReference[],
    informative: [] as RFCReference[],
  };

  // 入れ子構造に対応: 外側のreferencesコンテナをフラット化
  function collectReferenceSections(sections: XmlNode | XmlNode[]): XmlNode[] {
    const collected: XmlNode[] = [];
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
      toArray(refSection.referencegroup).flatMap((g: XmlNode) => toArray(g.reference))
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
function parseReference(ref: XmlNode, type: 'normative' | 'informative'): RFCReference {
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
function extractDefinitions(rfc: XmlNode): Definition[] {
  const definitions: Definition[] = [];

  // 再帰的に <dl> を探す
  function findDefinitionLists(obj: XmlNode, section: string = '') {
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
 *
 * Note: <bcp14> タグは parseRFCXML で事前に正規化されるため、
 * この関数では通常のテキストノードとして処理される
 */
function extractText(node: XmlNode | string | number | undefined | null): string {
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
