/**
 * rfc-text-parser テスト
 */

import { describe, it, expect } from 'vitest';
import { parseRFCText, extractTextRequirements } from './rfc-text-parser.js';

// サンプル RFC テキスト
const sampleRFCText = `
Network Working Group                                          J. Doe
Request for Comments: 1234                                     Example
Category: Standards Track                                    June 2024

                            Sample RFC Title

1.  Introduction

   This document describes a sample protocol.  The client MUST send
   a valid request before the server responds.

   Implementations SHOULD support at least the basic features
   described in this document.

2.  Requirements

   This section describes the normative requirements.

2.1.  Client Requirements

   The client MUST establish a connection first.  The client MAY
   send additional metadata.

   The client MUST NOT send malformed data.

2.2.  Server Requirements

   The server SHOULD validate all input.  When receiving a request,
   the server MUST respond within a reasonable time.

3.  Security Considerations

   Implementations MUST protect against injection attacks.

4.  References

   [RFC2119]  Bradner, S., "Key words for use in RFCs", RFC 2119.
`;

describe('parseRFCText', () => {
  it('should parse RFC metadata', () => {
    const result = parseRFCText(sampleRFCText, 1234);

    expect(result.metadata.number).toBe(1234);
    expect(result.metadata.title).toBeDefined();
  });

  it('should extract sections', () => {
    const result = parseRFCText(sampleRFCText, 1234);

    expect(result.sections.length).toBeGreaterThan(0);

    const sectionNumbers = result.sections.map((s) => s.number);
    expect(sectionNumbers).toContain('1');
    expect(sectionNumbers).toContain('2');
    expect(sectionNumbers).toContain('3');
  });

  it('should create hierarchical section structure', () => {
    const result = parseRFCText(sampleRFCText, 1234);

    const section2 = result.sections.find((s) => s.number === '2');
    expect(section2).toBeDefined();
    expect(section2!.subsections.length).toBe(2);
    expect(section2!.subsections[0].number).toBe('2.1');
    expect(section2!.subsections[1].number).toBe('2.2');
  });

  it('should extract section titles', () => {
    const result = parseRFCText(sampleRFCText, 1234);

    const section1 = result.sections.find((s) => s.number === '1');
    expect(section1?.title).toBe('Introduction');

    const section3 = result.sections.find((s) => s.number === '3');
    expect(section3?.title).toBe('Security Considerations');
  });

  it('should extract content blocks with requirement markers', () => {
    const result = parseRFCText(sampleRFCText, 1234);

    const section1 = result.sections.find((s) => s.number === '1');
    expect(section1).toBeDefined();

    const textBlocks = section1!.content.filter((b) => b.type === 'text');
    expect(textBlocks.length).toBeGreaterThan(0);

    // MUST を含むブロックがあるはず
    const hasRequirement = textBlocks.some((b) => b.type === 'text' && b.requirements.length > 0);
    expect(hasRequirement).toBe(true);
  });
});

describe('extractTextRequirements', () => {
  it('should extract all requirements', () => {
    const result = parseRFCText(sampleRFCText, 1234);
    const requirements = extractTextRequirements(result.sections);

    // MUST, SHOULD, MAY, MUST NOT が含まれる
    expect(requirements.length).toBeGreaterThan(0);
  });

  it('should categorize requirements by level', () => {
    const result = parseRFCText(sampleRFCText, 1234);
    const requirements = extractTextRequirements(result.sections);

    const levels = new Set(requirements.map((r) => r.level));
    expect(levels.has('MUST')).toBe(true);
    expect(levels.has('SHOULD')).toBe(true);
    expect(levels.has('MAY')).toBe(true);
    expect(levels.has('MUST NOT')).toBe(true);
  });

  it('should filter by level', () => {
    const result = parseRFCText(sampleRFCText, 1234);
    const mustOnly = extractTextRequirements(result.sections, { level: 'MUST' });

    expect(mustOnly.length).toBeGreaterThan(0);
    expect(mustOnly.every((r) => r.level === 'MUST')).toBe(true);
  });

  it('should include section information', () => {
    const result = parseRFCText(sampleRFCText, 1234);
    const requirements = extractTextRequirements(result.sections);

    for (const req of requirements) {
      expect(req.section).toBeDefined();
      expect(req.id).toMatch(/^R-/);
    }
  });

  it('should extract fullContext', () => {
    const result = parseRFCText(sampleRFCText, 1234);
    const requirements = extractTextRequirements(result.sections);

    for (const req of requirements) {
      expect(req.fullContext).toBeDefined();
      expect(req.fullContext.length).toBeGreaterThan(0);
    }
  });
});

describe('parseRFCText cross-references', () => {
  const textWithRefs = `
1.  Introduction

   See Section 2.1 for details.  This is based on RFC 2119.
   Also refer to Section 3 and RFC 9000.
`;

  it('should extract RFC references', () => {
    const result = parseRFCText(textWithRefs, 9999);

    const section = result.sections.find((s) => s.number === '1');
    expect(section).toBeDefined();

    const textBlock = section!.content.find((b) => b.type === 'text');
    expect(textBlock).toBeDefined();

    if (textBlock && textBlock.type === 'text') {
      const rfcRefs = textBlock.crossReferences.filter((r) => r.type === 'rfc');
      expect(rfcRefs.length).toBe(2);
      expect(rfcRefs.some((r) => r.target === 'RFC2119')).toBe(true);
      expect(rfcRefs.some((r) => r.target === 'RFC9000')).toBe(true);
    }
  });

  it('should extract section references', () => {
    const result = parseRFCText(textWithRefs, 9999);

    const section = result.sections.find((s) => s.number === '1');
    const textBlock = section!.content.find((b) => b.type === 'text');

    if (textBlock && textBlock.type === 'text') {
      const sectionRefs = textBlock.crossReferences.filter((r) => r.type === 'section');
      expect(sectionRefs.length).toBe(2);
      expect(sectionRefs.some((r) => r.section === '2.1')).toBe(true);
      expect(sectionRefs.some((r) => r.section === '3')).toBe(true);
    }
  });
});

describe('parseRFCText edge cases', () => {
  it('should handle empty input', () => {
    const result = parseRFCText('', 1234);

    expect(result.metadata.number).toBe(1234);
    expect(result.sections).toEqual([]);
  });

  it('should handle text without sections', () => {
    const result = parseRFCText('Some random text without section numbers.', 1234);

    expect(result.sections).toEqual([]);
  });

  it('should handle multi-digit section numbers', () => {
    const text = `
10.  Section Ten

   Content of section 10.

10.1.  Subsection

   Content of subsection.
`;
    const result = parseRFCText(text, 1234);

    const section10 = result.sections.find((s) => s.number === '10');
    expect(section10).toBeDefined();
    expect(section10!.subsections.length).toBe(1);
    expect(section10!.subsections[0].number).toBe('10.1');
  });
});
