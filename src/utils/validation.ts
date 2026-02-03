/**
 * Input Validation Utilities
 */

import { RFC_NUMBER_LIMITS } from '../constants.js';

/**
 * Validate RFC number
 * @param rfc - RFC number to validate
 * @throws Error if invalid
 */
export function validateRFCNumber(rfc: unknown): asserts rfc is number {
  if (typeof rfc !== 'number') {
    throw new Error(`RFC number must be a number, got ${typeof rfc}`);
  }
  if (!Number.isInteger(rfc)) {
    throw new Error(`RFC number must be an integer, got ${rfc}`);
  }
  if (rfc < RFC_NUMBER_LIMITS.MIN) {
    throw new Error(`RFC number must be positive, got ${rfc}`);
  }
  if (rfc > RFC_NUMBER_LIMITS.MAX) {
    throw new Error(`RFC number ${rfc} seems invalid (too large)`);
  }
}

/**
 * Check if RFC number is valid (non-throwing version)
 */
export function isValidRFCNumber(rfc: unknown): rfc is number {
  return (
    typeof rfc === 'number' &&
    Number.isInteger(rfc) &&
    rfc >= RFC_NUMBER_LIMITS.MIN &&
    rfc <= RFC_NUMBER_LIMITS.MAX
  );
}
