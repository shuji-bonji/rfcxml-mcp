/**
 * rfc-text-parser テスト
 */

import { describe, it, expect } from 'vitest';
import { parseRFCText, extractTextRequirements } from './rfc-text-parser.js';
import type { Section } from '../types/index.js';

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

describe('引用符を使わない参考文献', () => {
  const text = [
    '17.  References',
    '',
    '   [20] Sollins, K. and L. Masinter, "Functional Requirements for',
    '        Uniform Resource Names", RFC 1737, December 1994.',
    '',
    '   [21] US-ASCII. Coded Character Set - 7-Bit American Standard Code for',
    '        Information Interchange. Standard ANSI X3.4-1986, ANSI, 1986.',
    '',
  ].join('\n');

  it('ピリオド区切りの最も長い部分を題名にする', () => {
    const refs = parseRFCText(text, 2616).references.informative;
    const ansi = refs.find((r) => r.anchor === '21');

    expect(ansi?.title).toBe(
      'Coded Character Set - 7-Bit American Standard Code for Information Interchange'
    );
  });

  it('引用符がある項目はそちらを優先する', () => {
    const refs = parseRFCText(text, 2616).references.informative;
    const urn = refs.find((r) => r.anchor === '20');

    expect(urn?.title).toBe('Functional Requirements for Uniform Resource Names');
  });
});

describe('ページの区切り', () => {
  const page = [
    '3.3.1.  Transfer-Encoding',
    '',
    '   A client MUST NOT send a request containing Transfer-Encoding unless',
    '   it knows the',
    '',
    '',
    '',
    'Fielding & Reschke           Standards Track                   [Page 29]',
    '\f',
    'RFC 7230           HTTP/1.1 Message Syntax and Routing         June 2014',
    '',
    '',
    '   server will handle HTTP/1.1 (or later) requests.',
    '',
  ].join('\n');

  it('文の途中でページが変わったら段落を続ける', () => {
    const parsed = parseRFCText(page, 7230);
    const text = JSON.stringify(parsed.sections);

    expect(text).toContain('server will handle HTTP/1.1 (or later) requests.');
    expect(text).not.toContain('Standards Track');
    expect(text).not.toContain('[Page 29]');
  });

  it('文が終わっていればページの変わり目で段落を切る', () => {
    const closed = page.replace('   it knows the', '   it knows the server capabilities.');
    const parsed = parseRFCText(closed, 7230);
    const blocks = parsed.sections[0].content.filter((b) => b.type === 'text');

    expect(blocks.length).toBeGreaterThan(1);
  });
});

describe('節見出しの判定', () => {
  const doc = (lines: string[]) => lines.join('\n');

  it('題名が 2 文字でも節として拾う', () => {
    // RFC 2616 §14.39 / RFC 7230 §4.3 の "TE"
    const parsed = parseRFCText(
      doc(['4.3.  TE', '', '   The TE field is defined here.', '']),
      7230
    );

    expect(parsed.sections.some((s) => s.number === '4.3' && s.title === 'TE')).toBe(true);
  });

  it('題名が小文字で始まっても節として拾う', () => {
    // RFC 7230 §2.7.1 の "http URI Scheme"
    const parsed = parseRFCText(
      doc(['2.7.1.  http URI Scheme', '', '   The scheme is defined here.', '']),
      7230
    );

    expect(parsed.sections.some((s) => s.title === 'http URI Scheme')).toBe(true);
  });

  it('題名が数字で始まっても節として拾う', () => {
    // RFC 8446 §8 の "0-RTT and Anti-Replay"
    const parsed = parseRFCText(
      doc(['8.  0-RTT and Anti-Replay', '', '   Replay is discussed here.', '']),
      8446
    );

    expect(parsed.sections.some((s) => s.title === '0-RTT and Anti-Replay')).toBe(true);
  });

  it('中央寄せの大文字見出しを節として拾う', () => {
    // RFC 793 は上位の節見出しを中央に寄せる
    const parsed = parseRFCText(
      doc([
        '                             2.  PHILOSOPHY',
        '',
        '2.1.  Elements of the Internetwork System',
        '',
        '  The internetwork environment consists of hosts.',
        '',
      ]),
      793
    );

    expect(parsed.sections.some((s) => s.number === '2' && s.title === 'PHILOSOPHY')).toBe(true);
  });

  it('中央寄せでも番号が節番号でなければ拾わない', () => {
    // RFC 793 §3.9 の表 "0       0     SEG.SEQ = RCV.NXT"
    const parsed = parseRFCText(
      doc(['        0       0     SEG.SEQ = RCV.NXT', '', '   Text follows.', '']),
      793
    );

    expect(parsed.sections.some((s) => s.number === '0')).toBe(false);
  });
});

