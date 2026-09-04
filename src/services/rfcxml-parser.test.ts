/**
 * rfcxml-parser テスト
 */

import { describe, it, expect } from 'vitest';
import { parseRFCXML, extractRequirements } from './rfcxml-parser.js';

// サンプル RFCXML（最小構造）
const minimalRFCXML = `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9999" docName="draft-test-01">
  <front>
    <title>Test RFC</title>
  </front>
  <middle>
    <section anchor="section-1">
      <name>Introduction</name>
      <t>This is a test paragraph. The client MUST send a request.</t>
      <t>The server SHOULD respond within 5 seconds.</t>
    </section>
    <section anchor="section-2">
      <name>Requirements</name>
      <t>Implementations MAY support optional features.</t>
      <ul>
        <li>The sender MUST NOT exceed the limit.</li>
        <li>The receiver SHOULD validate input.</li>
      </ul>
    </section>
  </middle>
  <back>
    <references anchor="normative-references">
      <name>Normative References</name>
      <reference anchor="RFC2119">
        <front><title>Key words for use in RFCs</title></front>
        <seriesInfo name="RFC" value="2119"/>
      </reference>
    </references>
    <references anchor="informative-references">
      <name>Informative References</name>
      <reference anchor="RFC9000">
        <front><title>QUIC</title></front>
        <seriesInfo name="RFC" value="9000"/>
      </reference>
    </references>
  </back>
</rfc>`;

describe('parseRFCXML', () => {
  it('should parse metadata correctly', () => {
    const result = parseRFCXML(minimalRFCXML);

    expect(result.metadata.title).toBe('Test RFC');
    expect(result.metadata.number).toBe(9999);
    expect(result.metadata.docName).toBe('draft-test-01');
  });

  it('should extract sections', () => {
    const result = parseRFCXML(minimalRFCXML);

    // 本文の 2 節に加えて、参考文献の欄も節として返す。テキスト経路は
    // §19 References を節として返すので、経路をそろえる。
    expect(result.sections).toHaveLength(4);
    expect(result.sections[0].anchor).toBe('section-1');
    expect(result.sections[0].title).toBe('Introduction');
    expect(result.sections[1].anchor).toBe('section-2');
    expect(result.sections[1].title).toBe('Requirements');
    expect(result.sections[2].title).toBe('Normative References');
    expect(result.sections[3].title).toBe('Informative References');
  });

  it('should extract text blocks with requirements', () => {
    const result = parseRFCXML(minimalRFCXML);

    const textBlocks = result.sections[0].content.filter((b) => b.type === 'text');
    expect(textBlocks.length).toBeGreaterThan(0);

    // MUST を含むテキストブロック
    const mustBlock = textBlocks.find((b) => b.type === 'text' && b.content.includes('MUST'));
    expect(mustBlock).toBeDefined();
    if (mustBlock && mustBlock.type === 'text') {
      expect(mustBlock.requirements.some((r) => r.level === 'MUST')).toBe(true);
    }
  });

  it('should extract list blocks', () => {
    const result = parseRFCXML(minimalRFCXML);

    const listBlocks = result.sections[1].content.filter((b) => b.type === 'list');
    expect(listBlocks.length).toBeGreaterThan(0);
  });

  it('should extract normative references', () => {
    const result = parseRFCXML(minimalRFCXML);

    expect(result.references.normative).toHaveLength(1);
    expect(result.references.normative[0].rfcNumber).toBe(2119);
    expect(result.references.normative[0].anchor).toBe('RFC2119');
  });

  it('should extract informative references', () => {
    const result = parseRFCXML(minimalRFCXML);

    expect(result.references.informative).toHaveLength(1);
    expect(result.references.informative[0].rfcNumber).toBe(9000);
  });
});

describe('extractRequirements', () => {
  it('should extract all requirements from sections', () => {
    const result = parseRFCXML(minimalRFCXML);
    const requirements = extractRequirements(result.sections);

    // MUST, SHOULD, MAY, MUST NOT, SHOULD が含まれる
    expect(requirements.length).toBeGreaterThanOrEqual(4);
  });

  it('should categorize requirements by level', () => {
    const result = parseRFCXML(minimalRFCXML);
    const requirements = extractRequirements(result.sections);

    const levels = requirements.map((r) => r.level);
    expect(levels).toContain('MUST');
    expect(levels).toContain('SHOULD');
    expect(levels).toContain('MAY');
    expect(levels).toContain('MUST NOT');
  });

  it('should filter by level', () => {
    const result = parseRFCXML(minimalRFCXML);
    const mustOnly = extractRequirements(result.sections, { level: 'MUST' });

    expect(mustOnly.every((r) => r.level === 'MUST')).toBe(true);
    expect(mustOnly.length).toBeGreaterThan(0);
  });

  it('should include section information', () => {
    const result = parseRFCXML(minimalRFCXML);
    const requirements = extractRequirements(result.sections);

    for (const req of requirements) {
      expect(req.section).toBeDefined();
      expect(req.id).toMatch(/^R-/);
    }
  });

  it('should extract subject from requirement text', () => {
    const result = parseRFCXML(minimalRFCXML);
    const requirements = extractRequirements(result.sections);

    const clientReq = requirements.find((r) => r.subject === 'client');
    expect(clientReq).toBeDefined();

    const serverReq = requirements.find((r) => r.subject === 'server');
    expect(serverReq).toBeDefined();
  });
});

// 入れ子構造の参照テスト
describe('parseRFCXML with nested references', () => {
  const nestedRefsXML = `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9293">
  <front><title>TCP</title></front>
  <middle>
    <section><name>Test</name><t>Test</t></section>
  </middle>
  <back>
    <references>
      <name>References</name>
      <references anchor="sec-normative">
        <name>Normative References</name>
        <reference anchor="RFC793">
          <front><title>TCP Original</title></front>
          <seriesInfo name="RFC" value="793"/>
        </reference>
      </references>
      <references anchor="sec-informative">
        <name>Informative References</name>
        <reference anchor="RFC1122">
          <front><title>Host Requirements</title></front>
          <seriesInfo name="RFC" value="1122"/>
        </reference>
      </references>
    </references>
  </back>
</rfc>`;

  it('should handle nested references structure', () => {
    const result = parseRFCXML(nestedRefsXML);

    expect(result.references.normative.length).toBeGreaterThan(0);
    expect(result.references.informative.length).toBeGreaterThan(0);
    expect(result.references.normative[0].rfcNumber).toBe(793);
    expect(result.references.informative[0].rfcNumber).toBe(1122);
  });
});

