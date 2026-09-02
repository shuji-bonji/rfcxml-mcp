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
 * インライン要素を、RFC が実際に印字する文字列へ置き換える。
 *
 * `<xref>` と同じ理由（`preserveOrder: false` により位置ごと落ちる）で、
 * `<tt>` `<em>` `<strong>` `<sup>` なども本文から消えていた。
 * RFC 9114 の "HEADERS<tt>...</tt>frame" が "HEADERSframe" のように語が繋がり、
 * RFC 9293 の "2<sup>32</sup> - 1" が "2- 1" になっていた。
 *
 * 置き換えは公開版 RFC の .txt での印字に合わせる。
 *
 * | 要素 | 印字 |
 * |---|---|
 * | `<tt>X</tt>` | `X` |
 * | `<em>X</em>` | `_X_` |
 * | `<strong>X</strong>` | `*X*` |
 * | `<sup>X</sup>` | `^X` |
 * | `<sub>X</sub>` | `_X` |
 * | `<contact fullname="N"/>` | `N` |
 * | `<eref target="U"/>` | `U`（`brackets="angle"` なら `<U>`） |
 * | `<iref/>` `<cref>` | （何も出さない） |
 */
function renderInlineTags(xml: string): string {
  const wrappers: Array<{ tag: string; prefix: string; suffix: string }> = [
    // `<tt>` を引用符で囲む RFC もあるが（RFC 8949 / 9000）、囲まない RFC も
    // ある（RFC 9114 / 9113）。公開版 10 本で測ると、囲まない方が一致率が高い
    // （99.3% 対 98.7%）ので素のまま出す。
    { tag: 'tt', prefix: '', suffix: '' },
    { tag: 'em', prefix: '_', suffix: '_' },
    { tag: 'strong', prefix: '*', suffix: '*' },
    { tag: 'sup', prefix: '^', suffix: '' },
    { tag: 'sub', prefix: '_', suffix: '' },
    { tag: 'u', prefix: '', suffix: '' },
    { tag: 'spanx', prefix: '', suffix: '' },
  ];

  let result = xml;

  // 索引・編集注記は印字されない
  result = result
    .replace(/<iref\b[^>]*\/>/gi, '')
    .replace(/<iref\b[^>]*>[\s\S]*?<\/iref>/gi, '')
    .replace(/<cref\b[^>]*\/>/gi, '')
    .replace(/<cref\b[^>]*>[\s\S]*?<\/cref>/gi, '');

  // 人名
  result = result.replace(/<contact\b([^>]*)\/>/gi, (_m, attrs: string) => {
    const fullname = /\bfullname="([^"]*)"/i.exec(attrs);
    return fullname ? fullname[1] : '';
  });

  // 外部リンク
  result = result
    .replace(/<eref\b([^>]*)>([\s\S]*?)<\/eref>/gi, (_m, _attrs: string, inner: string) =>
      inner.trim()
    )
    .replace(/<eref\b([^>]*)\/>/gi, (_m, attrs: string) => {
      const target = /\btarget="([^"]*)"/i.exec(attrs);
      if (!target) return '';
      const brackets = /\bbrackets="([^"]*)"/i.exec(attrs);
      return brackets?.[1] === 'angle' ? `&lt;${target[1]}&gt;` : target[1];
    });

  // 入れ子（`<strong><em>X</em></strong>`）を内側から解くため、順に適用する
  for (const { tag, prefix, suffix } of wrappers) {
    result = result.replace(
      new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'),
      (_m, inner: string) => `${prefix}${inner}${suffix}`
    );
  }

  return result;
}

/**
 * `<xref>` を、RFC が実際に印字する文字列へ置き換える。
 *
 * パーサは `preserveOrder: false` で動くため、インライン要素は本文テキストから
 * 位置ごと落ちる。`(<xref .../>)` は `()` だけが残っていた（RFC 9110 §9.3.1 の
 * "request smuggling attack ()."）。BCP 14 タグと同じく、パース前に素テキストへ
 * 置き換えることで位置を保ったまま解決する。
 *
 * 置き換え規則は RFCXML の `format` / `sectionFormat` 属性に従う。公開版 RFCXML は
 * `derivedContent` に印字用の文字列（節なら "Section 5.6.7"、参考文献なら "19" や
 * "HTTP/1.1" といった書誌ラベル）を持つ。
 *
 * | format    | 印字 |
 * |---|---|
 * | `none`    | 要素の中身のみ |
 * | `title`   | 対象の題名（要素の中身） |
 * | `counter` | 番号だけ（"3.7.1"） |
 * | `default` | 下記 `sectionFormat` に従う |
 *
 * | sectionFormat | 印字（`section` 属性があるとき） |
 * |---|---|
 * | `bare`   | "3.4"（前後の地の文が "Section" を書く） |
 * | `of`     | "Section 11.2 of [HTTP/1.1]" |
 * | `comma`  | "[HTTP/1.1], Section 11.2" |
 * | `parens` | "[HTTP/1.1] (Section 11.2)" |
 */
