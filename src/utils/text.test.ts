/**
 * テキストユーティリティのテスト
 */

import { describe, it, expect } from 'vitest';
import {
  clipAtClauseEnd,
  extractCrossReferences,
  extractSentence,
  foldWhitespace,
  isSentenceEnd,
  looksLikeDiagram,
  requirementSource,
  stripListMarker,
} from './text.js';

describe('extractCrossReferences', () => {
  it('この RFC の節を section として拾う', () => {
    const refs = extractCrossReferences('See Section 3.7.1 for the MSS Option.');

    expect(refs).toEqual([{ target: '3.7.1', type: 'section', section: '3.7.1' }]);
  });

  it('文末の句点を節番号に巻き込まない', () => {
    const refs = extractCrossReferences('The frame layout is defined in Section 6.1.');

    expect(refs.map((r) => r.section)).toEqual(['6.1']);
  });

  it('別文書の節を section として扱わない', () => {
    // "Section 11.2 of [HTTP/1.1]" の 11.2 はこの RFC の §11.2 ではない。
    // section として扱うと、無関係な節の題名を確信ありげに返してしまう。
    const refs = extractCrossReferences(
      'its potential as a request smuggling attack (Section 11.2 of [HTTP/1.1]).'
    );

    expect(refs.filter((r) => r.type === 'section')).toHaveLength(0);
    expect(refs.filter((r) => r.type === 'external')).toEqual([
      {
        target: 'HTTP/1.1',
        type: 'external',
        section: '11.2',
        displayText: 'Section 11.2 of [HTTP/1.1]',
      },
    ]);
  });

  it('comma / parens 形式の別文書参照も分離する', () => {
    const comma = extractCrossReferences('as described in [RFC5234], Section B.1.');
    const parens = extractCrossReferences('as described in [CACHING] (Section 5.2).');

    expect(comma.filter((r) => r.type === 'section')).toHaveLength(0);
    expect(parens.filter((r) => r.type === 'section')).toHaveLength(0);
    expect(parens.find((r) => r.type === 'external')?.section).toBe('5.2');
  });

  it('同じ文に両方あれば両方とも正しく分ける', () => {
    const refs = extractCrossReferences(
      'See Section 14.2 here, and Section 11.2 of [HTTP/1.1] there.'
    );

    expect(refs.filter((r) => r.type === 'section').map((r) => r.section)).toEqual(['14.2']);
    expect(refs.filter((r) => r.type === 'external').map((r) => r.section)).toEqual(['11.2']);
  });

  it('RFC 番号を rfc として拾う', () => {
    const refs = extractCrossReferences('This updates RFC 1122 and RFC 793.');

    expect(refs.filter((r) => r.type === 'rfc').map((r) => r.target)).toEqual([
      'RFC1122',
      'RFC793',
    ]);
  });
});

describe('文末の判定', () => {
  it('節番号のピリオドで文を切らない', () => {
    const text =
      'a client MUST mask all frames that it sends to the server (see Section 5.3 for further details).  (Note that masking is done.)';

    expect(extractSentence(text, text.indexOf('MUST'))).toBe(
      'a client MUST mask all frames that it sends to the server (see Section 5.3 for further details).'
    );
  });

  it('e.g. のピリオドで文を切らない', () => {
    const text = 'The client MUST limit connections to a low number (e.g. thirty).  Next sentence.';

    expect(extractSentence(text, text.indexOf('MUST'))).toBe(
      'The client MUST limit connections to a low number (e.g. thirty).'
    );
  });

  it('文末のピリオドでは切る', () => {
    const text = 'First sentence here. The client MUST do it. Third one.';

    expect(extractSentence(text, text.indexOf('MUST'))).toBe('The client MUST do it.');
  });

  it('isSentenceEnd は空白か文字列の終わりを要求する', () => {
    const text = 'Section 5.3 ends here.';

    expect(isSentenceEnd(text, text.indexOf('5.') + 1)).toBe(false);
    expect(isSentenceEnd(text, text.length - 1)).toBe(true);
  });
});

describe('clipAtClauseEnd', () => {
  it('括弧の中のカンマでは切らない', () => {
    expect(
      clipAtClauseEnd("this fails (e.g., the server's certificate could not be verified), then …")
    ).toBe("this fails (e.g., the server's certificate could not be verified)");
  });

  it('節番号のピリオドでは切らない', () => {
    expect(
      clipAtClauseEnd('mask all frames that it sends to the server (see Section 5.3).  Next')
    ).toBe('mask all frames that it sends to the server (see Section 5.3)');
  });

  it('括弧の外のカンマで切る', () => {
    expect(clipAtClauseEnd('the window shrinks to zero, then probe it')).toBe(
      'the window shrinks to zero'
    );
  });
});