// 定義リストのテスト
describe('parseRFCXML definitions', () => {
  const dlXML = `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9999">
  <front><title>Test</title></front>
  <middle>
    <section anchor="terminology">
      <name>Terminology</name>
      <dl>
        <dt>Client</dt>
        <dd>An endpoint that initiates a connection</dd>
        <dt>Server</dt>
        <dd>An endpoint that accepts connections</dd>
      </dl>
    </section>
  </middle>
  <back></back>
</rfc>`;

  it('should extract definitions from dl elements', () => {
    const result = parseRFCXML(dlXML);

    expect(result.definitions.length).toBe(2);
    expect(result.definitions[0].term).toBe('Client');
    expect(result.definitions[0].definition).toContain('initiates');
    expect(result.definitions[1].term).toBe('Server');
  });
});

// BCP14 タグ正規化テスト
describe('parseRFCXML bcp14 tag normalization', () => {
  const bcp14XML = `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9999">
  <front><title>BCP14 Test</title></front>
  <middle>
    <section anchor="section-1">
      <name>Requirements</name>
      <t>A TCP implementation <bcp14>MUST</bcp14> support the TCP Urgent mechanism.</t>
      <t>The client <bcp14>SHOULD NOT</bcp14> send data before the handshake.</t>
      <t>A server <bcp14>MAY</bcp14> ignore certain requests.</t>
      <t>Implementations <bcp14>MUST NOT</bcp14> exceed the specified limits.</t>
    </section>
  </middle>
  <back></back>
</rfc>`;

  it('should include bcp14 keywords in extracted text', () => {
    const result = parseRFCXML(bcp14XML);
    const section = result.sections[0];
    const textBlocks = section.content.filter((b) => b.type === 'text');

    // MUST を含むテキスト
    const mustBlock = textBlocks.find((b) => b.type === 'text' && b.content.includes('MUST'));
    expect(mustBlock).toBeDefined();
    if (mustBlock && mustBlock.type === 'text') {
      expect(mustBlock.content).toContain('MUST');
      expect(mustBlock.content).toContain('TCP implementation');
      expect(mustBlock.content).toContain('support');
    }

    // SHOULD NOT を含むテキスト
    const shouldNotBlock = textBlocks.find(
      (b) => b.type === 'text' && b.content.includes('SHOULD NOT')
    );
    expect(shouldNotBlock).toBeDefined();

    // MAY を含むテキスト
    const mayBlock = textBlocks.find((b) => b.type === 'text' && b.content.includes('MAY'));
    expect(mayBlock).toBeDefined();

    // MUST NOT を含むテキスト
    const mustNotBlock = textBlocks.find(
      (b) => b.type === 'text' && b.content.includes('MUST NOT')
    );
    expect(mustNotBlock).toBeDefined();
  });

  it('should extract requirements with correct text including keywords', () => {
    const result = parseRFCXML(bcp14XML);
    const requirements = extractRequirements(result.sections);

    expect(requirements.length).toBe(4);

    // MUST 要件のテキストにキーワードが含まれる
    const mustReq = requirements.find((r) => r.level === 'MUST' && !r.text.includes('NOT'));
    expect(mustReq).toBeDefined();
    expect(mustReq?.text).toContain('MUST');
    expect(mustReq?.text).toContain('support');

    // SHOULD NOT 要件
    const shouldNotReq = requirements.find((r) => r.level === 'SHOULD NOT');
    expect(shouldNotReq).toBeDefined();
    expect(shouldNotReq?.text).toContain('SHOULD NOT');

    // MAY 要件
    const mayReq = requirements.find((r) => r.level === 'MAY');
    expect(mayReq).toBeDefined();
    expect(mayReq?.text).toContain('MAY');

    // MUST NOT 要件
    const mustNotReq = requirements.find((r) => r.level === 'MUST NOT');
    expect(mustNotReq).toBeDefined();
    expect(mustNotReq?.text).toContain('MUST NOT');
  });

  it('should preserve keyword position in text for requirement detection', () => {
    const result = parseRFCXML(bcp14XML);
    const section = result.sections[0];
    const textBlocks = section.content.filter((b) => b.type === 'text');

    for (const block of textBlocks) {
      if (block.type === 'text' && block.requirements.length > 0) {
        const req = block.requirements[0];
        // キーワードの位置が文中の正しい位置を指していることを確認
        const keywordInText = block.content.substring(
          req.position,
          req.position + req.level.length
        );
        expect(keywordInText).toBe(req.level);
      }
    }
  });
});

// xref タグ抽出テスト
describe('parseRFCXML xref extraction', () => {
  const xrefXML = `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9999">
  <front><title>Xref Test</title></front>
  <middle>
    <section anchor="section-1">
      <name>Introduction</name>
      <t>See <xref target="section-2"/> for details.</t>
      <t>Also reference <xref target="RFC2119"/> for terminology.</t>
      <t>Plain text reference: see Section 3.1 for more info.</t>
    </section>
    <section anchor="section-2">
      <name>Details</name>
      <t>Content here with <xref target="section-1"/>.</t>
    </section>
  </middle>
  <back></back>
</rfc>`;

  it('should extract xref section references', () => {
    const result = parseRFCXML(xrefXML);
    const section1 = result.sections[0];
    const textBlocks = section1.content.filter((b) => b.type === 'text');

    // 最初のテキストブロックからxref参照を抽出
    const firstBlock = textBlocks[0];
    expect(firstBlock.type).toBe('text');
    if (firstBlock.type === 'text') {
      const sectionRefs = firstBlock.crossReferences.filter((r) => r.type === 'section');
      expect(sectionRefs.length).toBeGreaterThan(0);
      expect(sectionRefs.some((r) => r.section === '2')).toBe(true);
    }
  });

  it('should extract xref RFC references', () => {
    const result = parseRFCXML(xrefXML);
    const section1 = result.sections[0];
    const textBlocks = section1.content.filter((b) => b.type === 'text');

    // 2番目のテキストブロックからRFC参照を抽出
    const secondBlock = textBlocks[1];
    expect(secondBlock.type).toBe('text');
    if (secondBlock.type === 'text') {
      const rfcRefs = secondBlock.crossReferences.filter((r) => r.type === 'rfc');
      expect(rfcRefs.length).toBeGreaterThan(0);
      expect(rfcRefs.some((r) => r.target === 'RFC2119')).toBe(true);
    }
  });

  it('should also extract text pattern references', () => {
    const result = parseRFCXML(xrefXML);
    const section1 = result.sections[0];
    const textBlocks = section1.content.filter((b) => b.type === 'text');

    // 3番目のテキストブロックからテキストパターン参照を抽出
    const thirdBlock = textBlocks[2];
    expect(thirdBlock.type).toBe('text');
    if (thirdBlock.type === 'text') {
      const sectionRefs = thirdBlock.crossReferences.filter((r) => r.type === 'section');
      expect(sectionRefs.some((r) => r.section === '3.1')).toBe(true);
    }
  });
});

