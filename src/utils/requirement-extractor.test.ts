/**
 * Requirement Extractor Tests
 */

import { describe, it, expect } from 'vitest';
import { extractRequirementsFromSections } from './requirement-extractor.js';
import { createRequirementRegex } from '../constants.js';
import type { RequirementLevel, Section } from '../types/index.js';

// テスト用セクションデータ
const testSections: Section[] = [
  {
    number: 'section-3',
    anchor: 'section-3',
    title: 'Main Section',
    content: [
      {
        type: 'text',
        content: 'The client MUST send data.',
        requirements: [{ level: 'MUST', position: 11 }],
        crossReferences: [],
      },
    ],
    subsections: [
      {
        number: 'section-3.5',
        anchor: 'section-3.5',
        title: 'Subsection 3.5',
        content: [
          {
            type: 'text',
            content: 'The server SHOULD respond.',
            requirements: [{ level: 'SHOULD', position: 11 }],
            crossReferences: [],
          },
        ],
        subsections: [
          {
            number: 'section-3.5.1',
            anchor: 'section-3.5.1',
            title: 'Sub-subsection',
            content: [
              {
                type: 'text',
                content: 'Implementations MAY cache.',
                requirements: [{ level: 'MAY', position: 16 }],
                crossReferences: [],
              },
            ],
            subsections: [],
          },
        ],
      },
    ],
  },
  {
    number: '5',
    title: 'Text Format Section',
    content: [
      {
        type: 'text',
        content: 'Endpoints MUST NOT close prematurely.',
        requirements: [{ level: 'MUST NOT', position: 10 }],
        crossReferences: [],
      },
    ],
    subsections: [
      {
        number: '5.5',
        title: 'Text Subsection',
        content: [
          {
            type: 'text',
            content: 'Clients SHALL validate input.',
            requirements: [{ level: 'SHALL', position: 8 }],
            crossReferences: [],
          },
        ],
        subsections: [],
      },
    ],
  },
];

describe('extractRequirementsFromSections', () => {
  it('should extract all requirements without filter', () => {
    const result = extractRequirementsFromSections(testSections);
    expect(result.length).toBe(5);
  });

  it('should filter by section with section- prefix format (including subsections)', () => {
    const result = extractRequirementsFromSections(testSections, {
      section: 'section-3.5',
    });
    // section-3.5 と section-3.5.1 の2つ
    expect(result.length).toBe(2);
    expect(result.some((r) => r.level === 'SHOULD')).toBe(true);
    expect(result.some((r) => r.level === 'MAY')).toBe(true);
  });

  it('should filter by section with plain number format (including subsections)', () => {
    const result = extractRequirementsFromSections(testSections, {
      section: '3.5',
    });
    // section-3.5 と section-3.5.1 の2つ
    expect(result.length).toBe(2);
    expect(result.some((r) => r.level === 'SHOULD')).toBe(true);
    expect(result.some((r) => r.level === 'MAY')).toBe(true);
  });

  it('should include subsections by default', () => {
    const result = extractRequirementsFromSections(testSections, {
      section: 'section-3',
    });
    // section-3, section-3.5, section-3.5.1 の3つ
    expect(result.length).toBe(3);
  });

  it('should exclude subsections when includeSubsections is false', () => {
    const result = extractRequirementsFromSections(testSections, {
      section: 'section-3',
      includeSubsections: false,
    });
    // section-3 のみ。出力する `section` は節番号にそろえる（`section-3` → `3`）
    expect(result.length).toBe(1);
    expect(result[0].section).toBe('3');
  });

  it('should support multiple sections filter', () => {
    const result = extractRequirementsFromSections(testSections, {
      sections: ['section-3.5', '5.5'],
      includeSubsections: false,
    });
    expect(result.length).toBe(2);
    expect(result.some((r) => r.section === '3.5')).toBe(true);
    expect(result.some((r) => r.section === '5.5')).toBe(true);
  });

  it('should filter by requirement level', () => {
    const result = extractRequirementsFromSections(testSections, {
      level: 'MUST',
    });
    expect(result.every((r) => r.level === 'MUST')).toBe(true);
  });

  it('should combine section and level filters', () => {
    const result = extractRequirementsFromSections(testSections, {
      section: 'section-3',
      level: 'SHOULD',
    });
    expect(result.length).toBe(1);
    expect(result[0].level).toBe('SHOULD');
  });

  it('should handle text format section numbers (without section- prefix)', () => {
    const result = extractRequirementsFromSections(testSections, {
      section: '5',
    });
    // section 5 and 5.5
    expect(result.length).toBe(2);
  });

  it('should normalize section- prefix in filter', () => {
    // Both formats should return same results
    const result1 = extractRequirementsFromSections(testSections, {
      section: 'section-3.5.1',
    });
    const result2 = extractRequirementsFromSections(testSections, {
      section: '3.5.1',
    });
    expect(result1.length).toBe(result2.length);
    expect(result1[0]?.level).toBe(result2[0]?.level);
  });
});