describe('文が途中で終わる段落', () => {
  it('表示例をまたいだ文を繋ぐ', () => {
    // RFC 2616 §14.5 の形
    const text = [
      '14.5.  Accept-Ranges',
      '',
      '      Origin servers that accept byte-range requests MAY send',
      '',
      '          Accept-Ranges: bytes',
      '',
      '      but are not required to do so.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 2616);
    const blocks = parsed.sections[0].content.filter((b) => b.type === 'text');

    expect(blocks[0].content).toContain('but are not required to do so.');
  });
});

describe('字下げした節見出し', () => {
  // RFC 1122 は下位の見出しを深さに応じて字下げする
  const doc = [
    '1.  INTRODUCTION',
    '',
    '   1.1  The Internet Architecture',
    '',
    '      1.1.1  Internet Hosts',
    '',
    '   A host is a computer.',
    '',
    '   1.2  General Considerations',
    '',
    '   Some text here.',
    '',
  ].join('\n');

  it('深さに見合う字下げの見出しを拾う', () => {
    const parsed = parseRFCText(doc, 1122);
    const numbers: string[] = [];
    const walk = (sections: Section[]) => {
      for (const s of sections) {
        numbers.push(s.number ?? '');
        walk(s.subsections ?? []);
      }
    };
    walk(parsed.sections);

    expect(numbers).toEqual(['1', '1.1', '1.1.1', '1.2']);
  });

  it('本文の番号付きリストは節にしない', () => {
    // RFC 6455 §4.1 の形。1 段目の番号は 1 桁目から始まらなければ節ではない。
    const body = [
      '4.1.  Client Requirements',
      '',
      '   1.  The handshake MUST be a valid HTTP request',
      '',
      '   2.  The method of the request MUST be GET',
      '',
    ].join('\n');
    const parsed = parseRFCText(body, 6455);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].number).toBe('4.1');
  });

  it('直前の節の次に来ない番号は節にしない', () => {
    const body = [
      '4.1.  Client Requirements',
      '',
      '   9.9  Something Unrelated',
      '',
      '   Text.',
      '',
    ].join('\n');
    const parsed = parseRFCText(body, 6455);

    expect(parsed.sections[0].subsections).toHaveLength(0);
  });
});

