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

describe('テキスト版の公開日抽出', () => {
  it('ヘッダ行の月名と年から公開年月を取る', () => {
    const text = [
      'Internet Engineering Task Force (IETF)                          I. Fette',
      'Request for Comments: 6455                              Google, Inc.',
      'Category: Standards Track                                A. Melnikov',
      'ISSN: 2070-1721                                          Isode Ltd.',
      '                                                     December 2011',
      '',
      '                     The WebSocket Protocol',
      '',
      '1.  Introduction',
      '',
      '   The client MUST send data.',
    ].join('\n');

    expect(parseRFCText(text, 6455).metadata.date).toBe('2011-12');
  });

  it('ヘッダに日付が無ければ undefined', () => {
    const text = ['Request for Comments: 9999', '', '1.  Introduction', '', '   Body.'].join('\n');

    expect(parseRFCText(text, 9999).metadata.date).toBeUndefined();
  });
});

describe('テキスト版の題名抽出', () => {
  const header = [
    '',
    '',
    'Internet Engineering Task Force (IETF)                          B. Leiba',
    'Request for Comments: 8174                           Huawei Technologies',
    'BCP: 14                                                         May 2017',
    'Updates: 2119',
    'Category: Best Current Practice',
    'ISSN: 2070-1721',
    '',
    '',
  ];

  it('ヘッダ塊の次に来る中央寄せの行を題名にする', () => {
    const text = [
      ...header,
      '        Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words',
      '',
      'Abstract',
      '',
      '   Body.',
    ].join('\n');

    expect(parseRFCText(text, 8174).metadata.title).toBe(
      'Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words'
    );
  });

  it('ヘッダ塊の 1 行目を題名にしない', () => {
    // 以前は「コロンを含まない適度な長さの行」を上から探していたため、
    // 発行者と著者が並ぶ 1 行目を拾っていた。
    const text = [...header, '        The WebSocket Protocol', '', 'Abstract'].join('\n');

    expect(parseRFCText(text, 6455).metadata.title).not.toContain(
      'Internet Engineering Task Force'
    );
    expect(parseRFCText(text, 6455).metadata.title).toBe('The WebSocket Protocol');
  });

  it('コロンを含む題名も取れる', () => {
    // RFC 3986 "Uniform Resource Identifier (URI): Generic Syntax"
    const text = [...header, '        Uniform Resource Identifier (URI): Generic Syntax', ''].join(
      '\n'
    );

    expect(parseRFCText(text, 3986).metadata.title).toBe(
      'Uniform Resource Identifier (URI): Generic Syntax'
    );
  });

  it('2 行に折り返した題名を繋ぐ', () => {
    const text = [
      ...header,
      '        Hypertext Transfer Protocol (HTTP/1.1):',
      '                  Message Syntax and Routing',
      '',
    ].join('\n');

    expect(parseRFCText(text, 7230).metadata.title).toBe(
      'Hypertext Transfer Protocol (HTTP/1.1): Message Syntax and Routing'
    );
  });

  it('題名の位置に Abstract が来たら undefined', () => {
    const text = [...header, 'Abstract', '', '   Body.'].join('\n');

    expect(parseRFCText(text, 9999).metadata.title).toBeUndefined();
  });
});

describe('目次の行を節にしないこと', () => {
  const build = (tocStyle: string[]) =>
    [
      '',
      'Internet Engineering Task Force (IETF)                          B. Leiba',
      'ISSN: 2070-1721',
      '',
      '',
      '        Test Document',
      '',
      'Table of Contents',
      '',
      ...tocStyle,
      '',
      '1.  Introduction',
      '',
      '   The client MUST send data.',
      '',
      '2.  Security Considerations',
      '',
      '   The server MUST verify it.',
    ].join('\n');

  it('ドット + 空白のリーダー形式を除外する', () => {
    const parsed = parseRFCText(
      build([
        '   1.  Introduction  . . . . . . . . . . . . . . . . . . . .   2',
        '   2.  Security Considerations . . . . . . . . . . . . . . .   3',
      ]),
      9999
    );

    expect(parsed.sections.map((s) => s.number)).toEqual(['1', '2']);
    expect(parsed.sections.map((s) => s.title)).toEqual([
      'Introduction',
      'Security Considerations',
    ]);
  });

  it('連続ドットのリーダー形式を除外する', () => {
    const parsed = parseRFCText(
      build([
        '   1. Introduction ....................................................2',
        '   2. Security Considerations .........................................3',
      ]),
      9999
    );

    expect(parsed.sections.map((s) => s.number)).toEqual(['1', '2']);
  });
});