describe('xref の描画', () => {
  const build = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9999">
  <front><title>Xref Rendering</title><date month="08" year="2022"/></front>
  <middle>
    <section anchor="section-1"><name>Intro</name>${body}</section>
  </middle>
  <back></back>
</rfc>`;

  const textOf = (xml: string): string => {
    const block = parseRFCXML(xml).sections[0].content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? block.content : '';
  };

  it('自己終了タグが空の括弧にならない', () => {
    // 以前は preserveOrder:false により xref が本文から位置ごと落ち、
    // "attack ()." のように括弧だけが残っていた。
    const xml = build(
      '<t>a request smuggling attack (<xref target="HTTP11" section="11.2" format="default" sectionFormat="of" derivedContent="HTTP/1.1"/>).</t>'
    );

    expect(textOf(xml)).toBe('a request smuggling attack (Section 11.2 of [HTTP/1.1]).');
  });

  it('sectionFormat="bare" は節番号だけを出す', () => {
    // 前後の地の文が "Section" を書くため、ここで書くと二重になる
    const xml = build(
      '<t>see GET_MAXSIZES in Section <xref target="RFC1122" section="3.4" sectionFormat="bare" format="default" derivedContent="19"/> of RFC 1122.</t>'
    );

    expect(textOf(xml)).toBe('see GET_MAXSIZES in Section 3.4 of RFC 1122.');
  });

  it('sectionFormat="comma" / "parens" を書き分ける', () => {
    const comma = build(
      '<t>as in <xref target="RFC9112" section="11.2" sectionFormat="comma" format="default" derivedContent="HTTP/1.1"/>.</t>'
    );
    const parens = build(
      '<t>as in <xref target="CACHING" section="5.2" sectionFormat="parens" format="default" derivedContent="CACHING"/>.</t>'
    );

    expect(textOf(comma)).toBe('as in [HTTP/1.1], Section 11.2.');
    expect(textOf(parens)).toBe('as in [CACHING] (Section 5.2).');
  });

  it('付録は Appendix と書く', () => {
    // RFC 9110 は "Appendix B of [RFC7231]" と印字する。
    // 根拠は derivedLink の #appendix-。属性が無い場合は番号が数字で
    // 始まらないことを手がかりにする。
    const byLink = build(
      '<t>deprecated (<xref target="RFC7231" section="B" format="default" sectionFormat="of" derivedLink="https://rfc-editor.org/rfc/rfc7231#appendix-B" derivedContent="RFC7231"/>).</t>'
    );
    const byNumber = build(
      '<t>as defined in <xref target="RFC5234" section="B.1" format="default" sectionFormat="of" derivedContent="RFC5234"/>.</t>'
    );

    expect(textOf(byLink)).toBe('deprecated (Appendix B of [RFC7231]).');
    expect(textOf(byNumber)).toBe('as defined in Appendix B.1 of [RFC5234].');
  });

  it('中身がある xref は「中身 + 参照先」で出す', () => {
    const reference = build(
      '<t>In 1981, <xref target="RFC0793" format="default" sectionFormat="of" derivedContent="16">RFC 793</xref> was released.</t>'
    );
    const section = build(
      '<t>a server that supports <xref target="byte.ranges" format="default" sectionFormat="of" derivedContent="Section 14.1.2">byte-range requests</xref> can send it.</t>'
    );

    expect(textOf(reference)).toBe('In 1981, RFC 793 [16] was released.');
    expect(textOf(section)).toBe(
      'a server that supports byte-range requests (Section 14.1.2) can send it.'
    );
  });

  it('format="counter" は番号だけを出す', () => {
    const xml = build(
      '<t>See item <xref target="section-2.1" format="counter" derivedContent="2.1"/>.</t>'
    );

    expect(textOf(xml)).toBe('See item 2.1.');
  });

  it('format="none" は要素の中身だけを出す', () => {
    const xml = build(
      '<t>a <xref target="status.4xx" format="none" derivedContent="">4xx (Client Error)</xref> status code.</t>'
    );

    expect(textOf(xml)).toBe('a 4xx (Client Error) status code.');
  });

  it('derivedContent が無い節参照は節番号から組み立てる', () => {
    // 公開前の RFCXML には derivedContent が無い
    const xml = build('<t>See <xref target="section-2"/> for details.</t>');

    expect(textOf(xml)).toBe('See Section 2 for details.');
  });

  it('書誌参照は角括弧で括る', () => {
    const xml = build(
      '<t>defined in <xref target="RFC1122" format="default" derivedContent="19"/>.</t>'
    );

    expect(textOf(xml)).toBe('defined in [19].');
  });
});

describe('公開日の抽出', () => {
  const withDate = (dateTag: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9999">
  <front><title>Date Test</title>${dateTag}</front>
  <middle><section anchor="section-1"><name>Intro</name><t>Body.</t></section></middle>
  <back></back>
</rfc>`;

  it('month が数字の場合', () => {
    expect(parseRFCXML(withDate('<date month="08" year="2022"/>')).metadata.date).toBe('2022-08');
  });

  it('month が月名の場合', () => {
    expect(parseRFCXML(withDate('<date month="August" year="2022"/>')).metadata.date).toBe(
      '2022-08'
    );
  });

  it('day があれば日まで返す', () => {
    expect(parseRFCXML(withDate('<date day="3" month="6" year="2022"/>')).metadata.date).toBe(
      '2022-06-03'
    );
  });

  it('year だけなら year だけ返す', () => {
    expect(parseRFCXML(withDate('<date year="2022"/>')).metadata.date).toBe('2022');
  });

  it('date が無ければ undefined', () => {
    expect(parseRFCXML(withDate('')).metadata.date).toBeUndefined();
  });
});

