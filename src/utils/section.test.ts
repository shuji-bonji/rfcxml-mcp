import { describe, it, expect } from 'vitest';
import { normalizeSectionNumber } from './section.js';

describe('後付録の節番号', () => {
  it('appendix.a.2.5 を A.2.5 にする', () => {
    expect(normalizeSectionNumber('section-appendix.a.2.5')).toBe('A.2.5');
  });

  it('e.1 を E.1 にする', () => {
    // RFC 8949 は 1 段目を `section-appendix.e`、2 段目を `section-e.1` と書く。
    // 小文字のまま返すと、テキスト経路が返す `E.1` と食い違う。
    expect(normalizeSectionNumber('section-e.1')).toBe('E.1');
  });

  it('数字の節はそのまま', () => {
    expect(normalizeSectionNumber('section-7.1')).toBe('7.1');
  });

  it('複数文字の目印は直さない', () => {
    expect(normalizeSectionNumber('section-toc.1')).toBe('toc.1');
  });
});