describe('要求 ID ラベルによる重複（RFC 1122 系）', () => {
  /**
   * RFC 9293 §3.7.1 の実文。`(MUST-14)` というラベルが本文に埋め込まれている。
   * v0.6.0 以前は `\bMUST\b` がラベル内の MUST にも一致し、マーカーが 2 個立って
   * 同じ文が 2 件の要件として出力されていた。
   */
  const labelledText =
    'TCP endpoints MUST implement both sending and receiving the MSS Option (MUST-14).';

  it('キーワード走査はラベルも拾う（ラベルのみで示される要求を残すため）', () => {
    const regex = createRequirementRegex();
    const levels = [...labelledText.matchAll(regex)].map((m) => m[1]);

    // 本文の MUST と (MUST-14) の 2 個。重複排除は後段で行う
    expect(levels).toEqual(['MUST', 'MUST']);
  });

  it('ラベルだけで示される要求を落とさない', () => {
    // RFC 9293 §3.7.1 の MUST-67。この文に BCP 14 キーワードは無く、
    // ラベルだけが要求であることを示している。
    const labelOnly =
      'where MMS_R is the maximum size for a transport-layer message that can be received (MUST-67).';
    const sections: Section[] = [
      {
        number: 'section-3.7.1',
        anchor: 'section-3.7.1',
        title: 'Maximum Segment Size Option',
        content: [
          {
            type: 'text',
            content: labelOnly,
            requirements: [...labelOnly.matchAll(createRequirementRegex())].map((m) => ({
              level: m[1] as RequirementLevel,
              position: m.index,
            })),
            crossReferences: [],
          },
        ],
        subsections: [],
      },
    ];

    const requirements = extractRequirementsFromSections(sections);

    expect(requirements).toHaveLength(1);
    expect(requirements[0].level).toBe('MUST');
  });

  it('ラベル付きの文から要件が 1 件だけ出る', () => {
    const sections: Section[] = [
      {
        number: 'section-3.7.1',
        anchor: 'section-3.7.1',
        title: 'Maximum Segment Size Option',
        content: [
          {
            type: 'text',
            content: labelledText,
            requirements: [...labelledText.matchAll(createRequirementRegex())].map((m) => ({
              level: m[1] as RequirementLevel,
              position: m.index,
            })),
            crossReferences: [],
          },
        ],
        subsections: [],
      },
    ];

    const requirements = extractRequirementsFromSections(sections);

    expect(requirements).toHaveLength(1);
    expect(requirements[0].level).toBe('MUST');
  });

  it('同じ文に同レベルのマーカーが 2 個立っても 1 件に畳む', () => {
    // パーサ側をすり抜けた場合の保険。マーカーを直接 2 個与える。
    const sections: Section[] = [
      {
        number: 'section-3.7.1',
        anchor: 'section-3.7.1',
        title: 'Maximum Segment Size Option',
        content: [
          {
            type: 'text',
            content: labelledText,
            requirements: [
              { level: 'MUST', position: 14 },
              { level: 'MUST', position: 70 },
            ],
            crossReferences: [],
          },
        ],
        subsections: [],
      },
    ];

    const requirements = extractRequirementsFromSections(sections);

    expect(requirements).toHaveLength(1);
  });

  it('別の文であれば同レベルでも畳まない', () => {
    const content = 'The client MUST send data. The client MUST close the connection.';
    const sections: Section[] = [
      {
        number: '5',
        title: 'Framing',
        content: [
          {
            type: 'text',
            content,
            requirements: [...content.matchAll(createRequirementRegex())].map((m) => ({
              level: m[1] as RequirementLevel,
              position: m.index,
            })),
            crossReferences: [],
          },
        ],
        subsections: [],
      },
    ];

    const requirements = extractRequirementsFromSections(sections);

    expect(requirements).toHaveLength(2);
    expect(requirements[0].text).not.toBe(requirements[1].text);
  });
});

describe('要件の構成要素が途中で切れないこと', () => {
  const sectionOf = (content: string, position: number): Section[] => [
    {
      number: '5.1',
      anchor: 'section-5.1',
      title: 'Overview',
      content: [
        {
          type: 'text',
          content,
          requirements: [{ level: 'MUST', position }],
          crossReferences: [],
        },
      ],
      subsections: [],
    },
  ];

  it('action が節番号のピリオドで切れない', () => {
    const content =
      'a client MUST mask all frames that it sends to the server (see Section 5.3 for further details).  (Note that masking is done.)';
    const [requirement] = extractRequirementsFromSections(
      sectionOf(content, content.indexOf('MUST'))
    );

    expect(requirement.text).toBe(
      'a client MUST mask all frames that it sends to the server (see Section 5.3 for further details).'
    );
    expect(requirement.action).toBe(
      'mask all frames that it sends to the server (see Section 5.3 for further details)'
    );
  });

  it('condition が括弧内のカンマで切れない', () => {
    const content =
      "If this fails (e.g., the server's certificate could not be verified), then the client MUST fail the connection.";
    const [requirement] = extractRequirementsFromSections(
      sectionOf(content, content.indexOf('MUST'))
    );

    expect(requirement.condition).toBe(
      "this fails (e.g., the server's certificate could not be verified)"
    );
  });
});

