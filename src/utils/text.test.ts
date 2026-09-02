/**
 * テキストユーティリティのテスト
 */

import { describe, it, expect } from 'vitest';
import { extractCrossReferences } from './text.js';

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
