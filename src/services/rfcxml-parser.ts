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
import { compareSectionNumbers, normalizeSectionNumber } from '../utils/section.js';
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
 * 印字されない要素を落とす。
 *
 * `<iref>` は索引の項目、`<cref>` は編集時の注記で、どちらも公開版 RFC の本文には
 * 出ない。ただし `<iref primary="true">` は「その用語をここで定義している」という
 * 目印でもあるため、落とす前に `extractIrefDefinitions()` が読む。
 * この関数は `renderInlineTags()` から分けてあり、パースの直前に適用する。
 */
function stripNonPrinting(xml: string): string {
  return xml
    .replace(/<iref\b[^>]*\/>/gi, '')
    .replace(/<iref\b[^>]*>[\s\S]*?<\/iref>/gi, '')
    .replace(/<cref\b[^>]*\/>/gi, '')
    .replace(/<cref\b[^>]*>[\s\S]*?<\/cref>/gi, '');
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
  const inlineRendered = renderInlineTags(renderXrefTags(normalizeBcp14Tags(xml)));
  const normalizedXml = stripNonPrinting(inlineRendered);
  const parsed = parser.parse(normalizedXml);
  const rfc = parsed.rfc || parsed;

  return {
    metadata: extractMetadata(rfc),
    sections: extractSections(rfc.middle?.section || []),
    references: extractReferences(rfc.back?.references || []),
    definitions: mergeDefinitions(extractDefinitions(rfc), extractIrefDefinitions(inlineRendered)),
  };
}

/**
 * メタデータ抽出
 */
function extractMetadata(rfc: RfcXml): ParsedRFC['metadata'] {
  const front = rfc.front || {};

  return {
    title: extractProse(front.title) || 'Untitled',
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
      title: extractProse(sec.name) || 'Untitled Section',
      content: extractContent(sec),
      subsections: extractSections(sec.section),
    })
  );
}

/**
 * コンテンツブロックの抽出
 */
/** 文の続きとして繋ぐ要素を、いくつ先まで見るか。 */
const MAX_CONTINUATION_BLOCKS = 3;

/** 文の続きとして取り込む表示例の最大の長さ。これを超えるものは独立した図とみなす。 */
const INLINE_EXAMPLE_MAX_LENGTH = 120;

/** `pn="section-9.3.5-4"` の末尾の連番。 */
function paragraphOrder(pn: string | undefined): number | null {
  const match = /-(\d+)$/.exec(pn ?? '');
  return match ? Number(match[1]) : null;
}

/** 節の中の要素を、文書に現れる順に並べたもの。 */
interface OrderedElement {
  order: number;
  kind: 'text' | 'list' | 'sourcecode' | 'artwork';
  node: XmlNode;
  text: string;
  items?: string[];
  style?: 'symbols' | 'numbers';
  language?: string;
}

/**
 * 節の直下の要素を `pn` の連番順に並べる。
 *
 * `preserveOrder: false` で動かしているため、木からは `<t>` と `<ul>` の並び順が
 * 失われる。公開版 RFCXML は `pn="section-9.3.5-4"` の形で連番を持つので、
 * それで並べ直す。連番を持たない要素が 1 つでもあれば並べ直しをあきらめて
 * `null` を返す（公開前の RFCXML）。
 */
function orderedElements(section: XmlNode): OrderedElement[] | null {
  const elements: OrderedElement[] = [];

  const push = (node: XmlNode, element: Omit<OrderedElement, 'order' | 'node'>): void => {
    const order = paragraphOrder(node['@_pn']);
    if (order === null) throw new Error('no pn');
    elements.push({ order, node, ...element });
  };

  try {
    for (const t of toArray(section.t)) push(t, { kind: 'text', text: extractProse(t) });
    for (const list of toArray(section.ul)) {
      push(list, {
        kind: 'list',
        text: '',
        style: 'symbols',
        items: toArray(list.li).map((li) => extractProse(li)),
      });
    }
    for (const list of toArray(section.ol)) {
      push(list, {
        kind: 'list',
        text: '',
        style: 'numbers',
        items: toArray(list.li).map((li) => extractProse(li)),
      });
    }
    for (const code of toArray(section.sourcecode)) {
      push(code, { kind: 'sourcecode', text: extractText(code), language: code['@_type'] });
    }
    for (const art of toArray(section.artwork)) {
      push(art, { kind: 'artwork', text: extractText(art) });
    }
  } catch {
    return null;
  }

  return elements.sort((a, b) => a.order - b.order);
}

