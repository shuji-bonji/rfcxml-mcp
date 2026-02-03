/**
 * Common Constants
 * BCP 14 / RFC 2119 keywords and patterns
 */

import type { RequirementLevel } from './types/index.js';

// ========================================
// RFC Number Limits
// ========================================

/**
 * RFC number validation limits
 * Current highest RFC is around 9700 (as of 2025)
 */
export const RFC_NUMBER_LIMITS = {
  /** Minimum valid RFC number */
  MIN: 1,
  /** Maximum valid RFC number (reasonable upper bound) */
  MAX: 99999,
} as const;

// ========================================
// BCP 14 / RFC 2119 Keywords
// ========================================

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

// ========================================
// Section Patterns
// ========================================

/**
 * Section number pattern for parsing RFC text
 * Matches: "1.", "1.1", "1.1.1", etc. followed by title
 * Used in text-based RFC parsing
 */
export const SECTION_HEADER_PATTERN = /^(\d+(?:\.\d+)*\.?)\s+(.+)$/;

/**
 * Create a section header pattern regex instance
 * Safe for use in loops with exec()
 */
export function createSectionHeaderRegex(): RegExp {
  return new RegExp(SECTION_HEADER_PATTERN.source);
}

// ========================================
// Cross-Reference Patterns
// ========================================

/**
 * RFC reference pattern (e.g., "RFC 1234", "RFC1234")
 */
export function createRFCReferenceRegex(): RegExp {
  return /RFC\s*(\d+)/gi;
}

/**
 * Section reference pattern (e.g., "Section 1.2", "section 3.4.5")
 */
export function createSectionReferenceRegex(): RegExp {
  return /[Ss]ection\s+([\d.]+)/g;
}

// RFC-related configuration is centralized in config.ts
// - RFC_CONFIG.xmlAvailableFrom
// - isRFCXMLLikelyAvailable()
