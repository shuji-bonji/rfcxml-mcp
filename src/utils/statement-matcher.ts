/**
 * Statement Matcher Utility
 * Weighted matching for validate_statement tool
 */

import type { Requirement, RequirementLevel } from '../types/index.js';
import { createRequirementRegex } from '../constants.js';

// ========================================
// Matching Configuration
// ========================================

/**
 * マッチングに使用する重み設定
 */
export const MATCHING_WEIGHTS = {
  /** 通常の単語の重み */
  REGULAR_TERM: 1,
  /** 技術用語の重み */
  TECHNICAL_TERM: 2,
  /** 主語（client, server等）の重み */
  SUBJECT_TERM: 3,
  /** 主語一致時のボーナススコア */
  SUBJECT_MATCH_BONUS: 5,
  /** 要件レベル一致時のボーナススコア */
  LEVEL_MATCH_BONUS: 3,
} as const;

/**
 * マッチング処理の制限値
 */
export const MATCHING_LIMITS = {
  /** キーワードとして認識する最小文字数 */
  MIN_KEYWORD_LENGTH: 3,
  /** 競合検出に必要な最小キーワード重複数 */
  MIN_OVERLAP_FOR_CONFLICT: 2,
  /** 短いステートメントとみなすキーワード数 */
  SHORT_STATEMENT_THRESHOLD: 3,
  /** デフォルトの最大結果数 */
  DEFAULT_MAX_RESULTS: 10,
} as const;

/**
 * Match result with score
 */
export interface MatchResult {
  requirement: Requirement;
  score: number;
  matchedKeywords: string[];
  subjectMatch: boolean;
  levelMatch: boolean;
}

/**
 * Conflict result
 */
export interface ConflictResult {
  requirement: Requirement;
  reason: string;
  statementLevel: RequirementLevel | null;
  requirementLevel: RequirementLevel;
}

/**
 * Technical terms that should have higher weight
 */
const TECHNICAL_TERMS = new Set([
  // Protocol terms
  'client',
  'server',
  'sender',
  'receiver',
  'endpoint',
  'connection',
  'request',
  'response',
  'message',
  'packet',
  'segment',
  'frame',
  'header',
  'payload',
  'handshake',
  // TCP/IP terms
  'port',
  'socket',
  'stream',
  'timeout',
  'retransmit',
  'acknowledgment',
  'sequence',
  'congestion',
  // HTTP terms
  'method',
  'status',
  'resource',
  'cache',
  'proxy',
  'origin',
  // Security terms
  'authentication',
  'authorization',
  'certificate',
  'encryption',
  'signature',
  'token',
  // General technical
  'implementation',
  'specification',
  'protocol',
  'algorithm',
  'parameter',
  'field',
  'value',
  'error',
  'failure',
  'valid',
  'invalid',
]);

/**
 * Common words to ignore (low weight)
 */
const STOP_WORDS = new Set([
  'the',
  'this',
  'that',
  'with',
  'from',
  'have',
  'been',
  'will',
  'when',
  'where',
  'what',
  'which',
  'there',
  'their',
  'they',
  'them',
  'than',
  'then',
  'each',
  'other',
  'some',
  'such',
  'only',
  'also',
  'more',
  'most',
  'case',
  'does',
  'into',
  'over',
  'used',
  'same',
  'after',
  'before',
  'about',
  'being',
  'could',
  'would',
  'should',
  'could',
]);

/**
 * Subject terms that identify the actor
 */
const SUBJECT_TERMS = new Set([
  'client',
  'server',
  'sender',
  'receiver',
  'endpoint',
  'implementation',
  'peer',
  'host',
  'proxy',
  'application',
  'user',
  'agent',
]);

/**
 * Extract keywords from text with weights
 */
export function extractKeywords(text: string): Map<string, number> {
  const keywords = new Map<string, number>();
  const words = text.toLowerCase().split(/\s+/);

  for (const word of words) {
    // Clean word (remove punctuation)
    const cleaned = word.replace(/[^a-z0-9]/g, '');
    if (cleaned.length < MATCHING_LIMITS.MIN_KEYWORD_LENGTH) continue;
    if (STOP_WORDS.has(cleaned)) continue;

    // Assign weight based on term type
    let weight: number = MATCHING_WEIGHTS.REGULAR_TERM;
    if (TECHNICAL_TERMS.has(cleaned)) {
      weight = MATCHING_WEIGHTS.TECHNICAL_TERM;
    }
    if (SUBJECT_TERMS.has(cleaned)) {
      weight = MATCHING_WEIGHTS.SUBJECT_TERM;
    }

    // Accumulate weight for repeated terms
    keywords.set(cleaned, (keywords.get(cleaned) || 0) + weight);
  }

  return keywords;
}

/**
 * Extract requirement level from text
 */
export function extractRequirementLevel(text: string): RequirementLevel | null {
  const regex = createRequirementRegex();
  const match = regex.exec(text.toUpperCase());
  if (match) {
    return match[1] as RequirementLevel;
  }
  return null;
}

