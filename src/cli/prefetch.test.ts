/**
 * rfcxml-prefetch の引数検証（Issue #17）
 *
 * `parseInt` は `9110abc` を 9110 として通していた。
 */
import { describe, it, expect } from 'vitest';
import { parseRFCNumber } from './prefetch.js';

describe('parseRFCNumber', () => {
  it('accepts digits only', () => {
    expect(parseRFCNumber('9110', '--rfc')).toBe(9110);
    expect(parseRFCNumber('1', '--rfc')).toBe(1);
  });

  it('rejects trailing garbage, signs, floats and empty values', () => {
    for (const bad of ['9110abc', 'abc', '', '-1', '0', '1.5', '+9', ' 9110', undefined]) {
      expect(() => parseRFCNumber(bad, '--rfc')).toThrow('--rfc expects a positive integer');
    }
  });
});
