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

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].anchor).toBe('section-1');
    expect(result.sections[0].title).toBe('Introduction');
    expect(result.sections[1].anchor).toBe('section-2');
    expect(result.sections[1].title).toBe('Requirements');
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