describe('平文で書かれた別文書参照', () => {
  it('"Section 3.4 of RFC 1122" をこの RFC の節にしない', () => {
    // sectionFormat="bare" の xref は地の文が文書名を書く形になる
    const refs = extractCrossReferences(
      'see the generic call GET_MAXSIZES in Section 3.4 of RFC 1122.'
    );

    expect(refs.filter((r) => r.type === 'section')).toHaveLength(0);
    expect(refs.find((r) => r.type === 'external')?.section).toBe('3.4');
  });

  it('"RFC 6691, Section 3.1" をこの RFC の節にしない', () => {
    const refs = extractCrossReferences('as explained in RFC 6691, Section 3.1.');

    expect(refs.filter((r) => r.type === 'section')).toHaveLength(0);
    expect(refs.find((r) => r.type === 'external')?.section).toBe('3.1');
  });

  it('同じ文にこの RFC の節があれば、そちらは残す', () => {
    const refs = extractCrossReferences(
      'See Section 3.7.2 here; the value is defined in Section 3.4 of RFC 1122.'
    );

    expect(refs.filter((r) => r.type === 'section').map((r) => r.section)).toEqual(['3.7.2']);
    expect(refs.filter((r) => r.type === 'external').map((r) => r.section)).toEqual(['3.4']);
  });
});

describe('looksLikeDiagram', () => {
  it('ABNF の規則を図として扱う', () => {
    expect(looksLikeDiagram('frame-rsv1              = %x0 / %x1')).toBe(true);
    expect(looksLikeDiagram('extension-param = token [ "=" (token | quoted-string) ]')).toBe(true);
  });

  it('図の罫線を図として扱う', () => {
    expect(looksLikeDiagram('+-+-+-+-+-------+-+-------------+')).toBe(true);
  });

  it('散文は図として扱わない', () => {
    expect(looksLikeDiagram('A client MUST mask all frames that it sends to the server.')).toBe(
      false
    );
  });
});

describe('stripListMarker', () => {
  it('RFC の黒丸 "o" を落とす', () => {
    expect(stripListMarker('o  Message fragments MUST be delivered in order.')).toBe(
      'Message fragments MUST be delivered in order.'
    );
  });

  it('散文の先頭は削らない', () => {
    expect(stripListMarker('The server MUST close the connection.')).toBe(
      'The server MUST close the connection.'
    );
  });
});

describe('requirementSource', () => {
  const abnf = [
    'frame-rsv1              = %x0 / %x1',
    '                          ; 1 bit in length, MUST be 0 unless',
    '                          ; negotiated otherwise',
  ].join('\n');

  it('ABNF の注釈を 1 行の散文に組み直す', () => {
    const position = abnf.indexOf('MUST');
    const source = requirementSource(abnf, position, 'MUST');

    expect(source.text).toBe('1 bit in length, MUST be 0 unless negotiated otherwise');
    expect(source.prose).toBe(true);
    expect(source.text.slice(source.position, source.position + 4)).toBe('MUST');
  });

  it('図の本体は畳まない', () => {
    const figure = 'frame-fin = %x0 / %x1 MUST be set';
    const source = requirementSource(figure, figure.indexOf('MUST'), 'MUST');

    expect(source.prose).toBe(false);
  });

  it('散文は畳む対象にする', () => {
    const prose = 'A client MUST mask all frames\n   that it sends to the server.';
    const source = requirementSource(prose, prose.indexOf('MUST'), 'MUST');

    expect(source.prose).toBe(true);
    expect(foldWhitespace(source.text)).toBe(
      'A client MUST mask all frames that it sends to the server.'
    );
  });
});

describe('clipAtClauseEnd の並列', () => {
  it('3 項目以上の並びでは切らない', () => {
    expect(clipAtClauseEnd('be either text, binary, or one of the reserved opcodes.')).toBe(
      'be either text, binary, or one of the reserved opcodes'
    );
  });

  it('接続詞の前に並びの目印が無い読点では切る', () => {
    // 節の連結であって並列ではない
    expect(
      clipAtClauseEnd('be delivered in the order sent by the sender, and the receiver checks it.')
    ).toBe('be delivered in the order sent by the sender');
  });

  it('括弧の中の読点では切らない（既存の挙動）', () => {
    expect(clipAtClauseEnd('perform a TLS handshake (e.g., over TCP) before sending.')).toBe(
      'perform a TLS handshake (e.g., over TCP) before sending'
    );
  });
});