describe('インライン要素の描画', () => {
  const build = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9999">
  <front><title>Inline</title></front>
  <middle>
    <section anchor="section-1"><name>Intro</name>${body}</section>
  </middle>
  <back></back>
</rfc>`;

  const textOf = (xml: string): string => {
    const block = parseRFCXML(xml).sections[0].content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? block.content : '';
  };

  it('tt は素のまま出す', () => {
    // 以前は要素ごと落ちて "format for non-negative" のように語が繋がっていた
    expect(textOf(build('<t>the format <tt>0x1f * N + 0x21</tt> for values</t>'))).toBe(
      'the format 0x1f * N + 0x21 for values'
    );
  });

  it('sup は ^ を付ける', () => {
    // 以前は "2- 1" になっていた
    expect(textOf(build('<t>ranges from 0 to 2<sup>32</sup> - 1.</t>'))).toBe(
      'ranges from 0 to 2^32 - 1.'
    );
  });

  it('em は _ 、strong は * で囲む', () => {
    expect(textOf(build('<t><strong>Note:</strong> see <em>this</em>.</t>'))).toBe(
      '*Note:* see _this_.'
    );
  });

  it('入れ子を内側から解く', () => {
    expect(
      textOf(
        build(
          '<t><strong><em><xref format="default" sectionFormat="of" target="s" derivedContent="Section 15.2.1"/></em></strong></t>'
        )
      )
    ).toBe('*_Section 15.2.1_*');
  });

  it('contact は氏名を出す', () => {
    expect(textOf(build('<t>of which <contact fullname="Jon Postel"/> was the editor.</t>'))).toBe(
      'of which Jon Postel was the editor.'
    );
  });

  it('iref と cref は何も出さない', () => {
    expect(textOf(build('<t>a field<iref item="field"/> is defined.</t>'))).toBe(
      'a field is defined.'
    );
  });

  it('eref は URL を出す（brackets="angle" なら山括弧付き）', () => {
    expect(
      textOf(build('<t>see <eref target="https://example.com/x" brackets="none"/>.</t>'))
    ).toBe('see https://example.com/x.');
    expect(
      textOf(build('<t>see <eref target="https://example.com/x" brackets="angle"/>.</t>'))
    ).toBe('see <https://example.com/x>.');
  });
});

describe('散文の空白を畳むこと', () => {
  const build = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9999">
  <front><title>Whitespace</title></front>
  <middle>
    <section anchor="section-1"><name>Intro</name>${body}</section>
  </middle>
  <back></back>
</rfc>`;

  const blocksOf = (xml: string) => parseRFCXML(xml).sections[0].content;
  const textOf = (xml: string): string => {
    const block = blocksOf(xml).find((b) => b.type === 'text');
    return block && block.type === 'text' ? block.content : '';
  };

  it('タグを外した跡の字下げを残さない', () => {
    // RFC 9114 §6.2.3 の形。bcp14 が独立した行に置かれている。
    const xml = build(`<t>They
            <bcp14>MAY</bcp14>
            also be sent on connections where no data is
currently being transferred.</t>`);

    expect(textOf(xml)).toBe(
      'They MAY also be sent on connections where no data is currently being transferred.'
    );
  });

  it('段落の折り返しを 1 行に畳む', () => {
    const xml = build('<t>The client\n   MUST send\n   data.</t>');

    expect(textOf(xml)).toBe('The client MUST send data.');
  });

  it('節の題名も畳む', () => {
    const xml = build('<t>Body text here.</t>');
    const section = parseRFCXML(
      xml.replace('<name>Intro</name>', '<name>Reserved\n      Stream Types</name>')
    ).sections[0];

    expect(section.title).toBe('Reserved Stream Types');
  });

  it('sourcecode と artwork の空白は保つ', () => {
    // 図やコードは空白が意味を持つ。畳んではならない。
    const xml = build(
      '<t>See below.</t><artwork>+-+-+-+\n|A|B|C|\n+-+-+-+</artwork><sourcecode type="abnf">rule = a\n       b</sourcecode>'
    );
    const blocks = blocksOf(xml);
    const artwork = blocks.find((b) => b.type === 'artwork');
    const code = blocks.find((b) => b.type === 'sourcecode');

    expect(artwork && artwork.type === 'artwork' ? artwork.content : '').toContain('\n');
    expect(code && code.type === 'sourcecode' ? code.content : '').toContain('\n');
  });
});