describe('要件文の体裁（テキスト経路）', () => {
  const sectionOf = (content: string, requirements: Array<{ level: string; position: number }>) =>
    [
      {
        number: '5.4',
        title: 'Fragmentation',
        content: [{ type: 'text', content, requirements, crossReferences: [] }],
        subsections: [],
      },
    ] as never;

  it('段落の折り返しと字下げを 1 個の空白に畳む', () => {
    const content = 'A client MUST mask all frames that it\n   sends to the server.';
    const result = extractRequirementsFromSections(
      sectionOf(content, [{ level: 'MUST', position: content.indexOf('MUST') }])
    );

    expect(result[0].text).toBe('A client MUST mask all frames that it sends to the server.');
    expect(result[0].fullContext).not.toMatch(/\n/);
  });

  it('行頭の黒丸 "o" を落とす', () => {
    const content =
      'o  Message fragments MUST be delivered to the recipient in the\n      order sent.';
    const result = extractRequirementsFromSections(
      sectionOf(content, [{ level: 'MUST', position: content.indexOf('MUST') }])
    );

    expect(result[0].text).toBe(
      'Message fragments MUST be delivered to the recipient in the order sent.'
    );
  });

  it('ABNF の注釈を散文として組み直す', () => {
    const content = [
      'frame-rsv1              = %x0 / %x1',
      '                          ; 1 bit in length, MUST be 0 unless',
      '                          ; negotiated otherwise',
    ].join('\n');
    const result = extractRequirementsFromSections(
      sectionOf(content, [{ level: 'MUST', position: content.indexOf('MUST') }])
    );

    expect(result[0].text).toBe('1 bit in length, MUST be 0 unless negotiated otherwise');
  });

  it('図の行は要件文に混ぜず、散文だけを畳む', () => {
    // 1 つの段落に図と散文が混じることがある（RFC 8446 §4.2 は表のすぐあとに
    // 散文を書く）。段落全体を図と見なすと散文まで畳まれない。
    const content = [
      '+-+-+-+-+-------+',
      '|F|R|R|R| opcode|',
      'There MUST NOT be more than one extension',
      '   of the same type in a block.',
    ].join('\n');
    const result = extractRequirementsFromSections(
      sectionOf(content, [{ level: 'MUST NOT', position: content.indexOf('MUST NOT') }])
    );

    expect(result[0].text).toBe(
      'There MUST NOT be more than one extension of the same type in a block.'
    );
    expect(result[0].text).not.toContain('+-+');
  });

  it('図の行に当たった要件は畳まない', () => {
    const figure = 'frame-rsv1              = %x0 / %x1 MUST be 0';
    const result = extractRequirementsFromSections(
      sectionOf(figure, [{ level: 'MUST', position: figure.indexOf('MUST') }])
    );

    expect(result[0].fullContext).toBe(figure);
  });
});

describe('fullContext の体裁', () => {
  it('fullContext からも行頭の黒丸を落とす', () => {
    const content = 'o  An endpoint MUST be capable of handling control frames.';
    const result = extractRequirementsFromSections([
      {
        number: '5.4',
        title: 'Fragmentation',
        content: [
          {
            type: 'text',
            content,
            requirements: [{ level: 'MUST', position: content.indexOf('MUST') }],
            crossReferences: [],
          },
        ],
        subsections: [],
      },
    ] as never);

    expect(result[0].fullContext).toBe('An endpoint MUST be capable of handling control frames.');
  });
});

describe('要件文は 1 行', () => {
  it('図から取った要件文も 1 行にする', () => {
    // `generate_checklist` は 1 項目 1 行の Markdown にする。桁は fullContext が持つ。
    const table = [
      'Option                    DHCPOFFER    DHCPACK',
      'Client identifier         MUST NOT     MUST NOT',
    ].join('\n');
    const result = extractRequirementsFromSections([
      {
        number: '4.3.1',
        title: 'DHCPDISCOVER message',
        content: [
          {
            type: 'text',
            content: table,
            requirements: [{ level: 'MUST NOT', position: table.indexOf('MUST NOT') }],
            crossReferences: [],
          },
        ],
        subsections: [],
      },
    ] as never);

    expect(result[0].text).not.toMatch(/\n/);
    expect(result[0].fullContext).toMatch(/\n/);
  });
});
