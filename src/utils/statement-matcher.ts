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
 * 否定パターンのマッピング
 * キーワードとその否定形を関連付ける
 */
const NEGATION_PAIRS: Array<{ positive: string; negative: string[] }> = [
  {
    positive: 'mask',
    negative: ['unmask', 'unmasked', 'not mask', 'without mask', 'without masking'],
  },
  {
    positive: 'encrypt',
    negative: ['unencrypt', 'unencrypted', 'not encrypt', 'without encrypt', 'without encryption'],
  },
  {
    positive: 'validate',
    negative: [
      'not validate',
      'skip validation',
      'skips validation',
      'without validation',
      'no validation',
    ],
  },
  {
    positive: 'verify',
    negative: ['not verify', 'unverified', 'without verification', 'skip verification'],
  },
  {
    positive: 'authenticate',
    negative: [
      'unauthenticated',
      'not authenticate',
      'without authentication',
      'skip authentication',
    ],
  },
  { positive: 'send', negative: ['not send', 'never send', 'block'] },
  { positive: 'receive', negative: ['not receive', 'reject', 'ignore'] },
  { positive: 'accept', negative: ['reject', 'not accept', 'refuse'] },
  { positive: 'include', negative: ['exclude', 'omit', 'not include'] },
  { positive: 'support', negative: ['not support', 'unsupported'] },
  { positive: 'allow', negative: ['disallow', 'not allow', 'forbid', 'prohibit'] },
  { positive: 'enable', negative: ['disable', 'not enable'] },
  { positive: 'close', negative: ['not close', 'keep open'] },
  { positive: 'open', negative: ['not open', 'close'] },
];

/**
 * テキストが positive アクションを含むか判定（negative でないことを確認）
 * "masks" → true, "unmasked" → false
 */
function hasPositiveAction(text: string, pair: { positive: string; negative: string[] }): boolean {
  const lower = text.toLowerCase();
  // まず negative をチェック - negative があれば positive ではない
  if (pair.negative.some((neg) => lower.includes(neg))) {
    return false;
  }
  // negative がなければ positive の存在をチェック
  return lower.includes(pair.positive);
}

/**
 * テキストが negative アクションを含むか判定
 */
function hasNegativeAction(text: string, pair: { positive: string; negative: string[] }): boolean {
  const lower = text.toLowerCase();
  return pair.negative.some((neg) => lower.includes(neg));
}

/**
 * 2つのアクションが矛盾するかチェック
 */
function actionsContradict(action1: string, action2: string): boolean {
  for (const pair of NEGATION_PAIRS) {
    const hasPositive1 = hasPositiveAction(action1, pair);
    const hasNegative1 = hasNegativeAction(action1, pair);
    const hasPositive2 = hasPositiveAction(action2, pair);
    const hasNegative2 = hasNegativeAction(action2, pair);

    // 一方が positive、他方が negative なら矛盾
    if ((hasPositive1 && hasNegative2) || (hasNegative1 && hasPositive2)) {
      return true;
    }
  }

  return false;
}

/**
 * Detect conflicts between statement and requirements
 */
export function detectConflicts(statement: string, requirements: Requirement[]): ConflictResult[] {
  const conflicts: ConflictResult[] = [];
  const statementLevel = extractRequirementLevel(statement);
  const statementSubject = extractSubject(statement);

  // Subject is still required for meaningful conflict detection
  if (!statementSubject) {
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
  const statementLower = statement.toLowerCase();

  for (const req of requirements) {
    const reqSubject = req.subject?.toLowerCase() || extractSubject(req.text);

    // Only check requirements with matching subject
    if (reqSubject !== statementSubject) continue;

    // Check 1: Level-based conflicts (existing logic)
    if (statementLevel) {
      const conflicting = conflictingLevels[statementLevel] || [];
      if (conflicting.includes(req.level)) {
        const reqText = req.text.toLowerCase();
        let overlap = 0;
        for (const [keyword] of statementKeywords) {
          if (reqText.includes(keyword)) overlap++;
        }

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
          continue; // Already found conflict, skip semantic check
        }
      }
    }

    // Check 2: Semantic conflicts (new logic)
    // Even without explicit level, detect action contradictions
    const reqAction = req.action || req.text;
    const reqLevel = req.level;

    // For MUST requirements: check if statement contradicts the required action
    if (reqLevel === 'MUST' || reqLevel === 'SHALL' || reqLevel === 'REQUIRED') {
      if (actionsContradict(statementLower, reqAction)) {
        conflicts.push({
          requirement: req,
          reason: `Statement action contradicts "${reqLevel}" requirement: "${req.action || req.text}"`,
          statementLevel,
          requirementLevel: reqLevel,
        });
        continue;
      }
    }

    // For MUST NOT requirements: check if statement does the forbidden action
    if (reqLevel === 'MUST NOT' || reqLevel === 'SHALL NOT') {
      // Extract the forbidden action (after MUST NOT)
      const forbiddenAction = reqAction.replace(/must not|shall not/gi, '').trim();

      // Find the PRIMARY forbidden action (the verb that appears first)
      // Only check that specific pair to avoid false positives
      for (const pair of NEGATION_PAIRS) {
        // Check if this pair's positive verb is the primary forbidden action
        // by checking if it appears early in the forbidden action text
        const forbiddenLower = forbiddenAction.toLowerCase();
        const verbIndex = forbiddenLower.indexOf(pair.positive);

        // Only consider this pair if the positive verb appears in the first 20 chars
        // (to identify the primary forbidden action, not incidental mentions)
        if (verbIndex === -1 || verbIndex > 20) continue;

        const statementDoesPositive = hasPositiveAction(statementLower, pair);

        if (statementDoesPositive) {
          conflicts.push({
            requirement: req,
            reason: `Statement does what "${reqLevel}" forbids: "${forbiddenAction}"`,
            statementLevel,
            requirementLevel: reqLevel,
          });
          break;
        }
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
