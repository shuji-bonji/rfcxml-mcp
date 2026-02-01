/**
 * Common Constants
 * BCP 14 / RFC 2119 keywords and patterns
 */

import type { RequirementLevel } from './types/index.js';

/**
 * BCP 14 / RFC 2119 keywords
 * Ordered by length (longer first to match "MUST NOT" before "MUST")
 */
export const REQUIREMENT_KEYWORDS: RequirementLevel[] = [
  'MUST NOT',
  'MUST',
  'REQUIRED',
  'SHALL NOT',
  'SHALL',
  'SHOULD NOT',
  'SHOULD',
  'RECOMMENDED',
  'NOT RECOMMENDED',
  'MAY',
  'OPTIONAL',
];

/**
 * Create a new requirement regex instance
 * Safe for use in loops with exec() - avoids lastIndex state issues
 */
export function createRequirementRegex(): RegExp {
  return new RegExp(`\\b(${REQUIREMENT_KEYWORDS.join('|')})\\b`, 'g');
}

/**
 * Keyword regex (matches longest first)
 * Note: When using with exec() in loops, prefer createRequirementRegex() to avoid lastIndex issues
 */
export const REQUIREMENT_REGEX = createRequirementRegex();

// RFC-related configuration is centralized in config.ts
// - RFC_CONFIG.xmlAvailableFrom
// - isRFCXMLLikelyAvailable()