describe('表示例をはさんだ段落', () => {
  it('要件に関わらない箇所では繋がない', () => {
    // RFC 3261 §7.3.1 は "is equivalent to" と表示例を交互に並べる
    const text = [
      '7.3.1.  Header Field Format',
      '',
      '   is equivalent to',
      '',
      '      content-disposition: Session;HANDLING=required',
      '',
      '   The following two header fields are not equivalent.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 3261);
    const blocks = parsed.sections[0].content.filter((b) => b.type === 'text');

    expect(blocks[0].content).toBe('is equivalent to');
  });
});

describe('古い書式の参考文献', () => {
  const text = [
    '                               REFERENCES',
    '',
    '[TCP:8] "Modularity and Efficiency in Protocol Implementation," D.',
    '     Clark, RFC-817, July 1982.',
    '',
    '[TCP:9] "Congestion Control in IP/TCP," J. Nagle, RFC-896, January 1984.',
    '',
  ].join('\n');

  it('1 桁目から始まる項目を拾う', () => {
    const refs = parseRFCText(text, 1122).references.informative;

    expect(refs.map((r) => r.anchor)).toEqual(['TCP:8', 'TCP:9']);
  });

  it('RFC-817 の書き方から番号を取る', () => {
    const refs = parseRFCText(text, 1122).references.informative;

    expect(refs[0].rfcNumber).toBe(817);
    // 題名の引用符の中に読点が入る。参照の題名としては落とす。
    expect(refs[0].title).toBe('Modularity and Efficiency in Protocol Implementation');
  });
});

describe('参照の番号を題名や注釈から拾わない', () => {
  it('注釈の中の番号ではなく、引用の番号を採る', () => {
    // RFC 1123 [DNS:1] は本体が RFC-1034 で、注釈が RFC-882 / 883 / 973 に
    // 触れる。最後の番号を採ると 973 になり、別文書を指していた。
    const text = [
      '7.  REFERENCES',
      '',
      '   [DNS:1]  "Domain Names - Concepts and Facilities," P. Mockapetris,',
      '        RFC-1034, November 1987.',
      '',
      '        This document and the following one obsolete RFC-882, RFC-883,',
      '        and RFC-973.',
      '',
    ].join('\n');
    const refs = parseRFCText(text, 1123).references.informative;

    expect(refs[0].rfcNumber).toBe(1034);
    expect(refs[0].title).toBe('Domain Names - Concepts and Facilities');
  });

  it('題名の中の番号を採らない', () => {
    // RFC 1123 [SMTP:5b] は "Addendum to RFC-987" が題名で、番号は RFC-??? と
    // 書かれている。題名の 987 を採ると別文書を指す。
    const text = [
      '7.  REFERENCES',
      '',
      '   [SMTP:5b]  "Addendum to RFC-987," S. Kille, RFC-???, September 1987.',
      '',
    ].join('\n');
    const refs = parseRFCText(text, 1123).references.informative;

    expect(refs[0].rfcNumber).toBeUndefined();
    expect(refs[0].title).toBe('Addendum to RFC-987');
  });
});

describe('折り返した本文を節にしない', () => {
  it('句点のあとに語が続く題名は本文とみなす', () => {
    // RFC 1035 の "…the 26th bit corresponds to TCP port" の次の行は
    // "25 (SMTP).  If this bit is set, …" で、番号 25 の節として通っていた。
    const text = [
      '4.  MESSAGES',
      '',
      'For example, if PROTOCOL=TCP (6), the 26th bit corresponds to TCP port',
      '25 (SMTP).  If this bit is set, a SMTP server should be listening on TCP',
      'port 25.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 1035);

    expect(parsed.sections.map((s) => s.number)).toEqual(['4']);
  });

  it('括弧で始まる題名は落とさない', () => {
    // RFC 8446 §7.4 "(EC)DHE Shared Secret Calculation"
    const text = ['7.4.  (EC)DHE Shared Secret Calculation', '', '   Text.', ''].join('\n');
    const parsed = parseRFCText(text, 8446);

    expect(parsed.sections[0].title).toBe('(EC)DHE Shared Secret Calculation');
  });

  it('見出しと本文が 1 行にある RFC を切り分ける', () => {
    // RFC 1035 §6.4.1 は見出しの後ろに本文の書き出しが続く
    const text = [
      '6.4.1. The contents of inverse queries and responses          Inverse',
      'queries reverse the mappings performed by standard queries.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 1035);

    expect(parsed.sections[0].title).toBe('The contents of inverse queries and responses');
    expect(JSON.stringify(parsed.sections[0].content)).toContain('Inverse');
  });
});

describe('同じ節番号を二度受け付けないこと', () => {
  it('要件一覧表の脚注を節にしない', () => {
    // RFC 1123 は要件一覧表の脚注を "1.   Unless there is …" と書く。
    // これを節として受け付けると直前の節番号が "1" に戻り、
    // 字下げ見出しの後続判定から見て §6.2 以降が「次に来る番号」でなくなる。
    const text = [
      '1.  INTRODUCTION',
      '',
      '   This memo is one of a pair.',
      '',
      '2.  GENERAL ISSUES',
      '',
      '   Text.',
      '',
      '1.   Unless there is private agreement between particular resolver and',
      '     particular server, a resolver MUST expect that.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 1123);

    expect(parsed.sections.map((s) => s.number)).toEqual(['1', '2']);
  });

  it('折り返した本文の行頭の数字を節にしない', () => {
    // RFC 1305 は "… suggested in Section" のあとに "4 is used, …" と折り返す。
    const text = [
      '1.  Introduction',
      '',
      '   Text.',
      '',
      '4.  Filtering and Selection Algorithms',
      '',
      '   Text.',
      '',
      'Filter Size (NTP.SHIFT): When the filter algorithm suggested in Section',
      '4 is used, this is the size of the clock filter (peer.filter) shift',
      'register, in stages.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 1305);

    expect(parsed.sections.map((s) => s.number)).toEqual(['1', '4']);
  });

  it('擬似コードの中の折り返しを節にしない', () => {
    // RFC 1305 は "/* test" のあとに "1 */" と折り返す。
    const text = [
      '1.  Introduction',
      '',
      '   Text.',
      '',
      '2.  Procedures',
      '',
      '   Text.',
      '',
      '        <$Etest1~<<-~( roman {pkt.xmt~!=~peer.org})>;   /* test',
      '1 */',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 1305);

    expect(parsed.sections.map((s) => s.number)).toEqual(['1', '2']);
  });
});

describe('題名の中の略語を文の終わりにしないこと', () => {
  it('出典を書いた字下げ見出しを落とさない', () => {
    // RFC 1123 §3.2.1 の題名は "Option Negotiation: RFC-854, pp. 2-3"。
    // "pp." を文の終わりと見ると §3.2.1〜§3.2.8 が丸ごと落ちる。
    const text = [
      '3.  REMOTE LOGIN -- TELNET PROTOCOL',
      '',
      '   Text.',
      '',
      '   3.1  INTRODUCTION',
      '',
      '      Text.',
      '',
      '   3.2  PROTOCOL WALK-THROUGH',
      '',
      '      3.2.1  Option Negotiation: RFC-854, pp. 2-3',
      '',
      '         Every Telnet implementation MUST include option negotiation.',
      '',
      '      3.2.2  Telnet Go-Ahead Function: RFC-854, p. 5, and RFC-858',
      '',
      '         Text.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 1123);

    const walk = (list: Section[]): string[] =>
      list.flatMap((s) => [s.number ?? '', ...walk(s.subsections)]);
    expect(walk(parsed.sections)).toEqual(['3', '3.1', '3.2', '3.2.1', '3.2.2']);
  });

  it('句点のあとに文が続く題名は落とす', () => {
    // RFC 1035 の "…the 26th bit corresponds to TCP port" の折り返し。
    const text = [
      '1.  Introduction',
      '',
      '   Text about the 26th bit corresponds to TCP port',
      '25 (SMTP).  If this bit is set, a SMTP server should be listening on TCP',
      '   port 25.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 1035);

    expect(parsed.sections.map((s) => s.number)).toEqual(['1']);
  });
});

describe('題名の長さ', () => {
  it('3 行にわたる長い題名を取る', () => {
    // RFC 1521 の題名は 133 文字。上限 100 では落ちて metadata.title が空だった。
    const text = [
      'Network Working Group                                      N. Borenstein',
      'Request for Comments: 1521                                      Bellcore',
      'Category: Standards Track                                       Innosoft',
      '                                                          September 1993',
      '',
      '',
      '         MIME (Multipurpose Internet Mail Extensions) Part One:',
      '                Mechanisms for Specifying and Describing',
      '                 the Format of Internet Message Bodies',
      '',
      'Status of this Memo',
      '',
      '   Text.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 1521);

    expect(parsed.metadata.title).toBe(
      'MIME (Multipurpose Internet Mail Extensions) Part One: Mechanisms for Specifying and Describing the Format of Internet Message Bodies'
    );
  });
});

describe('字下げ見出しの取りこぼし', () => {
  const numbers = (sections: Section[]): string[] =>
    sections.flatMap((s) => [s.number ?? '', ...numbers(s.subsections)]);

  it('引用符で始まる題名を落とさない', () => {
    // RFC 1123 §4.1.4.2 の題名は `"QUOTE" Command`。先頭に大文字を求めると落ちる。
    const text = [
      '4.  FILE TRANSFER',
      '',
      '   Text.',
      '',
      '   4.1  FILE TRANSFER PROTOCOL -- FTP',
      '',
      '      4.1.1  INTRODUCTION',
      '',
      '         Text.',
      '',
      '      4.1.2  FTP/USER INTERFACE',
      '',
      '         Text.',
      '',
      '         4.1.2.1  Pathname Specification',
      '',
      '            Text.',
      '',
      '         4.1.2.2  "QUOTE" Command',
      '',
      '            A User-FTP program MUST implement a "QUOTE" command.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 1123);

    expect(numbers(parsed.sections)).toContain('4.1.2.2');
  });

  it('72 桁で折り返した題名を繋ぐ', () => {
    // RFC 1122 §4.2.2.9 の題名は出典を含むため 2 行に分かれる。
    // 「次の行が空く」だけを課すと §4.2.2.8 から §4.2.2.11 が落ちる。
    const text = [
      '4.  TRANSPORT PROTOCOLS',
      '',
      '   Text.',
      '',
      '   4.1  TRANSMISSION CONTROL PROTOCOL -- TCP',
      '',
      '      4.1.1  INTRODUCTION',
      '',
      '         Text.',
      '',
      '      4.1.2  PROTOCOL WALK-THROUGH',
      '',
      '         Text.',
      '',
      '         4.1.2.1  TCP Checksum: RFC-793 Section 3.1',
      '',
      '            Text.',
      '',
      '         4.1.2.2  Initial Sequence Number Selection: RFC-793 Section',
      '            3.3, page 27',
      '',
      '            A TCP MUST use the specified clock-driven selection of',
      '            initial sequence numbers.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 1122);

    expect(numbers(parsed.sections)).toContain('4.1.2.2');
    const walk = (list: Section[]): Section[] => list.flatMap((s) => [s, ...walk(s.subsections)]);
    const found = walk(parsed.sections).find((s) => s.number === '4.1.2.2');
    expect(found?.title).toBe('Initial Sequence Number Selection: RFC-793 Section 3.3, page 27');
  });

  it('見出しの次に本文が続くものは節にしない', () => {
    // 折り返しの条件を緩めすぎると、本文の 1 行目を題名に取り込む。
    const text = [
      '1.  Introduction',
      '',
      '   Text.',
      '',
      '   1.1  A section whose title is long enough to reach the wrap width',
      '      but this line is followed by more body text, not a blank line,',
      '      so it is a paragraph and not a wrapped heading at all.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 1122);

    const walk = (list: Section[]): Section[] => list.flatMap((s) => [s, ...walk(s.subsections)]);
    // 折り返しとして受け入れるなら題名に本文が混ざる。節にしないのが正しい。
    const found = walk(parsed.sections).find((s) => s.number === '1.1');
    expect(found).toBeUndefined();
  });
});

describe('三点リーダは文の終わりではない', () => {
  it('"Headings: H1 ... H6" を題名として受け入れる', () => {
    // RFC 1866 §5.4。"... H6" の最後の句点を文の終わりと見ると節が落ちる。
    const text = [
      '5.4. Headings: H1 ... H6',
      '',
      '   The six heading elements, <H1> through <H6>, denote section',
      '   headings.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 1866);

    expect(parsed.sections[0].number).toBe('5.4');
    expect(parsed.sections[0].title).toBe('Headings: H1 ... H6');
  });
});

describe('番号なしの見出しで節を取る', () => {
  it('全部大文字の見出しから節を取る', () => {
    // RFC 854（Telnet）。1980 年代の RFC は節に番号を振らない。
    // 番号を頼りにすると 1 つも取れず、get_rfc_structure が空になっていた。
    const text = [
      'Network Working Group                                          J. Postel',
      'Request for Comments: 854                                    J. Reynolds',
      '                                                                May 1983',
      '',
      '                     TELNET PROTOCOL SPECIFICATION',
      '',
      'INTRODUCTION',
      '',
      '   The purpose of the TELNET Protocol is to provide a fairly general,',
      '   bi-directional communications facility.',
      '',
      'GENERAL CONSIDERATIONS',
      '',
      '   A TELNET connection is a TCP connection.',
      '',
      'TELNET COMMAND STRUCTURE',
      '',
      '   All TELNET commands consist of at least a two byte sequence.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 854);

    expect(parsed.sections.map((s) => `${s.number}. ${s.title}`)).toEqual([
      '1. INTRODUCTION',
      '2. GENERAL CONSIDERATIONS',
      '3. TELNET COMMAND STRUCTURE',
    ]);
  });

  it('ページ見出しの "RFC 792" を節にしない', () => {
    // RFC 792 はページ見出しを 1 行で書くため、前後が空行になる。
    const text = [
      'Network Working Group                                          J. Postel',
      'Request for Comments: 792                                September 1981',
      '',
      '                     INTERNET CONTROL MESSAGE PROTOCOL',
      '',
      'Introduction',
      '',
      '   The Internet Protocol is used for host-to-host datagram service.',
      '',
      'RFC 792',
      '',
      'Message Formats',
      '',
      '   ICMP messages are sent using the basic IP header.',
      '',
      'Time Exceeded Message',
      '',
      '   If the gateway processing a datagram finds the time to live zero.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 792);

    expect(parsed.sections.map((s) => s.title)).toEqual([
      'Introduction',
      'Message Formats',
      'Time Exceeded Message',
    ]);
  });

  it('番号の付いた見出しがあるときは、そちらを使う', () => {
    const text = [
      '1.  Introduction',
      '',
      '   Text.',
      '',
      'Some Heading Without A Number',
      '',
      '   Text.',
      '',
      '2.  Overview',
      '',
      '   Text.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 9999);

    expect(parsed.sections.map((s) => s.number)).toEqual(['1', '2']);
  });
});

describe('番号なしの見出しの階層と番号', () => {
  const numbers = (sections: Section[]): string[] =>
    sections.flatMap((s) => [`${s.number} ${s.title}`, ...numbers(s.subsections)]);

  it('字下げの深さで入れ子にする', () => {
    // RFC 854 は THE NETWORK VIRTUAL TERMINAL の下に TRANSMISSION OF DATA を
    // 3 桁字下げ、その下に Interrupt Process (IP) を 6 桁字下げで置く。
    const text = [
      'INTRODUCTION',
      '',
      '   Text.',
      '',
      'THE NETWORK VIRTUAL TERMINAL',
      '',
      '   Text.',
      '',
      '   TRANSMISSION OF DATA',
      '',
      '      Text.',
      '',
      '      Interrupt Process (IP)',
      '',
      '         Text.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 854);

    expect(numbers(parsed.sections)).toEqual([
      '1 INTRODUCTION',
      '2 THE NETWORK VIRTUAL TERMINAL',
      '2.1 TRANSMISSION OF DATA',
      '2.1.1 Interrupt Process (IP)',
    ]);
  });

  it('あとから浅い見出しが来ても番号が重複しない', () => {
    // RFC 855 は `Section 1 - …` を 3 桁字下げで並べ、そのあとに 1 桁目の
    // `A Note on "Subnegotiation"` を置く。文書全体の字下げを先に集めると
    // 3 桁が 2 段目になり、親のない 1.1 から始まってしまう。
    const text = [
      '   Section 1 - Command Name and Option Code',
      '',
      '      Text.',
      '',
      '   Section 2 - Command Meanings',
      '',
      '      Text.',
      '',
      'A Note on Subnegotiation',
      '',
      '   Text.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 855);

    expect(numbers(parsed.sections)).toEqual([
      '1 Section 1 - Command Name and Option Code',
      '2 Section 2 - Command Meanings',
      '3 A Note on Subnegotiation',
    ]);
  });

  it('表の見出しを節にしない', () => {
    // RFC 854 の "NAME                  CODE         MEANING"
    const text = [
      'THE NVT PRINTER AND KEYBOARD',
      '',
      '   Text.',
      '',
      '   NAME                  CODE         MEANING',
      '',
      '   NULL (NUL)              0      No Operation',
      '',
      'TELNET COMMAND STRUCTURE',
      '',
      '   Text.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 854);

    expect(numbers(parsed.sections)).toEqual([
      '1 THE NVT PRINTER AND KEYBOARD',
      '2 TELNET COMMAND STRUCTURE',
    ]);
  });
});

describe('小文字で始まる題名の節', () => {
  it('番号が句点で終わるものは節にする', () => {
    // RFC 7230 §5.3.1。直前は ABNF の行で、空行ではない。
    const text = [
      '5.3.  Request Target',
      '',
      '   request-target = origin-form',
      '                  / absolute-form',
      '                  / asterisk-form',
      '5.3.1.  origin-form',
      '',
      '   The most common form of request-target is the origin-form.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 7230);

    const walk = (list: Section[]): string[] =>
      list.flatMap((s) => [s.number ?? '', ...walk(s.subsections)]);
    expect(walk(parsed.sections)).toContain('5.3.1');
  });

  it('番号に句点が無くても、直前が空行なら節にする', () => {
    // RFC 2616 §3.2.2 は "3.2.2 http URL" と句点なしで書く。
    const text = [
      '3.2  Uniform Resource Identifiers',
      '',
      '   Text.',
      '',
      '3.2.2 http URL',
      '',
      '   The "http" scheme is used to locate network resources.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 2616);

    const walk = (list: Section[]): string[] =>
      list.flatMap((s) => [s.number ?? '', ...walk(s.subsections)]);
    expect(walk(parsed.sections)).toContain('3.2.2');
  });

  it('どちらでもない折り返しは節にしない', () => {
    // RFC 896 の本文。句点も無く、直前も空行ではない。
    const text = [
      'Congestion Control in IP/TCP Internetworks',
      '',
      '   The next',
      '24 characters, arriving from the user at 200ms  intervals,  would',
      '   be held pending a message from the distant host.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 896);

    const walk = (list: Section[]): string[] =>
      list.flatMap((s) => [s.number ?? '', ...walk(s.subsections)]);
    expect(walk(parsed.sections)).not.toContain('24');
  });
});

describe('値を並べた塊を要件文に繋がない', () => {
  it('RFC 8259 §3 のリテラル名の並びを繋がない', () => {
    const text = [
      '3.  Values',
      '',
      '   A JSON value MUST be an object, array, number, or string, or one of',
      '   the following three literal names:',
      '',
      '      false',
      '      null',
      '      true',
      '',
      '   The literal names MUST be lowercase.  No other literal names are',
      '   allowed.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 8259);
    const texts = JSON.stringify(parsed.sections[0].content);

    // "false null true The literal names MUST be lowercase." になっていた
    expect(texts).not.toContain('false\nnull\ntrue The literal names');
    expect(texts).toContain('The literal names MUST be lowercase.');
  });
});

describe('参照の題名', () => {
  const refsOf = (text: string, rfc: number) => parseRFCText(text, rfc).references.informative;

  it('引用符の中の読点を落とす', () => {
    // 実測（テキスト経路の参照 859 件）で 121 件（14.1%）が読点で終わっていた。
    const text = [
      '7.  REFERENCES',
      '',
      '   [INTRO:5]  "Assigned Numbers," J. Reynolds and J. Postel, RFC-1010,',
      '        May 1987.',
      '',
    ].join('\n');

    expect(refsOf(text, 1123)[0].title).toBe('Assigned Numbers');
  });

  it('目印を 1 行に置く書き方で、引用を題名にする', () => {
    // RFC 1305 は目印だけを 1 行に置き、引用を次の行から 1 桁目で書く。
    // 1 桁目の行を落としていたため、48 件の題名が目印のままだった。
    const text = [
      'References',
      '',
      '[ABA89]',
      '',
      "Abate, et al. AT&T's new approach to the synchronization of",
      'telecommunication networks. IEEE Communications Magazine (April 1989),',
      '35-45.',
      '',
    ].join('\n');

    expect(refsOf(text, 1305)[0].title).toBe(
      "AT&T's new approach to the synchronization of telecommunication networks"
    );
  });

  it('出典と日付の塊を題名にしない', () => {
    // RFC 1305 [DAR81a]。最長の部分を採ると出典の塊になる。
    const text = [
      'References',
      '',
      '[DAR81a]',
      '',
      'Defense Advanced Research Projects Agency. Internet Protocol. DARPA',
      'Network Working Group Report RFC-791, USC Information Sciences',
      'Institute, September 1981.',
      '',
    ].join('\n');
    const ref = refsOf(text, 1305)[0];

    expect(ref.rfcNumber).toBe(791);
    expect(ref.title).not.toContain('RFC-791');
  });

  it('題名の中に目印を残さない', () => {
    const text = [
      'References',
      '',
      '[BEL86]',
      '',
      'Digital Synchronization Network Plan.',
      '',
    ].join('\n');

    expect(refsOf(text, 1305)[0].title).not.toMatch(/^\[/);
  });
});

describe('1 段目の節番号の飛び', () => {
  it('表の中の大きな番号を節にしない', () => {
    // RFC 2068 は Warning ヘッダの警告コードを表にして
    // "99 Miscellaneous warning" を 1 桁目に置く。§99 として受け入れると
    // 以降の §15 §16 が「番号が戻る」として落ち、30 節が消えていた。
    const text = [
      '13.  Caching in HTTP',
      '',
      '   Text.',
      '',
      '14  Header Field Definitions',
      '',
      '   Text.',
      '',
      '99 Miscellaneous warning',
      '',
      '  The warning text may include arbitrary information.',
      '',
      '15 Security Considerations',
      '',
      '   Text.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 2068);

    expect(parsed.sections.map((s) => s.number)).toEqual(['13', '14', '15']);
  });
});

describe('題名が小文字で始まる節（大文字の並びで見分ける）', () => {
  it('ページの区切りの直後でも節にする', () => {
    // RFC 2445 §4 の "4 iCalendar Object Specification" は番号に句点が無く、
    // ページの区切りの直後なので直前も空行ではない。
    const text = [
      '3 Registration Information',
      '',
      '   Text that runs to the end of the page without a full stop and',
      '   continues past the page break',
      '',
      'Dawson & Stenerson          Standards Track                    [Page 12]',
      '\f',
      'RFC 2445                       iCalendar                   November 1998',
      '',
      '4 iCalendar Object Specification',
      '',
      '   The following sections define the details of a Calendaring object.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 2445);

    expect(parsed.sections.map((s) => s.number)).toEqual(['3', '4']);
  });
});

describe('行幅いっぱいの題名', () => {
  it('1 桁目から始まる長い題名を取る', () => {
    // RFC 7489 の題名は 71 文字あり、中央寄せにならず 1 桁目から始まる。
    // 字下げを課すと metadata.title が空になっていた。
    const text = [
      'Independent Submission                                 M. Kucherawy, Ed.',
      'Request for Comments: 7489',
      'Category: Informational                                   E. Zwicky, Ed.',
      'ISSN: 2070-1721                                                   Yahoo!',
      '                                                              March 2015',
      '',
      '',
      'Domain-based Message Authentication, Reporting, and Conformance (DMARC)',
      '',
      'Abstract',
      '',
      '   DMARC is a scalable mechanism for domain-level policies.',
      '',
    ].join('\n');

    expect(parseRFCText(text, 7489).metadata.title).toBe(
      'Domain-based Message Authentication, Reporting, and Conformance (DMARC)'
    );
  });

  it('1 桁目の短い行は題名にしない', () => {
    const text = [
      'Network Working Group                                          J. Doe',
      'Request for Comments: 9999                                  June 2024',
      '',
      'Status of this Memo',
      '',
      '   Text.',
      '',
    ].join('\n');

    expect(parseRFCText(text, 9999).metadata.title).toBeUndefined();
  });
});

describe('付録の見出し', () => {
  const numbers = (sections: Section[]): string[] =>
    sections.flatMap((s) => [s.number ?? '', ...numbers(s.subsections)]);

  const body = [
    '1.  Introduction',
    '',
    '   Text.',
    '',
    '2.  References',
    '',
    '2.1.  Normative References',
    '',
    '   [RFC2119]  Bradner, S., "Key words", RFC 2119, March 1997.',
    '',
  ];

  it('Appendix A から始まり 1 つずつ進むものを拾う', () => {
    // 数字だけを見ていたため、付録が 1 つも構造に出ていなかった。
    // corpus のテキスト経路で付録を持つ RFC 20 本すべてで 0 個だった。
    // 中身は直前の節に吸い込まれ、RFC 8446 では付録 A〜E の 381 ブロックが
    // §12.2「Informative References」の中身になっていた。
    const text = [
      ...body,
      'Appendix A.  State Machine',
      '',
      '   Text.',
      '',
      'A.1.  Client',
      '',
      '   Text.',
      '',
      'Appendix B.  Protocol Data Structures',
      '',
      '   Text.',
      '',
    ].join('\n');
    const parsed = parseRFCText(text, 8446);

    expect(numbers(parsed.sections)).toEqual(['1', '2', '2.1', 'A', 'A.1', 'B']);
  });

  it('区切りが "-" や "--" のものも拾う', () => {
    // RFC 3550 の "Appendix A - Algorithms"、RFC 1521 の "Appendix A -- ..."
    const text = [...body, 'Appendix A - Algorithms', '', '   Text.', ''].join('\n');

    expect(numbers(parseRFCText(text, 3550).sections)).toContain('A');
  });

  it('下位の付録は題名の先頭を問わない', () => {
    // RFC 6749 の `A.1.  "client_id" Syntax`、RFC 5321 の `F.4.  #-literals`、
    // RFC 7489 の `B.5.  mailto Transport Example`
    const text = [
      ...body,
      'Appendix A.  Augmented Backus-Naur Form',
      '',
      '   Text.',
      '',
      'A.1.  "client_id" Syntax',
      '',
      '   Text.',
      '',
      'A.2.  #-literals',
      '',
      '   Text.',
      '',
    ].join('\n');

    expect(numbers(parseRFCText(text, 6749).sections)).toEqual([
      '1',
      '2',
      '2.1',
      'A',
      'A.1',
      'A.2',
    ]);
  });

  it('著者名のような 1 文字 + 句点を付録にしない', () => {
    // 付録は A から始まり 1 つずつ進む。本文の "J. Postel" は当たらない。
    const text = [...body, 'J. Postel and J. Reynolds wrote the original.', ''].join('\n');

    expect(numbers(parseRFCText(text, 9999).sections).filter((n) => /^[A-Z]/.test(n))).toEqual([]);
  });
});

describe('折り返した節の題名', () => {
  it('題名の開始桁にそろう次の行を継ぐ', () => {
    // RFC 7519 §10.2。1 行目だけを取ると「何の登録か」が消える。
    const text = [
      'Test RFC',
      '',
      '1.  Introduction',
      '',
      '   Body.',
      '',
      '2.  Sub-Namespace Registration of',
      '    urn:ietf:params:oauth:token-type:jwt',
      '',
      '   Body.',
      '',
    ].join('\n');
    const sections = parseRFCText(text, 7519).sections;
    expect(sections.find((s) => s.number === '2')?.title).toBe(
      'Sub-Namespace Registration of urn:ietf:params:oauth:token-type:jwt'
    );
  });

  it('桁がそろわない行は本文として残す', () => {
    // RFC 1035 §6.4.1 のように、見出しの直後から本文が 1 桁目で続く形。
    const text = [
      'Test RFC',
      '',
      '1.  Introduction',
      '',
      '   Body.',
      '',
      '2.  Overview',
      'This line starts at column zero and is body text',
      '',
    ].join('\n');
    const sections = parseRFCText(text, 1035).sections;
    expect(sections.find((s) => s.number === '2')?.title).toBe('Overview');
  });

  it('句点で終わる行は継がない', () => {
    const text = [
      'Test RFC',
      '',
      '1.  Introduction',
      '',
      '   Body.',
      '',
      '2.  Something about resolvers and',
      '    particular server.',
      '',
    ].join('\n');
    const sections = parseRFCText(text, 1123).sections;
    expect(sections.find((s) => s.number === '2')?.title).toBe('Something about resolvers and');
  });
});

describe('本文からの付録参照', () => {
  it('字下げした "Appendix A.2 of …" を見出しにしない', () => {
    // RFC 7519。本文の参照を見出しとして拾い、そのあとの本物の
    // `A.2.  Example Nested JWT` が番号の重複で落ちていた。
    const text = [
      'Test RFC',
      '',
      '1.  Introduction',
      '',
      '   Body.',
      '',
      '2.  Overview',
      '',
      '   Body.',
      '',
      'Appendix A.  Examples',
      '',
      '   Body.',
      '',
      'A.1.  Example Encrypted JWT',
      '',
      '   The computation is identical to the computation of the JWE in',
      '   Appendix A.2 of [JWE], including the keys used.',
      '',
      'A.2.  Example Nested JWT',
      '',
      '   Body.',
      '',
    ].join('\n');
    const numbers = parseRFCText(text, 7519).sections.flatMap((s) => [
      s.number,
      ...(s.subsections ?? []).map((x) => x.number),
    ]);
    expect(numbers).toContain('A.2');
    const a2 = parseRFCText(text, 7519)
      .sections.flatMap((s) => s.subsections ?? [])
      .find((s) => s.number === 'A.2');
    expect(a2?.title).toBe('Example Nested JWT');
  });
});

describe('テキスト経路の定義', () => {
  it('節に入る前の表紙を用語にしない', () => {
    const text = [
      'Internet Engineering Task Force (IETF)                          M. Jones',
      'Request for Comments: 7519                                     Microsoft',
      'Category: Standards Track                                     J. Bradley',
      '',
      '1.  Terminology',
      '',
      '   CA: certification authority, an authority trusted by users.',
      '',
    ].join('\n');
    const terms = parseRFCText(text, 7519).definitions.map((d) => d.term);
    expect(terms).toEqual(['CA']);
  });

  it('折り返した文の途中の行を用語にしない', () => {
    // RFC 6797 §4。"…is the overall name for the combined UA and server-side"
    // が「用語 = is the overall name…」として出ていた。
    const text = [
      '1.  Terminology',
      '',
      '   HSTS is a name that covers several things.  The term',
      '   Overall Policy: is the overall name for the combined UA and',
      '   server-side security policy.',
      '',
    ].join('\n');
    expect(parseRFCText(text, 6797).definitions).toEqual([]);
  });
});
