/**
 * Validation Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import { validateRFCNumber, isValidRFCNumber } from './validation.js';
import { RFC_NUMBER_LIMITS } from '../constants.js';

describe('validateRFCNumber', () => {
  describe('valid RFC numbers', () => {
    it('should accept minimum valid RFC number', () => {
      expect(() => validateRFCNumber(RFC_NUMBER_LIMITS.MIN)).not.toThrow();
    });

    it('should accept maximum valid RFC number', () => {
      expect(() => validateRFCNumber(RFC_NUMBER_LIMITS.MAX)).not.toThrow();
    });

    it('should accept typical RFC numbers', () => {
      expect(() => validateRFCNumber(791)).not.toThrow(); // IP
      expect(() => validateRFCNumber(2119)).not.toThrow(); // BCP 14
      expect(() => validateRFCNumber(9293)).not.toThrow(); // TCP
    });
  });

  describe('invalid RFC numbers - type errors', () => {
    it('should reject string input', () => {
      expect(() => validateRFCNumber('1234')).toThrow('RFC number must be a number');
    });

    it('should reject null', () => {
      expect(() => validateRFCNumber(null)).toThrow('RFC number must be a number');
    });

    it('should reject undefined', () => {
      expect(() => validateRFCNumber(undefined)).toThrow('RFC number must be a number');
    });

    it('should reject object', () => {
      expect(() => validateRFCNumber({ rfc: 1234 })).toThrow('RFC number must be a number');
    });

    it('should reject array', () => {
      expect(() => validateRFCNumber([1234])).toThrow('RFC number must be a number');
    });

    it('should reject boolean', () => {
      expect(() => validateRFCNumber(true)).toThrow('RFC number must be a number');
    });
  });

  describe('invalid RFC numbers - not integer', () => {
    it('should reject floating point numbers', () => {
      expect(() => validateRFCNumber(1234.5)).toThrow('RFC number must be an integer');
    });

    it('should reject NaN', () => {
      expect(() => validateRFCNumber(NaN)).toThrow('RFC number must be an integer');
    });

    it('should reject Infinity', () => {
      expect(() => validateRFCNumber(Infinity)).toThrow('RFC number must be an integer');
    });

    it('should reject negative Infinity', () => {
      expect(() => validateRFCNumber(-Infinity)).toThrow('RFC number must be an integer');
    });
  });

  describe('invalid RFC numbers - out of range', () => {
    it('should reject RFC number 0', () => {
      expect(() => validateRFCNumber(0)).toThrow('RFC number must be positive');
    });

    it('should reject negative RFC numbers', () => {
      expect(() => validateRFCNumber(-1)).toThrow('RFC number must be positive');
      expect(() => validateRFCNumber(-100)).toThrow('RFC number must be positive');
    });

    it('should reject RFC number exceeding maximum', () => {
      expect(() => validateRFCNumber(RFC_NUMBER_LIMITS.MAX + 1)).toThrow(
        'seems invalid (too large)'
      );
    });

    it('should reject very large RFC numbers', () => {
      expect(() => validateRFCNumber(1000000)).toThrow('seems invalid (too large)');
    });
  });
});

describe('isValidRFCNumber', () => {
  describe('valid RFC numbers', () => {
    it('should return true for minimum valid RFC number', () => {
      expect(isValidRFCNumber(RFC_NUMBER_LIMITS.MIN)).toBe(true);
    });

    it('should return true for maximum valid RFC number', () => {
      expect(isValidRFCNumber(RFC_NUMBER_LIMITS.MAX)).toBe(true);
    });

    it('should return true for typical RFC numbers', () => {
      expect(isValidRFCNumber(791)).toBe(true);
      expect(isValidRFCNumber(2119)).toBe(true);
      expect(isValidRFCNumber(9293)).toBe(true);
    });
  });

  describe('invalid RFC numbers', () => {
    it('should return false for string input', () => {
      expect(isValidRFCNumber('1234')).toBe(false);
    });

    it('should return false for null', () => {
      expect(isValidRFCNumber(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidRFCNumber(undefined)).toBe(false);
    });

    it('should return false for floating point numbers', () => {
      expect(isValidRFCNumber(1234.5)).toBe(false);
    });

    it('should return false for NaN', () => {
      expect(isValidRFCNumber(NaN)).toBe(false);
    });

    it('should return false for RFC number 0', () => {
      expect(isValidRFCNumber(0)).toBe(false);
    });

    it('should return false for negative RFC numbers', () => {
      expect(isValidRFCNumber(-1)).toBe(false);
    });

    it('should return false for RFC number exceeding maximum', () => {
      expect(isValidRFCNumber(RFC_NUMBER_LIMITS.MAX + 1)).toBe(false);
    });
  });

  describe('type guard behavior', () => {
    it('should narrow type correctly', () => {
      const input: unknown = 9293;

      if (isValidRFCNumber(input)) {
        // TypeScript should now know input is a number
        const rfcNum: number = input;
        expect(rfcNum).toBe(9293);
      } else {
        // This branch should not be reached
        expect.fail('Should have been a valid RFC number');
      }
    });
  });
});

describe('RFC_NUMBER_LIMITS', () => {
  it('should have valid MIN and MAX values', () => {
    expect(RFC_NUMBER_LIMITS.MIN).toBe(1);
    expect(RFC_NUMBER_LIMITS.MAX).toBe(99999);
    expect(RFC_NUMBER_LIMITS.MIN).toBeLessThan(RFC_NUMBER_LIMITS.MAX);
  });
});
