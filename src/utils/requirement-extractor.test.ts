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

describe('表の行は 1 行ごとの要件', () => {
  it('表の全行を 1 件にまとめない', () => {
    // RFC 2131 §4.3.1 の Table 3 は 2 ページにわたる。段落全体を 1 件にすると
    // `generate_checklist` に 2,000 文字の「要件」がレベルごとに並ぶ。
    const table = [
      'Option                    DHCPOFFER    DHCPACK            DHCPNAK',
      '------                    ---------    -------            -------',
      'Requested IP address      MUST NOT     MUST NOT           MUST NOT',
      'Client identifier         MUST NOT     MUST NOT           MAY',
    ].join('\n');
    const result = extractRequirementsFromSections([
      {
        number: '4.3.1',
        title: 'DHCPDISCOVER message',
        content: [
          {
            type: 'text',
            content: table,
            requirements: [
              { level: 'MUST NOT', position: table.indexOf('MUST NOT') },
              { level: 'MAY', position: table.lastIndexOf('MAY') },
            ],
            crossReferences: [],
          },
        ],
        subsections: [],
      },
    ] as never);

    expect(result[0].text).toBe('Requested IP address MUST NOT MUST NOT MUST NOT');
    expect(result[1].text).toBe('Client identifier MUST NOT MUST NOT MAY');
  });
});

describe('図・表の行には構成要素を付けない', () => {
  it('表の行から主語やアクションを作らない', () => {
    // "Message SHOULD SHOULD SHOULD" に subject: "message should" が付いていた
    const table = [
      'Option                    DHCPOFFER    DHCPACK            DHCPNAK',
      'Message                   SHOULD       SHOULD             SHOULD',
    ].join('\n');
    const result = extractRequirementsFromSections(
      [
        {
          number: '4.3.1',
          title: 'DHCPDISCOVER message',
          content: [
            {
              type: 'text',
              content: table,
              requirements: [{ level: 'SHOULD', position: table.indexOf('SHOULD') }],
              crossReferences: [],
            },
          ],
          subsections: [],
        },
      ] as never,
      undefined,
      { parseComponents: true }
    );

    expect(result[0].text).toBe('Message SHOULD SHOULD SHOULD');
    expect(result[0].subject).toBeUndefined();
    expect(result[0].action).toBeUndefined();
  });

  it('図の隣の散文には構成要素を付ける', () => {
    const mixed = [
      '+-+-+-+-+-------+',
      'A client MUST mask all frames that it sends to the server.',
    ].join('\n');
    const result = extractRequirementsFromSections(
      [
        {
          number: '5.1',
          title: 'Overview',
          content: [
            {
              type: 'text',
              content: mixed,
              requirements: [{ level: 'MUST', position: mixed.indexOf('MUST') }],
              crossReferences: [],
            },
          ],
          subsections: [],
        },
      ] as never,
      undefined,
      { parseComponents: true }
    );

    expect(result[0].action).toBe('mask all frames that it sends to the server');
  });
});

describe('箇条書きの項目を文の単位で切り出すこと', () => {
  /** 段落 1 つを持つ `<dl>` の項目を組み立てる。 */
  const sectionWithListItem = (content: string, level: string) => [
    {
      number: '8.3.1',
      title: 'Request Pseudo-Header Fields',
      content: [
        {
          type: 'list',
          style: 'symbols',
          items: [
            {
              content,
              requirements: [{ level, position: content.indexOf(level) }],
            },
          ],
        },
      ],
      subsections: [],
    },
  ];

  it('段落の項目からは、キーワードのある文だけを取る', () => {
    // RFC 9113 §8.3.1 の `":authority"` の項目は 2,150 文字の段落で、
    // MUST・MUST NOT・SHOULD・MAY が入っている。v0.6.14 まではその 2,150 文字が
    // 4 件の要件として並び、`generate_checklist` の 1 行が 2,178 文字あった。
    const content = [
      'The ":authority" pseudo-header field conveys the authority portion of the target URI.',
      'The recipient of an HTTP/2 request MUST NOT use the Host header field to determine the target URI if ":authority" is present.',
      'A server SHOULD treat a request as malformed if it contains a Host header field that differs.',
    ].join(' ');

    const result = extractRequirementsFromSections(
      sectionWithListItem(content, 'MUST NOT') as never,
      undefined,
      { parseComponents: true }
    );

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(
      'The recipient of an HTTP/2 request MUST NOT use the Host header field to determine the target URI if ":authority" is present.'
    );
    // 元の段落は fullContext に残す
    expect(result[0].fullContext).toBe(content);
  });

  it('1 文の項目はそのまま取る', () => {
    // 箇条書きの項目は 1 文であることが多い。文末記号が無くても切らない。
    const content =
      'a 202 (Accepted) status code if the action MAY succeed but has not yet been enacted';

    const result = extractRequirementsFromSections(
      sectionWithListItem(content, 'MAY') as never,
      undefined,
      { parseComponents: true }
    );

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(content);
  });
});