/**
 * Extract subject from text
 */
export function extractSubject(text: string): string | null {
  const words = text.toLowerCase().split(/\s+/);
  for (const word of words) {
    const cleaned = word.replace(/[^a-z]/g, '');
    if (SUBJECT_TERMS.has(cleaned)) {
      return cleaned;
    }
  }
  return null;
}

/**
 * Score a requirement against statement keywords
 */
export function scoreRequirementMatch(
  requirement: Requirement,
  statementKeywords: Map<string, number>,
  statementSubject: string | null,
  statementLevel: RequirementLevel | null
): MatchResult {
  const reqText = (requirement.text + ' ' + (requirement.fullContext || '')).toLowerCase();
  const matchedKeywords: string[] = [];
  let score = 0;

  // Score based on keyword matches
  for (const [keyword, weight] of statementKeywords) {
    if (reqText.includes(keyword)) {
      matchedKeywords.push(keyword);
      score += weight;
    }
  }

  // Bonus for subject match
  const reqSubject = requirement.subject?.toLowerCase() || extractSubject(requirement.text);
  const subjectMatch = statementSubject !== null && reqSubject === statementSubject;
  if (subjectMatch) {
    score += MATCHING_WEIGHTS.SUBJECT_MATCH_BONUS;
  }

  // Bonus for requirement level match
  const levelMatch = statementLevel !== null && requirement.level === statementLevel;
  if (levelMatch) {
    score += MATCHING_WEIGHTS.LEVEL_MATCH_BONUS;
  }

  return {
    requirement,
    score,
    matchedKeywords,
    subjectMatch,
    levelMatch,
  };
}

/**
 * Detect conflicts between statement and requirements
 */
export function detectConflicts(statement: string, requirements: Requirement[]): ConflictResult[] {
  const conflicts: ConflictResult[] = [];
  const statementLevel = extractRequirementLevel(statement);
  const statementSubject = extractSubject(statement);

  if (!statementLevel || !statementSubject) {
    // Cannot detect conflicts without level and subject
    return conflicts;
  }

  // Define conflicting level pairs
  const conflictingLevels: Record<RequirementLevel, RequirementLevel[]> = {
    MAY: ['MUST', 'MUST NOT', 'SHALL', 'SHALL NOT'],
    OPTIONAL: ['MUST', 'MUST NOT', 'REQUIRED', 'SHALL', 'SHALL NOT'],
    SHOULD: ['MUST NOT', 'SHALL NOT'],
    'SHOULD NOT': ['MUST', 'SHALL', 'REQUIRED'],
    RECOMMENDED: ['MUST NOT', 'SHALL NOT'],
    'NOT RECOMMENDED': ['MUST', 'SHALL', 'REQUIRED'],
    MUST: [],
    'MUST NOT': [],
    REQUIRED: [],
    SHALL: [],
    'SHALL NOT': [],
  };

  const statementKeywords = extractKeywords(statement);

  for (const req of requirements) {
    const reqSubject = req.subject?.toLowerCase() || extractSubject(req.text);

    // Only check requirements with matching subject
    if (reqSubject !== statementSubject) continue;

    // Check for conflicting levels
    const conflicting = conflictingLevels[statementLevel] || [];
    if (conflicting.includes(req.level)) {
      // Additional check: keywords should overlap significantly
      const reqText = req.text.toLowerCase();
      let overlap = 0;
      for (const [keyword] of statementKeywords) {
        if (reqText.includes(keyword)) overlap++;
      }

      // Only report as conflict if there's significant keyword overlap
      if (
        overlap >= MATCHING_LIMITS.MIN_OVERLAP_FOR_CONFLICT ||
        statementKeywords.size <= MATCHING_LIMITS.SHORT_STATEMENT_THRESHOLD
      ) {
        conflicts.push({
          requirement: req,
          reason: `Statement uses "${statementLevel}" but requirement uses "${req.level}"`,
          statementLevel,
          requirementLevel: req.level,
        });
      }
    }
  }

  return conflicts;
}

/**
 * Match statement against requirements
 */
export function matchStatement(
  statement: string,
  requirements: Requirement[],
  options: { maxResults?: number } = {}
): {
  matches: MatchResult[];
  conflicts: ConflictResult[];
  statementLevel: RequirementLevel | null;
  statementSubject: string | null;
} {
  const { maxResults = MATCHING_LIMITS.DEFAULT_MAX_RESULTS } = options;

  const statementKeywords = extractKeywords(statement);
  const statementSubject = extractSubject(statement);
  const statementLevel = extractRequirementLevel(statement);

  // Score all requirements
  const scored = requirements.map((req) =>
    scoreRequirementMatch(req, statementKeywords, statementSubject, statementLevel)
  );

  // Filter and sort by score
  const matches = scored
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  // Detect conflicts
  const conflicts = detectConflicts(statement, requirements);

  return {
    matches,
    conflicts,
    statementLevel,
    statementSubject,
  };
}
