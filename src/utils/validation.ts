/**
 * Input Validation Utilities
 */

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
  if (rfc < 1) {
    throw new Error(`RFC number must be positive, got ${rfc}`);
  }
  // Current highest RFC is around 9700 (as of 2025), set reasonable upper bound
  if (rfc > 99999) {
    throw new Error(`RFC number ${rfc} seems invalid (too large)`);
  }
}

/**
 * Check if RFC number is valid (non-throwing version)
 */
export function isValidRFCNumber(rfc: unknown): rfc is number {
  return typeof rfc === 'number' && Number.isInteger(rfc) && rfc >= 1 && rfc <= 99999;
}