describe('condition と exception を分ける', () => {
  const sectionWithText = (content: string, level: string) => [
    {
      number: '5.1',
      title: 'Overview',
      content: [
        {
          type: 'text',
          content,
          requirements: [{ level, position: content.indexOf(level) }],
          crossReferences: [],
        },
      ],
      subsections: [],
    },
  ];

  it('"unless" は例外であって条件ではない', () => {
    // v0.6.15 まで `unless` が条件と例外の両方に当たり、同じ文字列が
    // 2 つの欄に入っていた（RFC 49 本・要件 7,797 件のうち 247 件、3.2%）。
    const text =
      'A host MUST always be zero, unless the host is an authoritative source of address mask information.';

    const result = extractRequirementsFromSections(
      sectionWithText(text, 'MUST') as never,
      undefined,
      {
        parseComponents: true,
      }
    );

    expect(result[0].exception).toBe(
      'the host is an authoritative source of address mask information'
    );
    expect(result[0].condition).toBeUndefined();
  });

  it('"if" は条件として取る', () => {
    const text = 'A client MUST close a connection if it detects a masked frame.';

    const result = extractRequirementsFromSections(
      sectionWithText(text, 'MUST') as never,
      undefined,
      {
        parseComponents: true,
      }
    );

    expect(result[0].condition).toBe('it detects a masked frame');
    expect(result[0].exception).toBeUndefined();
  });
});

describe('キーワードだけの要件文を出さない', () => {
  it('ASN.1 の切れ端を要件にしない', () => {
    // RFC 5280 §11.2 の `OPTIONAL,` と `} OPTIONAL,`。
    // キーワードを外すと何も残らない。要件は文である。
    const content = '} OPTIONAL,';
    const result = extractRequirementsFromSections(
      [
        {
          number: '11.2',
          title: 'ASN.1 Module',
          content: [
            {
              type: 'text',
              content,
              requirements: [{ level: 'OPTIONAL', position: content.indexOf('OPTIONAL') }],
              crossReferences: [],
            },
          ],
          subsections: [],
        },
      ] as never,
      undefined,
      { parseComponents: true }
    );

    expect(result).toEqual([]);
  });
});

describe('主語の抽出', () => {
  const sectionWith = (content: string, level: string) => [
    {
      number: '6.6.1',
      title: 'Date',
      content: [
        {
          type: 'text',
          content,
          requirements: [{ level, position: content.indexOf(level) }],
          crossReferences: [],
        },
      ],
      subsections: [],
    },
  ];

  const subjectOf = (text: string, level = 'MUST') =>
    extractRequirementsFromSections(sectionWith(text, level) as never, undefined, {
      parseComponents: true,
    })[0]?.subject;

  it('前置きから始まる文でも主語を取る', () => {
    // 文頭に固定していたため、実測（RFC 64 本・要件 9,684 件）で subject が
    // 付くのは 27.9% だけだった。`generate_checklist` の role の絞り込みが
    // 効かず、`role: "client"` にサーバの要件が 865 件（8.9%）残っていた。
    expect(subjectOf('In this case, a server MAY send a Close frame.', 'MAY')).toBe('server');
    expect(
      subjectOf('(Note that masking is done over TLS.) The server MUST close the connection.')
    ).toBe('server');
  });

  it('冠詞は主語に含めない', () => {
    expect(subjectOf('A client MUST close a connection if it detects a masked frame.')).toBe(
      'client'
    );
  });

  it('2 語の主語はそのまま取る', () => {
    expect(subjectOf('An origin server MUST generate an Allow header field.')).toBe(
      'origin server'
    );
  });
});

describe('主語の先頭を削らないこと', () => {
  const subjectOf = (text: string, level = 'MUST') =>
    extractRequirementsFromSections(
      [
        {
          number: '4.3.4',
          title: 'PUT',
          content: [
            {
              type: 'text',
              content: text,
              requirements: [{ level, position: text.indexOf(level) }],
              crossReferences: [],
            },
          ],
          subsections: [],
        },
      ] as never,
      undefined,
      { parseComponents: true }
    )[0]?.subject;

  it('冠詞と同じ文字で始まる語を削らない', () => {
    // `(?:A|An)?\s*` は空白ゼロを許すので、"Automated" の "A" を冠詞として
    // 食っていた。実測（RFC 64 本・要件 9,684 件）で 600 件（6.2%）。
    expect(subjectOf('Automated clients MUST log the error to an audit log.')).toBe(
      'automated clients'
    );
    expect(subjectOf('An intermediary MAY combine Via header field values.', 'MAY')).toBe(
      'intermediary'
    );
  });
});