function renderXrefTags(xml: string): string {
  const attrOf = (attrs: string, name: string): string => {
    const m = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(attrs);
    return m ? m[1].trim() : '';
  };

  // 節アンカー（"section-3.5"）と裸の節番号（"3.5"）を節番号に正規化する。
  const sectionNumberOf = (target: string): string | null => {
    const bare = target.replace(/^section-/i, '');
    return /^\d+(\.\d+)*$/.test(bare) ? bare : null;
  };

  // "Section 5.6.7" や "Appendix A" は、それ自体が印字形。
  // それ以外（"19" や "HTTP/1.1"）は書誌ラベルなので角括弧で括る。
  const asLabel = (derived: string, target: string): string => {
    if (!derived) {
      // 公開前の RFCXML には derivedContent が無い。節を指すものは自力で組み立てる。
      const sectionNumber = sectionNumberOf(target);
      if (sectionNumber) return `Section ${sectionNumber}`;
    }

    const text = derived || target;
    if (!text) return '';
    return /^(Section|Appendix|Table|Figure)\b/i.test(text) ? text : `[${text}]`;
  };

  const render = (attrs: string, inner?: string): string => {
    const innerText = inner?.trim() ?? '';
    const format = (attrOf(attrs, 'format') || 'default').toLowerCase();
    const derived = attrOf(attrs, 'derivedContent');
    const target = attrOf(attrs, 'target');

    if (format === 'none') return innerText;
    if (format === 'title') return innerText || derived;
    if (format === 'counter') return derived || innerText;

    const section = attrOf(attrs, 'section');
    if (section) {
      const sectionFormat = (attrOf(attrs, 'sectionFormat') || 'of').toLowerCase();
      if (sectionFormat === 'bare') return section;

      // 付録は "Appendix B" と印字される。`derivedLink` の #appendix- が根拠。
      // 属性が無い場合に備えて、番号が数字で始まらないものも付録として扱う。
      const isAppendix = /#appendix-/i.test(attrOf(attrs, 'derivedLink')) || !/^\d/.test(section);
      const word = isAppendix ? 'Appendix' : 'Section';

      const label = asLabel(derived, target);
      if (sectionFormat === 'comma') return `${label}, ${word} ${section}`;
      if (sectionFormat === 'parens') return `${label} (${word} ${section})`;
      return `${word} ${section} of ${label}`;
    }

    const label = asLabel(derived, target);
    if (!label) return innerText;
    if (!innerText) return label;

    // 中身があるときは「中身 + 参照先」の順で印字される。
    //   <xref target="RFC0793" derivedContent="16">RFC 793</xref>
    //     → "RFC 793 [16]"
    //   <xref target="byte.ranges" derivedContent="Section 14.1.2">byte-range requests</xref>
    //     → "byte-range requests (Section 14.1.2)"
    return label.startsWith('[') ? `${innerText} ${label}` : `${innerText} (${label})`;
  };

  return xml
    .replace(/<xref\b([^>]*?)\/>/gi, (_m, attrs: string) => render(attrs))
    .replace(/<xref\b([^>]*)>([\s\S]*?)<\/xref>/gi, (_m, attrs: string, inner: string) =>
      render(attrs, inner)
    );
}

/**
 * RFCXML をパースして構造化データに変換
 */
export function parseRFCXML(xml: string): ParsedRFC {
  // BCP 14 タグとインライン要素を素テキストへ正規化してから解析する。
  // xref を先に解くのは、`<em><xref/></em>` のような入れ子で内側から
  // 組み立てるため。
  const normalizedXml = renderInlineTags(renderXrefTags(normalizeBcp14Tags(xml)));
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
    date: extractPublicationDate(front.date),
  };
}

/** 月名 → 月番号 */
const MONTH_NUMBERS: Record<string, string> = {
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
 * `<front><date month="08" year="2022"/>` から公開年月を取り出す。
 *
 * `month` は数字（"08"）と月名（"August"）の双方があり、`day` は無いことが多い。
 * 判らない部分は付けずに返す（`2022-08` / `2022`）。
 */
export function extractPublicationDate(dateNode: XmlNode | undefined): string | undefined {
  if (!dateNode) return undefined;

  const year = dateNode['@_year'];
  if (!year) return undefined;

  const rawMonth = dateNode['@_month'];
  const day = dateNode['@_day'];

  let month: string | undefined;
  if (rawMonth) {
    const asNumber = /^\d{1,2}$/.test(rawMonth) ? rawMonth.padStart(2, '0') : undefined;
    month = asNumber ?? MONTH_NUMBERS[rawMonth.toLowerCase()];
  }

  if (!month) return String(year);
  if (day && /^\d{1,2}$/.test(day)) return `${year}-${month}-${day.padStart(2, '0')}`;
  return `${year}-${month}`;
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