/**
 * 文の途中で終わる段落に、直後の要素を取り込む。
 *
 * RFC は 1 つの文を「文 + 箇条書き」や「文 + 表示例 + 文」に分けて書く。
 *
 * ```xml
 * <t pn="section-9.3.5-4">... the origin server <bcp14>SHOULD</bcp14> send</t>
 * <ul pn="section-9.3.5-5"><li>a 202 (Accepted) status code if ...</li>...</ul>
 * ```
 *
 * ```xml
 * <t pn="section-14.3-8">A server that does not support any kind of range
 *   request ... <bcp14>MAY</bcp14> send</t>
 * <sourcecode pn="section-14.3-9">Accept-Ranges: none</sourcecode>
 * <t pn="section-14.3-10">to advise the client not to attempt a range request ...</t>
 * ```
 *
 * `<t>` だけを要件文にすると "the origin server SHOULD send" で終わる。
 *
 * **取り込んだ要素は消す。** 残すと、その中の要件が「単独の段落」と「繋いだ段落」の
 * 2 か所から出て、ほとんど同じ文が 2 件並ぶ。
 *
 * **BCP 14 キーワードを含む段落だけを繋ぐ。** RFC 9110 §6.6.1 の
 * `<t>An example is</t>` のような表示例の見出しは文末記号が無いのが普通で、
 * 繋ぐと要件文の頭に "An example is Date: Tue, 15 Nov 1994 08:12:31 GMT" が付く。
 */
function mergeContinuations(elements: OrderedElement[]): OrderedElement[] {
  const merged: OrderedElement[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < elements.length; i++) {
    if (consumed.has(i)) continue;

    const element = elements[i];
    if (element.kind !== 'text') {
      merged.push(element);
      continue;
    }

    let text = element.text;
    const hasKeyword = createRequirementRegex().test(text);

    for (let step = 1; hasKeyword && step <= MAX_CONTINUATION_BLOCKS; step++) {
      if (/[.!?:;]$/.test(text)) break;

      const next = elements[i + step];
      if (!next || consumed.has(i + step)) break;

      if (next.kind === 'list') {
        const items = (next.items ?? []).filter((item) => item.length > 0);
        if (items.length === 0) break;
        text = `${text} ${items.join('; ').replace(/[;,]?\s*$/, '')}.`;
        consumed.add(i + step);
        break;
      }

      const rendered = extractProse(next.text);
      if (!rendered) break;
      if (next.kind !== 'text' && rendered.length > INLINE_EXAMPLE_MAX_LENGTH) break;

      text = `${text} ${rendered}`;
      consumed.add(i + step);
    }

    merged.push({ ...element, text });
  }

  return merged;
}

/**
 * コンテンツブロックの抽出
 */
function extractContent(section: XmlNode): ContentBlock[] {
  const ordered = orderedElements(section);
  if (!ordered) return extractContentUnordered(section);

  const blocks: ContentBlock[] = [];

  for (const element of mergeContinuations(ordered)) {
    if (element.kind === 'text') {
      if (element.text) blocks.push(createTextBlock(element.text, element.node));
    } else if (element.kind === 'list') {
      blocks.push({
        type: 'list',
        style: element.style ?? 'symbols',
        items: (element.items ?? []).map((content) => ({
          content,
          requirements: extractRequirementMarkers(content),
        })),
      });
    } else if (element.kind === 'sourcecode') {
      blocks.push({ type: 'sourcecode', language: element.language, content: element.text });
    } else {
      blocks.push({ type: 'artwork', content: element.text });
    }
  }

  return blocks;
}

