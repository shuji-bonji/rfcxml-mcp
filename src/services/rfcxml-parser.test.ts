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