describe('本文の番号付きリストを節にしないこと', () => {
  const doc = [
    '',
    'Internet Engineering Task Force (IETF)                          I. Fette',
    'ISSN: 2070-1721                                         December 2011',
    '',
    '',
    '        The WebSocket Protocol',
    '',
    '4.1.  Client Requirements',
    '',
    '   The client MUST open a connection.',
    '',
    '   1.  The components of the URI MUST be valid.',
    '',
    '   2.  If any of the components are invalid, the client MUST fail.',
    '',
    '5.  Data Framing',
    '',
    '   The server MUST NOT mask frames.',
  ].join('\n');

  it('字下げされた番号付き項目を節にしない', () => {
    const parsed = parseRFCText(doc, 6455);
    const flat = [];
    const walk = (sections) => {
      for (const s of sections) {
        flat.push(s);
        walk(s.subsections || []);
      }
    };
    walk(parsed.sections);

    expect(flat.map((s) => s.number).sort()).toEqual(['4.1', '5']);
    expect(flat.find((s) => s.number === '5')?.title).toBe('Data Framing');
  });

  it('リスト項目の要件は親の節に属する', () => {
    const requirements = extractTextRequirements(parseRFCText(doc, 6455).sections);
    const inList = requirements.find((r) => /components of the URI/.test(r.text));

    expect(inList?.section).toBe('4.1');
  });

  it('1 桁目から始まる節見出しは拾う', () => {
    const parsed = parseRFCText(doc, 6455);
    const numbers = [];
    const walk = (sections) => {
      for (const s of sections) {
        numbers.push(s.number);
        walk(s.subsections || []);
      }
    };
    walk(parsed.sections);

    expect(numbers).toContain('5');
  });
});

describe('参考文献の欄から参照を取り出す', () => {
  const text = [
    '14.  References',
    '',
    '14.1.  Normative References',
    '',
    '   [ANSI.X3-4.1986]',
    '              American National Standards Institute, "Coded Character',
    '              Set - 7-bit American Standard Code for Information',
    '              Interchange", ANSI X3.4, 1986.',
    '',
    '   [RFC2119]  Bradner, S., "Key words for use in RFCs to Indicate',
    '              Requirement Levels", BCP 14, RFC 2119, March 1997.',
    '',
    '',
    'Fette & Melnikov             Standards Track                   [Page 68]',
    '',
    'RFC 6455                 The WebSocket Protocol            December 2011',
    '',
    '   [RFC2818]  Rescorla, E., "HTTP Over TLS", RFC 2818, May 2000.',
    '',
    '14.2.  Informative References',
    '',
    '   [RFC6202]  Loreto, S., "Known Issues and Best Practices", RFC 6202,',
    '              April 2011.',
    '',
    "Authors' Addresses",
    '',
    '   Ian Fette',
  ].join('\n');

  it('規範的参照と参考的参照を分ける', () => {
    const refs = parseRFCText(text, 6455).references;

    expect(refs.normative.map((r) => r.anchor)).toEqual(['ANSI.X3-4.1986', 'RFC2119', 'RFC2818']);
    expect(refs.informative.map((r) => r.anchor)).toEqual(['RFC6202']);
  });

  it('題名と RFC 番号を項目から取る', () => {
    const refs = parseRFCText(text, 6455).references;

    expect(refs.normative[1]).toEqual({
      anchor: 'RFC2119',
      type: 'normative',
      rfcNumber: 2119,
      title: 'Key words for use in RFCs to Indicate Requirement Levels',
    });
  });

  it('RFC でない参照も落とさない', () => {
    const ansi = parseRFCText(text, 6455).references.normative[0];

    expect(ansi.rfcNumber).toBeUndefined();
    expect(ansi.title).toBe(
      'Coded Character Set - 7-bit American Standard Code for Information Interchange'
    );
  });

  it('ページの区切りを参照に混ぜない', () => {
    const refs = parseRFCText(text, 6455).references;
    const all = [...refs.normative, ...refs.informative];

    expect(all.some((r) => /Page|Standards Track/.test(r.title))).toBe(false);
    // "RFC 6455 … December 2011" のページ見出しから 6455 を拾わない
    expect(all.some((r) => r.rfcNumber === 6455)).toBe(false);
  });

  it('本文中の言及は参照にしない', () => {
    // 参考文献の欄に無い RFC は参照ではない。RFC 6455 の "RFC 5741" は
    // Status of This Memo の定型文である。
    const withMention = ['1.  Introduction', '', '   See RFC 5741 for details.', '', text].join(
      '\n'
    );
    const refs = parseRFCText(withMention, 6455).references;
    const all = [...refs.normative, ...refs.informative];

    expect(all.some((r) => r.rfcNumber === 5741)).toBe(false);
  });
});