describe('索引を定義として拾わないこと', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9999">
  <front><title>Index Test</title></front>
  <middle>
    <section anchor="section-2"><name>Terminology</name>
      <dl>
        <dt>stream:</dt>
        <dd>A bidirectional bytestream provided by the transport.</dd>
      </dl>
    </section>
  </middle>
  <back>
    <section numbered="false" pn="section-appendix.a"><name>Changes</name>
      <dl>
        <dt>RST_STREAM (0x03):</dt>
        <dd>Does not exist in this protocol.</dd>
      </dl>
    </section>
    <section numbered="false" pn="section-appendix.c"><name>Index</name>
      <dl>
        <dt>control stream</dt>
        <dd>Section 2, Paragraph 3; Section 3.2, Paragraph 4</dd>
      </dl>
    </section>
  </back>
</rfc>`;

  it('Index の節の項目を除外する', () => {
    const terms = parseRFCXML(xml).definitions.map((d) => d.term);

    expect(terms).not.toContain('control stream');
  });

  it('後付録の本物の定義は残す', () => {
    // RFC 9114 の Appendix A.2.5 のように、定義が後付録に置かれることがある。
    // back ごと落としてはならない。
    const terms = parseRFCXML(xml).definitions.map((d) => d.term);

    expect(terms).toEqual(['stream', 'RST_STREAM (0x03)']);
  });
});

describe('iref から定義を取り出す', () => {
  const xml = `<?xml version="1.0"?>
<rfc number="9110">
  <middle>
    <section anchor="caches" pn="section-3.8">
      <name>Caches</name>
      <iref item="cache" primary="true" pn="iref-cache-42"/>
      <t pn="section-3.8-1">A "cache" is a local store of previous response messages.</t>
    </section>
    <section anchor="proxies" pn="section-3.7">
      <name>Proxies</name>
      <t pn="section-3.7-1"><iref primary="true" item="proxy"/>A "proxy" is a message-forwarding agent chosen by the client.</t>
      <t pn="section-3.7-2"><iref primary="false" item="proxy"/>Proxies are often used to group requests.</t>
    </section>
    <section anchor="fields" pn="section-5">
      <name>Fields</name>
      <t pn="section-5-1"><iref primary="true" item="header fields" subitem="Content-Type"/>The Content-Type field is defined in Section 8.3.</t>
    </section>
  </middle>
</rfc>`;

  it('定義箇所の段落を用語の定義として返す', () => {
    const definitions = parseRFCXML(xml).definitions;

    expect(definitions).toContainEqual({
      term: 'cache',
      definition: 'A "cache" is a local store of previous response messages.',
      section: '3.8',
    });
  });

  it('段落の中に置かれた iref も、その段落を定義とする', () => {
    const proxy = parseRFCXML(xml).definitions.find((d) => d.term === 'proxy');

    expect(proxy?.definition).toBe('A "proxy" is a message-forwarding agent chosen by the client.');
  });

  it('primary="false" は言及であって定義ではない', () => {
    // §3.7 の 2 つめの段落は proxy を定義していない。定義として採ると
    // "Proxies are often used to group requests." が定義になる。
    const proxy = parseRFCXML(xml).definitions.filter((d) => d.term === 'proxy');

    expect(proxy).toHaveLength(1);
  });

  it('subitem を持つものは索引の下位項目なので採らない', () => {
    const terms = parseRFCXML(xml).definitions.map((d) => d.term);

    expect(terms).not.toContain('header fields');
  });
});

describe('用語と節番号の表記', () => {
  const xml = `<?xml version="1.0"?>
<rfc number="9110">
  <middle>
    <section anchor="etag" pn="section-8.8.3.2">
      <name>Comparison</name>
      <dl>
        <dt>"Strong comparison":</dt>
        <dd>two entity tags are equivalent if both are not weak.</dd>
      </dl>
    </section>
  </middle>
  <back>
    <section pn="section-appendix.a.2.5">
      <name>Frames</name>
      <dl>
        <dt>RST_STREAM (0x03):</dt>
        <dd>RST_STREAM frames do not exist in HTTP/3.</dd>
      </dl>
    </section>
  </back>
</rfc>`;

  it('用語の末尾のコロンと引用符を落とす', () => {
    const terms = parseRFCXML(xml).definitions.map((d) => d.term);

    expect(terms).toContain('Strong comparison');
    expect(terms).toContain('RST_STREAM (0x03)');
  });

  it('節は RFC が印字する番号で返す', () => {
    const sections = parseRFCXML(xml).definitions.map((d) => d.section);

    // `pn` の "section-8.8.3.2" / "section-appendix.a.2.5" は外に出さない
    expect(sections).toEqual(['8.8.3.2', 'A.2.5']);
  });
});

describe('定義の段落を選ぶ', () => {
  const xml = `<?xml version="1.0"?>
<rfc number="9110">
  <middle>
    <section anchor="message.transformations" pn="section-7.7">
      <name>Message Transformations</name>
      <iref primary="true" item="transforming proxy"/>
      <t pn="section-7.7-1">Some intermediaries include features for transforming messages and their content.</t>
      <t pn="section-7.7-2">An HTTP-to-HTTP proxy is called a "transforming proxy" if it is designed to modify messages in a semantically meaningful way.</t>
    </section>
    <section anchor="opaque" pn="section-9">
      <name>Opaque</name>
      <iref primary="true" item="widget"/>
      <t pn="section-9-1">This section describes something else entirely.</t>
    </section>
  </middle>
</rfc>`;

  it('用語が出てくる段落まで同じ節の中を進む', () => {
    // iref は節の直下にあり、定義は 2 つめの段落にある。
    const transforming = parseRFCXML(xml).definitions.find((d) => d.term === 'transforming proxy');

    expect(transforming?.definition).toContain('is called a "transforming proxy"');
  });

  it('用語を含む段落が無ければ直後の段落に戻す', () => {
    const widget = parseRFCXML(xml).definitions.find((d) => d.term === 'widget');

    expect(widget?.definition).toBe('This section describes something else entirely.');
  });

  it('節をまたいで探さない', () => {
    const widget = parseRFCXML(xml).definitions.find((d) => d.term === 'widget');

    expect(widget?.section).toBe('9');
  });
});

describe('文の途中で終わる段落に続きを繋ぐ', () => {
  const xml = `<?xml version="1.0"?>
<rfc number="9110">
  <middle>
    <section anchor="delete" pn="section-9.3.5">
      <name>DELETE</name>
      <t pn="section-9.3.5-4">If a DELETE method is successfully applied, the origin server <bcp14>SHOULD</bcp14> send</t>
      <ul pn="section-9.3.5-5">
        <li pn="section-9.3.5-5.1">a 202 (Accepted) status code if the action will likely succeed</li>
        <li pn="section-9.3.5-5.2">a 204 (No Content) status code if the action has been enacted</li>
      </ul>
    </section>
    <section anchor="ranges" pn="section-14.3">
      <name>Accept-Ranges</name>
      <t pn="section-14.3-8">A server that does not support range requests <bcp14>MAY</bcp14> send</t>
      <sourcecode pn="section-14.3-9">Accept-Ranges: none</sourcecode>
      <t pn="section-14.3-10">to advise the client not to attempt a range request.</t>
    </section>
    <section anchor="date" pn="section-6.6.1">
      <name>Date</name>
      <t pn="section-6.6.1-3">An example is</t>
      <sourcecode pn="section-6.6.1-4">Date: Tue, 15 Nov 1994 08:12:31 GMT</sourcecode>
      <t pn="section-6.6.1-5">A sender <bcp14>SHOULD</bcp14> generate its field value as the best available approximation.</t>
    </section>
  </middle>
</rfc>`;

  const requirementsOf = (section: string) =>
    extractRequirements(parseRFCXML(xml).sections, { section });

  it('直後の箇条書きを取り込む', () => {
    const [requirement] = requirementsOf('9.3.5');

    expect(requirement.text).toBe(
      'If a DELETE method is successfully applied, the origin server SHOULD send a 202 (Accepted) status code if the action will likely succeed; a 204 (No Content) status code if the action has been enacted.'
    );
  });

  it('表示例をまたいだ文を繋ぐ', () => {
    const [requirement] = requirementsOf('14.3');

    expect(requirement.text).toBe(
      'A server that does not support range requests MAY send Accept-Ranges: none to advise the client not to attempt a range request.'
    );
  });

  it('取り込んだ段落から要件を二重に出さない', () => {
    const requirements = requirementsOf('14.3');

    expect(requirements).toHaveLength(1);
  });

  it('BCP 14 キーワードの無い段落は繋がない', () => {
    // "An example is" は表示例の見出しであって、途中で切れた要件ではない。
    const [requirement] = requirementsOf('6.6.1');

    expect(requirement.text).toBe(
      'A sender SHOULD generate its field value as the best available approximation.'
    );
  });
});

describe('中身の無い定義', () => {
  const xml = `<?xml version="1.0"?>
<rfc number="9110">
  <middle>
    <section anchor="media" pn="section-14.6">
      <name>byteranges Media Type</name>
      <dl>
        <dt>Type name:</dt>
        <dd>multipart</dd>
        <dt>Optional parameters:</dt>
        <dd>N/A</dd>
        <dt>Encoding considerations:</dt>
        <dd>only "7bit", "8bit", or "binary" are permitted</dd>
      </dl>
    </section>
  </middle>
</rfc>`;

  it('N/A は定義として返さない', () => {
    const terms = parseRFCXML(xml).definitions.map((d) => d.term);

    expect(terms).not.toContain('Optional parameters');
    expect(terms).toContain('Encoding considerations');
  });
});

describe('箇条書きの繋ぎ方', () => {
  const build = (items: string[]) => `<?xml version="1.0"?>
<rfc number="9110">
  <middle>
    <section anchor="delete" pn="section-9.3.5">
      <name>DELETE</name>
      <t pn="section-9.3.5-4">The origin server <bcp14>SHOULD</bcp14> send</t>
      <ul pn="section-9.3.5-5">
${items.map((item, index) => `        <li pn="section-9.3.5-5.${index + 1}">${item}</li>`).join('\n')}
      </ul>
    </section>
  </middle>
</rfc>`;

  it('項目が区切りを持っていれば空白だけで繋ぐ', () => {
    // RFC 9110 §9.3.5 の項目は "…enacted," "…supplied, or" "…status." と自分で区切る。
    const xml = build([
      'a 202 (Accepted) status code if it will likely succeed,',
      'a 204 (No Content) status code if no information is supplied, or',
      'a 200 (OK) status code if the response includes a representation.',
    ]);
    const [requirement] = extractRequirements(parseRFCXML(xml).sections, { section: '9.3.5' });

    expect(requirement.text).toBe(
      'The origin server SHOULD send a 202 (Accepted) status code if it will likely succeed, a 204 (No Content) status code if no information is supplied, or a 200 (OK) status code if the response includes a representation.'
    );
  });

  it('項目が区切りを持たなければ "; " を入れて文末に "." を足す', () => {
    const xml = build(['the first condition', 'the second condition']);
    const [requirement] = extractRequirements(parseRFCXML(xml).sections, { section: '9.3.5' });

    expect(requirement.text).toBe(
      'The origin server SHOULD send the first condition; the second condition.'
    );
  });

  it('文末記号を二重に付けない', () => {
    const xml = build(['the only condition.']);
    const [requirement] = extractRequirements(parseRFCXML(xml).sections, { section: '9.3.5' });

    expect(requirement.text).not.toContain('..');
  });
});

describe('コロンで終わる段落と、続く箇条書き', () => {
  const xml = `<?xml version="1.0"?>
<rfc number="9110">
  <middle>
    <section anchor="expect" pn="section-10.1.1">
      <name>Expect</name>
      <t pn="section-10.1.1-14">Upon receiving a request that contains a 100-continue expectation, an origin server <bcp14>MUST</bcp14> send either:</t>
      <ul pn="section-10.1.1-15">
        <li pn="section-10.1.1-15.1">an immediate response with a final status code, or</li>
        <li pn="section-10.1.1-15.2">an immediate 100 (Continue) response.</li>
      </ul>
    </section>
    <section anchor="rules" pn="section-3.2">
      <name>Rules</name>
      <t pn="section-3.2-1">If the Timestamp option is implemented, the following rules apply, and it is <bcp14>OPTIONAL</bcp14>:</t>
      <ul pn="section-3.2-2">
        <li pn="section-3.2-2.1">The originating host <bcp14>MUST</bcp14> record a timestamp.</li>
      </ul>
    </section>
  </middle>
</rfc>`;

  const requirementsOf = (section: string) =>
    extractRequirements(parseRFCXML(xml).sections, { section });

  it('項目を取り込む', () => {
    // `<t>` だけを要件文にすると "MUST send either:" で終わり、
    // 何を選ぶのかが書かれていない（RFC 9110 §10.1.1）。
    const [requirement] = requirementsOf('10.1.1');

    expect(requirement.text).toBe(
      'Upon receiving a request that contains a 100-continue expectation, an origin server MUST send either: an immediate response with a final status code, or an immediate 100 (Continue) response.'
    );
  });

  it('項目自身がキーワードを持つなら取り込まない', () => {
    // 取り込むと、項目の側の要件文が失われる。
    const requirements = requirementsOf('3.2');

    expect(requirements.map((r) => r.text)).toContain(
      'The originating host MUST record a timestamp.'
    );
    expect(requirements.some((r) => /rules apply.*originating host/s.test(r.text))).toBe(false);
  });
});

describe('後付録と、箇条書きの中の段落', () => {
  const xml = `<?xml version="1.0"?>
<rfc number="9114">
  <middle>
    <section anchor="intro" pn="section-1">
      <name>Introduction</name>
      <t pn="section-1-1">Body.</t>
    </section>
  </middle>
  <back>
    <references pn="section-11"><name>References</name></references>
    <section anchor="h2-considerations" numbered="true" pn="section-appendix.a">
      <name>Considerations for Transitioning from HTTP/2</name>
      <t pn="section-appendix.a-1">Body.</t>
      <section anchor="h2-frames" numbered="true" pn="section-appendix.a.2">
        <name>Frames</name>
        <t pn="section-appendix.a.2-1">A client <bcp14>MUST</bcp14> ignore unknown frames.</t>
      </section>
    </section>
  </back>
</rfc>`;

  it('後付録が構造に入る', () => {
    const numbers = parseRFCXML(xml).sections.map((s) => s.number);

    expect(numbers).toContain('section-appendix.a');
  });

  it('後付録の中の要件が取れる', () => {
    const requirements = extractRequirements(parseRFCXML(xml).sections, { section: 'A.2' });

    expect(requirements.map((r) => r.text)).toContain('A client MUST ignore unknown frames.');
  });
});

describe('箇条書きの中の段落の節番号', () => {
  it('pn="section-7.1-8.1" の節は 7.1', () => {
    // 末尾の `-\\d+` だけを外すと `.1` が残り、節が "7.1-8.1" になっていた。
    const xml = `<?xml version="1.0"?>
<rfc number="9110">
  <middle>
    <section anchor="routing" pn="section-7.1">
      <name>Determining the Target Resource</name>
      <ul pn="section-7.1-8">
        <li pn="section-7.1-8.1">
          <iref primary="true" item="effective request URI" pn="iref-1"/>
          <t pn="section-7.1-8.1">The "effective request URI" is the target URI of a request, reconstructed by the server.</t>
        </li>
      </ul>
    </section>
  </middle>
</rfc>`;

    const definition = parseRFCXML(xml).definitions.find((d) => d.term === 'effective request URI');

    expect(definition?.section).toBe('7.1');
  });
});

describe('索引の節', () => {
  // RFC 9051 の付録 H。索引の項目 `MUST (specification requirement term)` を
  // 本文として読み、`R-H-1` … `R-H-9` の 9 件の要件を立てていた。
  const withIndex = `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9051" docName="draft-test-01">
  <front><title>Test</title></front>
  <middle>
    <section anchor="s1" pn="section-1">
      <name>Introduction</name>
      <t>The client MUST send a request.</t>
    </section>
  </middle>
  <back>
    <section anchor="index" pn="section-h">
      <name>Index</name>
      <t>M MAX (search result option) MAY (specification requirement term) MUST (specification requirement term) MUST NOT (specification requirement term)</t>
    </section>
  </back>
</rfc>`;

  it('節そのものは残す', () => {
    const parsed = parseRFCXML(withIndex);
    const index = parsed.sections.find((section) => section.title === 'Index');

    expect(index).toBeDefined();
  });

  it('索引から要件を出さない', () => {
    const parsed = parseRFCXML(withIndex);
    const index = parsed.sections.find((section) => section.title === 'Index');

    expect(index?.content).toEqual([]);
    expect(extractRequirements(parsed.sections).map((r) => r.text)).toEqual([
      'The client MUST send a request.',
    ]);
  });
});

describe('iref から定義を取るとき、定義している段落を採ること', () => {
  it('節の導入ではなく、用語を引用符付きで定義する段落を採る', () => {
    // RFC 9110 §3.3。導入の段落が 3 つの用語すべてを含むため、client /
    // server / connection の説明が同じ 1 文になっていた。
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9110">
  <front><title>Test</title></front>
  <middle>
    <section anchor="connections" pn="section-3.3">
      <name>Connections, Clients, and Servers</name>
      <iref primary="true" item="client" pn="iref-client-17"/>
      <iref primary="true" item="server" pn="iref-server-18"/>
      <t pn="section-3.3-1">HTTP is a client/server protocol that operates over a reliable transport- or session-layer "connection".</t>
      <t pn="section-3.3-2">An HTTP "client" is a program that establishes a connection to a server. An HTTP "server" is a program that accepts connections.</t>
    </section>
  </middle>
</rfc>`;

    const byTerm = new Map(parseRFCXML(xml).definitions.map((d) => [d.term, d.definition]));

    expect(byTerm.get('client')).toContain('is a program that establishes a connection');
    expect(byTerm.get('client')).not.toContain('HTTP is a client/server protocol');
  });

  it('索引の項目に付いた分類の括弧を外して探す', () => {
    // RFC 9111 §5.2.1.1。`max-age (cache directive)` は本文のどの段落にも
    // 当たらず、起点の段落 `Argument syntax:` を説明として返していた。
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9111">
  <front><title>Test</title></front>
  <middle>
    <section anchor="max-age" pn="section-5.2.1.1">
      <name>max-age</name>
      <iref item="max-age (cache directive)" primary="true" pn="iref-max-age-28"/>
      <t pn="section-5.2.1.1-1">Argument syntax:</t>
      <t pn="section-5.2.1.1-3">The max-age request directive indicates that the client prefers a response whose age is less than or equal to the specified number of seconds.</t>
    </section>
  </middle>
</rfc>`;

    const definition = parseRFCXML(xml).definitions.find(
      (d) => d.term === 'max-age (cache directive)'
    );

    expect(definition?.definition).toContain('indicates that the client prefers');
  });

  it('用語を定義する段落が無ければ、これまでどおり用語を含む段落を採る', () => {
    // 定義の形（引用符 + is/are/refers to）を探すだけにすると、定義ではない文が
    // 当たる。RFC 9110 §9.3.8 は `Responses to the TRACE method are not
    // cacheable.` に移っていた。
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9110">
  <front><title>Test</title></front>
  <middle>
    <section anchor="trace" pn="section-9.3.8">
      <name>TRACE</name>
      <iref primary="true" item="TRACE method" pn="iref-trace-1"/>
      <t pn="section-9.3.8-1">The TRACE method requests a remote, application-level loop-back of the request message.</t>
      <t pn="section-9.3.8-2">Responses to the TRACE method are not cacheable.</t>
    </section>
  </middle>
</rfc>`;

    const definition = parseRFCXML(xml).definitions.find((d) => d.term === 'TRACE method');

    expect(definition?.definition).toContain('requests a remote, application-level loop-back');
  });
});

describe('dl / aside / blockquote / figure / table の中身を content block にすること', () => {
  const xml = `<?xml version="1.0"?>
<rfc number="9113">
  <middle>
    <section anchor="FrameHeader" pn="section-4.1">
      <name>Frame Format</name>
      <t pn="section-4.1-1">All frames begin with a fixed 9-octet header.</t>
      <figure anchor="FrameLayout" pn="figure-1">
        <name>Frame Layout</name>
        <artwork type="inline" pn="section-4.1-2.1">
HTTP Frame {
  Length (24),
  Type (8),
}
</artwork>
      </figure>
      <t pn="section-4.1-3">The fields of the frame header are defined as:</t>
      <dl pn="section-4.1-4">
        <dt pn="section-4.1-4.1">Length:</dt>
        <dd pn="section-4.1-4.2">
          <t pn="section-4.1-4.2.1">The length of the frame payload. Values greater than 2^14 <bcp14>MUST NOT</bcp14> be sent unless the receiver has set a larger value.</t>
          <t pn="section-4.1-4.2.2">The 9 octets of the frame header are not included in this value.</t>
        </dd>
        <dt pn="section-4.1-4.3">Flags:</dt>
        <dd pn="section-4.1-4.4">
          <t pn="section-4.1-4.4.1">Unused flags <bcp14>MUST</bcp14> be ignored on receipt and <bcp14>MUST</bcp14> be left unset (0x00) when sending.</t>
        </dd>
        <dt pn="section-4.1-4.5">$Forwarded</dt>
        <dd pn="section-4.1-4.6">Message has been forwarded. Once set, the flag <bcp14>SHOULD NOT</bcp14> be cleared.</dd>
      </dl>
      <t pn="section-4.1-5">The structure of the frame payload depends on the frame type.</t>
    </section>
    <section anchor="quoted" pn="section-5">
      <name>Quoted</name>
      <t pn="section-5-1">Body.</t>
      <aside pn="section-5-2">
        <t pn="section-5-2.1"><strong>Note:</strong> A user agent <bcp14>MAY</bcp14> change the request method from POST to GET.</t>
      </aside>
      <blockquote pn="section-5-3">
        <t pn="section-5-3.1">An incoming SYN with an invalid source address <bcp14>MUST</bcp14> be ignored.</t>
      </blockquote>
      <blockquote pn="section-5-4">Any TLS cipher suite specified for use with DTLS <bcp14>MUST</bcp14> define limits on the use of the AEAD function.</blockquote>
    </section>
    <section anchor="tables" pn="section-6">
      <name>Tables</name>
      <t pn="section-6-1">The requirements are summarized as follows:</t>
      <table pn="table-1">
        <name>Summary</name>
        <thead>
          <tr><th>Feature</th><th>ReqID</th><th><bcp14>MUST</bcp14></th><th><bcp14>MAY</bcp14></th></tr>
        </thead>
        <tbody>
          <tr><td>Treat as unsigned number</td><td>MUST-1</td><td>X</td><td></td></tr>
          <tr><td>Padding</td><td>Padding octets <bcp14>MUST</bcp14> be set to zero when sending.</td><td>X</td><td></td></tr>
        </tbody>
      </table>
      <t pn="section-6-2">After the table.</t>
    </section>
    <section anchor="svg" pn="section-7">
      <name>Artset</name>
      <figure pn="figure-2">
        <artset pn="section-7-1.1">
          <artwork type="svg" pn="section-7-1.1.1"><svg xmlns="http://www.w3.org/2000/svg"><text>svg text</text></svg></artwork>
          <artwork type="ascii-art" pn="section-7-1.1.2">+---+
| A |
+---+</artwork>
        </artset>
      </figure>
    </section>
  </middle>
</rfc>`;

  const parsed = parseRFCXML(xml);
  const sectionOf = (anchor: string) => parsed.sections.find((s) => s.anchor === anchor)!;
  const requirementsOf = (section: string) =>
    extractRequirements(parsed.sections, { section }).map((r) => r.text);

  it('dd の中の t から要件が出る（RFC 9113 §4.1）', () => {
    const texts = requirementsOf('4.1');

    expect(texts).toContain(
      'Values greater than 2^14 MUST NOT be sent unless the receiver has set a larger value.'
    );
    expect(texts).toContain(
      'Unused flags MUST be ignored on receipt and MUST be left unset (0x00) when sending.'
    );
  });

  it('dd の直下のテキストからも要件が出る（RFC 9051 §2.3.2）', () => {
    expect(requirementsOf('4.1')).toContain('Once set, the flag SHOULD NOT be cleared.');
  });

  it('dt の用語を要件文に混ぜない', () => {
    for (const text of requirementsOf('4.1')) {
      expect(text).not.toMatch(/^(Length:|Flags:|\$Forwarded)/);
    }
  });

  it('同じ要件を 2 か所から出さない', () => {
    const texts = requirementsOf('4.1');

    expect(new Set(texts).size).toBe(texts.length);
    // 6 個の目印のうち、1 文に同じレベルが 2 回あるものは 1 件に畳まれる。
    expect(texts).toHaveLength(3);
  });

  it('コロンで終わる段落は、続く dd を取り込まない', () => {
    const texts = requirementsOf('4.1');

    expect(texts.some((t) => t.startsWith('The fields of the frame header'))).toBe(false);
  });

  it('dd の段落は pn の順に、前後の t の間に並ぶ', () => {
    const texts = sectionOf('FrameHeader')
      .content.filter((b) => b.type === 'text')
      .map((b) => (b as { content: string }).content.slice(0, 20));

    expect(texts).toEqual([
      'All frames begin wit',
      'The fields of the fr',
      'The length of the fr',
      'The 9 octets of the ',
      'Unused flags MUST be',
      'Message has been for',
      'The structure of the',
    ]);
  });

  it('figure の中の artwork が空白を保ったまま content に入る', () => {
    const artwork = sectionOf('FrameHeader').content.find((b) => b.type === 'artwork');

    expect(artwork).toBeDefined();
    expect((artwork as { content: string }).content).toContain('  Length (24),\n');
  });

  it('artset は svg でない artwork を採る', () => {
    const blocks = sectionOf('svg').content;

    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { content: string }).content).toContain('| A |');
    expect((blocks[0] as { content: string }).content).not.toContain('svg text');
  });

  it('aside / blockquote の中の t と、blockquote の直下のテキストから要件が出る', () => {
    const texts = requirementsOf('5');

    expect(texts).toContain('*Note:* A user agent MAY change the request method from POST to GET.');
    expect(texts).toContain('An incoming SYN with an invalid source address MUST be ignored.');
    expect(texts).toContain(
      'Any TLS cipher suite specified for use with DTLS MUST define limits on the use of the AEAD function.'
    );
  });

  it('table は見出しと行を持つ block になる', () => {
    const table = sectionOf('tables').content.find((b) => b.type === 'table');

    expect(table).toMatchObject({
      headers: ['Feature', 'ReqID', 'MUST', 'MAY'],
      rows: [
        ['Treat as unsigned number', 'MUST-1', 'X', ''],
        ['Padding', 'Padding octets MUST be set to zero when sending.', 'X', ''],
      ],
    });
  });

  it('table は直前の段落の直後に並び、コロンで終わる段落に取り込まれない', () => {
    const types = sectionOf('tables').content.map((b) => b.type);

    expect(types).toEqual(['text', 'table', 'text']);
    expect(requirementsOf('6').some((t) => t.includes('summarized as follows: '))).toBe(false);
  });

  it('table の行は 1 行ずつ要件になり、見出しの行と要求 ID ラベルだけの行は要件にしない', () => {
    const requirements = extractRequirements(parsed.sections, { section: '6' });

    expect(requirements.map((r) => r.text)).toEqual([
      'Padding | Padding octets MUST be set to zero when sending. | X |',
    ]);
    expect(requirements[0].fullContext).toBe(
      'Feature | ReqID | MUST | MAY\nPadding | Padding octets MUST be set to zero when sending. | X |'
    );
    expect(requirements[0].subject).toBeUndefined();
  });

  it('dl の定義はこれまでどおり取れる', () => {
    const definition = parsed.definitions.find((d) => d.term === 'Length');

    expect(definition?.definition).toContain('The length of the frame payload.');
  });

  it('pn の無い RFCXML でも dd の中身が content に入る', () => {
    const unordered = `<?xml version="1.0"?>
<rfc number="1">
  <middle>
    <section anchor="a">
      <name>A</name>
      <t>Intro.</t>
      <dl>
        <dt>Term</dt>
        <dd><t>The value <bcp14>MUST</bcp14> be zero.</t></dd>
      </dl>
    </section>
  </middle>
</rfc>`;
    const requirements = extractRequirements(parseRFCXML(unordered).sections);

    expect(requirements.map((r) => r.text)).toEqual(['The value MUST be zero.']);
  });
});