/** `pn` を持たない RFCXML 用。並べ直さず、種類ごとに出す。 */
function extractContentUnordered(section: XmlNode): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  for (const t of toArray(section.t)) {
    const text = extractProse(t);
    if (text) blocks.push(createTextBlock(text, t));
  }

  for (const [lists, style] of [
    [toArray(section.ul), 'symbols'],
    [toArray(section.ol), 'numbers'],
  ] as const) {
    for (const list of lists) {
      blocks.push({
        type: 'list',
        style,
        items: toArray(list.li).map((li) => {
          const content = extractProse(li);
          return { content, requirements: extractRequirementMarkers(content) };
        }),
      });
    }
  }

  for (const code of toArray(section.sourcecode)) {
    blocks.push({ type: 'sourcecode', language: code['@_type'], content: extractText(code) });
  }

  for (const art of toArray(section.artwork)) {
    blocks.push({ type: 'artwork', content: extractText(art) });
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
    const sectionName = extractProse(refSection.name)?.toLowerCase() || '';
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
    title: extractProse(front.title) || '',
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
          const term = extractProse(dts[i]);
          const definition = extractProse(dds[i]);

          if (term && isMeaningfulDefinition(definition)) {
            definitions.push({
              term: normalizeTerm(term),
              definition,
              section: normalizeSectionNumber(section),
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
          if (isIndexSection(sec)) continue;
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

/**
 * `<iref primary="true">` が付いた段落から定義を取り出す。
 *
 * v0.6.5 までは `<dl>` だけを見ていた。用語を `<dl>` で並べる RFC（RFC 9114 §2.2
 * "Terminology"）では取れるが、地の文で定義する RFC では 1 件も取れない。
 * RFC 9110 の `get_definitions` が返す 26 件は §14.6（メディア型登録の記入欄）と
 * §16.3.1（フィールド名登録の記入欄）で、`resource` `client` `server` `cache`
 * といった同文書の用語は 1 件も入っていなかった。
 *
 * RFCXML では、用語を定義している箇所に `<iref primary="true">` が置かれる。
 *
 * ```xml
 * <section anchor="caches" pn="section-3.8">
 *   <name>Caches</name>
 *   <iref primary="true" item="cache" pn="iref-cache-42"/>
 *   <t pn="section-3.8-1">
 *    A "cache" is a local store of previous response messages and the
 *    subsystem that controls its message storage, retrieval, and deletion. …
 * ```
 *
 * `primary="true"` が定義箇所、`primary="false"` は単なる言及である。
 * `subitem` を持つものは索引の下位項目（item="header fields" subitem="Content-Type"）
 * なので採らない。RFC 9110 では 414 個の `primary="true"` のうち、`subitem` の無い
 * ものが 162 個あり、これが同文書の用語一覧にあたる。
 *
 * 定義本文は、その `<iref>` を含む段落、または直後の段落を丸ごと採る。1 つの段落が
 * 複数の用語を定義していることがあり（§3.3 は `client` `server` `connection` の
 * 3 語）、その場合は同じ本文が 3 件に付く。段落より細かく切ると、定義の条件節が
 * 落ちる。
 *
 * 節は `<t>` の `pn`（"section-3.8-1"）から末尾の連番を外して求める。`<dl>` 経路が
 * 返す `sec['@_pn']` と同じ形になる。
 *
 * この関数はパース前の文字列を見る。`fast-xml-parser` は `preserveOrder: false` で
 * 動くため、木からは `<iref>` と `<t>` の並び順が失われるためである。
 */
export function extractIrefDefinitions(xml: string): Definition[] {
  const definitions: Definition[] = [];
  const seen = new Set<string>();

  // `<t ...>` の開始位置を先に集めておく（線形に走査するため）
  const paragraphs: Array<{ open: number; contentStart: number; tag: string }> = [];
  for (const m of xml.matchAll(/<t\b[^>]*>/g)) {
    paragraphs.push({ open: m.index, contentStart: m.index + m[0].length, tag: m[0] });
  }

  for (const m of xml.matchAll(/<iref\b([^>]*)\/>/g)) {
    const attrs = m[1];
    if (attributeOf(attrs, 'primary')?.toLowerCase() !== 'true') continue;
    if (attributeOf(attrs, 'subitem')) continue;

    const term = attributeOf(attrs, 'item')?.trim();
    if (!term) continue;

    const paragraph = definingParagraph(xml, paragraphs, m.index, m.index + m[0].length, term);
    if (!paragraph) continue;

    const definition = extractProse(stripTags(paragraph.body));
    if (definition.length < DEFINITION_MIN_LENGTH) continue;

    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    definitions.push({
      term: normalizeTerm(term),
      definition,
      section: normalizeSectionNumber(paragraph.section),
    });
  }

  return definitions;
}

/** 定義本文として採る最小の長さ。これ未満は目印だけで中身が無い。 */
const DEFINITION_MIN_LENGTH = 10;

/** 中身の無い定義。IANA 登録票の記入欄は空欄を "N/A" と書く。 */
const EMPTY_DEFINITIONS = new Set(['n/a', 'na', 'none', 'not applicable', '-', '--']);

/**
 * 定義として返す値があるか。
 *
 * RFC 9110 §14.6 の登録票は `Optional parameters: N/A` のように空欄を埋める。
 * これを定義として返しても何も伝えていない。
 */
function isMeaningfulDefinition(definition: string): boolean {
  const trimmed = definition.trim();
  if (trimmed.length < 3) return false;
  return !EMPTY_DEFINITIONS.has(trimmed.toLowerCase());
}

/**
 * 用語の表記をそろえる。
 *
 * `<dl>` の `<dt>` は "stream:" のように末尾にコロンを置き、引用符で括ることもある
 * （RFC 9110 §8.8.3.2 の `"Strong comparison":`）。用語そのものではないので落とす。
 * 完全一致で引く利用者が当たらなくなるためである。
 */
function normalizeTerm(term: string): string {
  return term
    .replace(/\s*:\s*$/, '')
    .replace(/^["\u201c](.*)["\u201d]$/, '$1')
    .trim();
}

/** 属性を並び順に依存せず読む。RFC ごとに `item` と `primary` の順が違う。 */
function attributeOf(attrs: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(attrs)?.[1];
}

/** 用語を含む段落を探すときに、同じ節の中で何段落先まで見るか。 */
const DEFINITION_LOOKAHEAD = 4;

/**
 * その用語を定義している段落を返す。
 *
 * 起点は `<iref>` を含む段落、`<iref>` が段落の外（節の直下）にあるときは直後の
 * 段落である。起点に用語そのものが出てこないときは、同じ節の中を数段落先まで見て、
 * 用語を含む最初の段落を採る。
 *
 * 節の直下に `<iref>` を置き、その節の導入を 1 段落挟んでから定義を書く RFC が
 * あるためである。RFC 9110 §7.7 はその形で、v0.6.6 は導入の段落を返していた。
 *
 * ```xml
 * <section pn="section-7.7"><name>Message Transformations</name>
 *   <iref primary="true" item="transforming proxy"/>
 *   <t pn="section-7.7-1">Some intermediaries include features for transforming …</t>
 *   <t pn="section-7.7-2">An HTTP-to-HTTP proxy is called a "transforming proxy" if …</t>
 * ```
 *
 * 用語を含む段落が見つからないときは起点に戻す。節の題名が用語そのもので、
 * 本文が代名詞で受けている場合があり、そこで何も返さないより起点の段落を返す方が
 * 手掛かりになる。
 */
function definingParagraph(
  xml: string,
  paragraphs: Array<{ open: number; contentStart: number; tag: string }>,
  irefStart: number,
  irefEnd: number,
  term: string
): { body: string; section: string } | undefined {
  const take = (index: number): { body: string; section: string } | undefined => {
    const p = paragraphs[index];
    const close = xml.indexOf('</t>', p.contentStart);
    if (close === -1) return undefined;
    return {
      body: xml.slice(p.contentStart, close),
      section: sectionOfParagraph(xml, p),
    };
  };

  // 起点を決める。直前の `<t>` が閉じる前に `<iref>` があれば、その段落の中にいる。
  let start = -1;
  let previous = -1;
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].open > irefStart) break;
    previous = i;
  }
  if (previous >= 0 && xml.indexOf('</t>', paragraphs[previous].contentStart) > irefStart) {
    start = previous;
  } else {
    start = paragraphs.findIndex((p) => p.open >= irefEnd);
  }
  if (start < 0) return undefined;

  const first = take(start);
  if (!first) return undefined;

  const needle = term.toLowerCase();
  if (extractProse(stripTags(first.body)).toLowerCase().includes(needle)) return first;

  // 起点に用語が出てこない。同じ節の中を数段落先まで見る。
  for (let i = start + 1; i < Math.min(start + 1 + DEFINITION_LOOKAHEAD, paragraphs.length); i++) {
    const candidate = take(i);
    if (!candidate) break;
    if (candidate.section !== first.section) break;
    if (extractProse(stripTags(candidate.body)).toLowerCase().includes(needle)) return candidate;
  }

  return first;
}

/**
 * 段落が属する節の識別子。
 *
 * `pn="section-3.8-1"` の末尾の連番を外して "section-3.8" にする。`pn` が無い
 * 公開前の RFCXML では、直前の `<section>` の `anchor` / `pn` を使う。
 */
function sectionOfParagraph(xml: string, paragraph: { open: number; tag: string }): string {
  const pn = attributeOf(paragraph.tag, 'pn');
  if (pn) return pn.replace(/-\d+$/, '');

  const before = xml.lastIndexOf('<section', paragraph.open);
  if (before === -1) return '';
  const tagEnd = xml.indexOf('>', before);
  const attrs = xml.slice(before, tagEnd === -1 ? before : tagEnd);
  return attributeOf(attrs, 'pn') ?? attributeOf(attrs, 'anchor') ?? '';
}

/** 残っているタグを落として素テキストにする。 */
function stripTags(fragment: string): string {
  return decodeXmlEntities(fragment.replace(/<[^>]*>/g, ' '));
}

/**
 * 文字実体参照を戻す。木を経由しない経路（`extractIrefDefinitions`）では
 * パーサの復号が効かないため、ここで行う。
 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * `<dl>` 由来と `<iref>` 由来の定義を、用語が重ならないように繋ぐ。
 *
 * 同じ用語が両方にあるときは `<dl>` を採る。`<dt>`/`<dd>` は用語と定義の対として
 * 書かれているのに対し、`<iref>` の側は定義箇所の段落を丸ごと採るため、条件節や
 * 前置きが混じる。
 *
 * 並びは節番号順にする。2 つの経路にまたがると文書の順序が失われ、RFC 9110 では
 * §14.6（メディア型登録の記入欄）が §3.1 の "resource" より前に出ていた。
 */
function mergeDefinitions(fromLists: Definition[], fromIrefs: Definition[]): Definition[] {
  const seen = new Set(fromLists.map((d) => d.term.toLowerCase()));
  const merged = [...fromLists];

  for (const definition of fromIrefs) {
    const key = definition.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(definition);
  }

  return merged.sort((a, b) => compareSectionNumbers(a.section, b.section));
}

/**
 * 自動生成される索引（Index）の節かどうか。
 *
 * 索引は用語ごとに出現箇所を並べた `<dl>` を持つため、定義として拾われていた。
 * RFC 9114 は 112 件の「定義」のうち 32 件が索引項目だった。
 *
 * ```json
 * { "term": "control stream",
 *   "definition": "Section 2, Paragraph 3; Section 3.2, Paragraph 4; …" }
 * ```
 *
 * 目印は `<name>` が "Index" であること。索引の節には anchor が付かず、
 * `pn` は `section-appendix.c` のように連番になるため当てにできない。
 * 後付録（`<back>`）ごと除外はしない。RFC 9114 の Appendix A.2.5 のように、
 * 本物の定義が後付録に置かれることがある。
 */
function isIndexSection(section: XmlNode): boolean {
  return extractProse(section.name).toLowerCase() === 'index';
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
/**
 * 散文（`<t>` / 題名 / リスト項目 / 定義）のテキストを取り出し、空白を 1 個に畳む。
 *
 * XML の折り返しと字下げがそのまま残ると、要件文が
 * "They            MAY\n also be sent" のようになる。インライン要素を素テキストへ
 * 置き換えると、要素が独立した行に置かれていた分の字下げが残るためである
 * （RFC 9114 では要件の 96% に 4 個以上の連続空白があった）。
 *
 * 段落の中の改行と字下げは表示上のもので、意味を持たない。公開版 RFC も 72 桁で
 * 組み直している。畳んで 1 行の散文として返す。
 *
 * **`<sourcecode>` と `<artwork>` には使わないこと。** それらは空白が意味を持つ。
 */
function extractProse(node: XmlNode | string | number | undefined | null): string {
  return extractText(node).replace(/\s+/g, ' ').trim();
}

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
