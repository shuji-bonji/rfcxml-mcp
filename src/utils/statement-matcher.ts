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
  /**
   * 判定（isValid）を下すために最上位マッチに要求する最小スコア。
   *
   * 主語一致ボーナス (5) にキーワード 2 語 (1+1) を加えた値。これに届かない
   * 場合は、たまたま単語がかすった程度の一致でしかなく、準拠しているとも
   * 違反しているとも言えない。そのときは true/false ではなく null を返す。
   */
  MIN_SCORE_FOR_VERDICT: 7,
  /**
   * 要求アクションの主動詞とみなす、アクション文字列先頭からの文字数。
   * これを超えて現れる動詞は付随的な言及として扱う。
   */
  ACTION_VERB_WINDOW: 20,
  /**
   * 判定（isValid）を下すために最上位マッチに要求する、主語以外の一致語数。
   *
   * 主語だけが一致した状態（"The client" とだけ書いた主張）でもスコアは
   * 主語一致ボーナス 5 + 主語語 3 = 8 になり `MIN_SCORE_FOR_VERDICT` を超える。
   * 主語は「誰の話か」しか示さないので、何を論じているかを示す語を別に求める。
   */
  MIN_CONTENT_KEYWORDS_FOR_VERDICT: 2,
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
 * スコアに数えない語。
 *
 * 3 文字以上の機能語（and / for / not など）が抜けていたため、内容の一致が無い
 * 要件でも機能語だけでスコアが積み上がり、順位が内容ではなく機能語で決まっていた。
 * BCP 14 キーワード（must / should / may など）もここに入れる。ほぼ全ての要件文に
 * 現れるうえ、レベルの一致は `LEVEL_MATCH_BONUS` が別に見ているためである。
 *
 * `MIN_KEYWORD_LENGTH` により 2 文字以下（a / an / of / to / is など）は
 * ここに書かなくても除外される。
 */
const STOP_WORDS = new Set([
  // 接続詞・前置詞・限定詞
  'and',
  'nor',
  'but',
  'yet',
  'for',
  'per',
  'via',
  'out',
  'off',
  'all',
  'any',
  'few',
  'both',
  'many',
  'every',
  'else',
  'onto',
  'upon',
  'under',
  'above',
  'below',
  'between',
  'within',
  'without',
  'during',
  'while',
  'because',
  'since',
  'until',
  'unless',
  'though',
  'although',
  'however',
  'therefore',
  'thus',
  'here',
  'how',
  'why',
  'who',
  'whom',
  'whose',
  // 代名詞
  'its',
  'his',
  'her',
  'hers',
  'our',
  'ours',
  'your',
  'yours',
  'itself',
  'themselves',
  // 助動詞・繋辞
  'are',
  'was',
  'were',
  'had',
  'has',
  'did',
  'done',
  'can',
  'cannot',
  'might',
  'ought',
  'need',
  // BCP 14 キーワード（レベル一致は LEVEL_MATCH_BONUS が別に見る）
  'must',
  'shall',
  'should',
  'may',
  'not',
  'required',
  'recommended',
  'optional',
  // その他の一般語
  'new',
  'non',
  'one',
  'two',
  'use',
  'uses',
  'using',
  'way',
  'ways',
  'thing',
  'things',
  'part',
  'parts',
  'just',
  'very',
  'much',
  'still',
  'even',
  'again',
  'once',
  'well',
  'like',
  // 既存の語

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
 * 語形の違いを吸収するための候補を返す。
 *
 * 一致は素の部分文字列比較なので、主張が "masks" と書き要件が "mask" と書くと
 * 一致しない。逆（主張が短く要件が長い）は部分文字列で拾えるため、
 * ここでは主張側の語尾だけを落とす。
 *
 * 落としすぎないよう、残る語幹が 4 文字以上ある場合に限る。
 */
function keywordVariants(keyword: string): string[] {
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (keyword.endsWith(suffix) && keyword.length - suffix.length >= 4) {
      return [keyword, keyword.slice(0, -suffix.length)];
    }
  }
  return [keyword];
}

/**
 * 要件文がその語（または語幹）を含むか。
 */
function requirementTextHasKeyword(requirementText: string, keyword: string): boolean {
  return keywordVariants(keyword).some((variant) => requirementText.includes(variant));
}

/**
 * その語が主語語（client / server など）かどうか。
 * 判定に必要な「主語以外の一致語」を数えるために公開している。
 */
export function isSubjectTerm(word: string): boolean {
  return SUBJECT_TERMS.has(word.toLowerCase());
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
    if (requirementTextHasKeyword(reqText, keyword)) {
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
interface NegationPair {
  positive: string;
  negative: string[];
  /**
   * 動詞そのものが具体性を持たないもの。send / receive / include などは
   * ほとんどの要件文に現れるため、動詞の一致だけでは同じ事柄を論じている
   * 証拠にならない。これらは動詞以外に共通する語があることを追加で求める。
   */
  generic?: true;
}

const NEGATION_PAIRS: NegationPair[] = [
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
  { positive: 'send', negative: ['not send', 'never send', 'block'], generic: true },
  { positive: 'receive', negative: ['not receive', 'reject', 'ignore'], generic: true },
  { positive: 'accept', negative: ['reject', 'not accept', 'refuse'], generic: true },
  { positive: 'include', negative: ['exclude', 'omit', 'not include'], generic: true },
  { positive: 'support', negative: ['not support', 'unsupported'], generic: true },
  { positive: 'allow', negative: ['disallow', 'not allow', 'forbid', 'prohibit'], generic: true },
  { positive: 'enable', negative: ['disable', 'not enable'], generic: true },
  { positive: 'close', negative: ['not close', 'keep open'], generic: true },
  { positive: 'open', negative: ['not open', 'close'], generic: true },
];

/**
 * テキストが positive アクションを含むか判定（negative でないことを確認）
 * "masks" → true, "unmasked" → false
 */
function hasPositiveAction(text: string, pair: NegationPair): boolean {
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
function hasNegativeAction(text: string, pair: NegationPair): boolean {
  const lower = text.toLowerCase();
  return pair.negative.some((neg) => lower.includes(neg));
}

/**
 * 要件文からキーワード直後の部分（＝求められているアクション）を取り出す。
 *
 * `Requirement.action` は「キーワード直後から最初の句読点まで」を狙う正規表現で
 * 作られるが、RFC 本文は 72 桁で折り返されるため改行に阻まれて解析できないことが
 * 多く、テキスト経路では大半が undefined になる。矛盾検出はキーワードより
 * 後ろだけを見れば足りるので、ここで切り出して補う。
 *
 * キーワードより前（条件節など）を含めないことが要点である。RFC 6455 §4.2.1 の
 * "finds that the client did not send a handshake ... the server MUST stop
 * processing ..." のように、条件節の否定を要求アクションと取り違えると
 * 無関係な矛盾を報告してしまう。
 *
 * @returns アクション文字列。キーワードが見つからなければ `null`（検査対象外）
 */
export function requiredActionOf(requirement: Requirement): string | null {
  if (requirement.action) return requirement.action;

  // "MUST" が "MUST NOT" の一部を指さないようにする
  const escapedLevel = requirement.level.replace(/\s+/g, '\\s+');
  const negationGuard = requirement.level.endsWith('NOT') ? '' : '(?!\\s+NOT)';
  const match = new RegExp(`\\b${escapedLevel}\\b${negationGuard}`).exec(requirement.text);
  if (!match) return null;

  const action = requirement.text.slice(match.index + match[0].length).trim();
  return action.length > 0 ? action : null;
}

/**
 * 矛盾が「同じ事柄について」のものかを確かめる。
 *
 * `generic` な動詞では、動詞が一致しただけでは足りない。RFC 6455 §4 の
 * "the server MUST NOT send back a |Sec-WebSocket-Protocol| header field" と
 * 「サーバがマスクなしのフレームを送る」は、どちらも send だが対象が別物である。
 * 動詞以外に共通する語が 1 つも無ければ、同じ事柄を論じていないと判断する。
 *
 * `mask` / `encrypt` のように動詞自体が具体的なものは、目的語が共通していなくても
 * 矛盾として意味を成すため、この検査を課さない。
 */
function sharesActionContext(
  statementKeywords: Map<string, number>,
  actionText: string,
  pair: NegationPair
): boolean {
  if (!pair.generic) return true;

  const action = actionText.toLowerCase();

  for (const [keyword] of statementKeywords) {
    // 動詞そのもの（send / sends のような語形違いを含む）は数えない
    if (keyword.startsWith(pair.positive) || pair.positive.startsWith(keyword)) continue;
    if (requirementTextHasKeyword(action, keyword)) return true;
  }

  return false;
}

/**
 * 検出した矛盾の内訳
 */
export interface ActionContradiction {
  /** 要求側が求めているアクション（NEGATION_PAIRS の positive） */
  positive: string;
  /** 主張側で見つかった否定表現 */
  matchedNegative: string;
}

/**
 * 「要求が求めるアクション」と「主張の否定表現」の実一致を探す。
 *
 * 引数の `requiredAction` には要件文全体ではなく `Requirement.action`
 * （キーワード直後の要求アクション）だけを渡すこと。要件文全体を渡すと、
 * 条件節に含まれる無関係な否定（例: RFC 6455 §4.2.1 の
 * "finds that the client did not send a handshake ..."）を要求アクションと
 * 取り違えて矛盾を誤検出する。
 *
 * 判定条件は 2 つとも満たすこと。
 * 1. 要求アクションの先頭付近に肯定形の動詞があり、要求側自身が否定形でないこと
 * 2. 主張側にその動詞の否定表現が実際に現れること
 */
export function findActionContradiction(
  statement: string,
  requiredAction: string,
  statementKeywords: Map<string, number> = extractKeywords(statement)
): ActionContradiction | null {
  const statementLower = statement.toLowerCase();
  const actionLower = requiredAction.toLowerCase();

  for (const pair of NEGATION_PAIRS) {
    const verbIndex = actionLower.indexOf(pair.positive);
    if (verbIndex === -1 || verbIndex > MATCHING_LIMITS.ACTION_VERB_WINDOW) continue;

    // 要求側が否定形（"MUST ... not mask ..."）ならこの枝では扱わない
    if (hasNegativeAction(actionLower, pair)) continue;

    const matchedNegative = pair.negative.find((neg) => statementLower.includes(neg));
    if (!matchedNegative) continue;

    // 一般的な動詞では、動詞が一致しただけの当たりを落とす
    if (!sharesActionContext(statementKeywords, actionLower, pair)) continue;

    return { positive: pair.positive, matchedNegative };
  }

  return null;
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
          if (requirementTextHasKeyword(reqText, keyword)) overlap++;
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

    // Check 2: 否定表現の実一致による矛盾検出
    //
    // 要求側はキーワードより後ろだけを見る。以前は要件文全体を見ていたため、
    // 条件節の無関係な否定を拾って矛盾を誤検出していた。
    const reqAction = requiredActionOf(req);
    const reqLevel = req.level;

    // For MUST requirements: check if statement contradicts the required action
    if (reqAction && (reqLevel === 'MUST' || reqLevel === 'SHALL' || reqLevel === 'REQUIRED')) {
      const contradiction = findActionContradiction(statementLower, reqAction, statementKeywords);
      if (contradiction) {
        conflicts.push({
          requirement: req,
          reason: `Statement says "${contradiction.matchedNegative}" while the "${reqLevel}" requirement requires "${contradiction.positive}": "${reqAction}"`,
          statementLevel,
          requirementLevel: reqLevel,
        });
        continue;
      }
    }

    // For MUST NOT requirements: check if statement does the forbidden action
    if (reqLevel === 'MUST NOT' || reqLevel === 'SHALL NOT') {
      // Extract the forbidden action (after MUST NOT)
      const forbiddenAction = (reqAction ?? '').replace(/must not|shall not/gi, '').trim();

      // Find the PRIMARY forbidden action (the verb that appears first)
      // Only check that specific pair to avoid false positives
      for (const pair of NEGATION_PAIRS) {
        // Check if this pair's positive verb is the primary forbidden action
        // by checking if it appears early in the forbidden action text
        const forbiddenLower = forbiddenAction.toLowerCase();
        const verbIndex = forbiddenLower.indexOf(pair.positive);

        // Only consider this pair if the positive verb appears near the start
        // (to identify the primary forbidden action, not incidental mentions)
        if (verbIndex === -1 || verbIndex > MATCHING_LIMITS.ACTION_VERB_WINDOW) continue;

        const statementDoesPositive = hasPositiveAction(statementLower, pair);

        // 一般的な動詞では、動詞が一致しただけの当たりを落とす（例: "MUST NOT send
        // back a |Sec-WebSocket-Protocol| header field" と「マスクなしのフレームを送る」）
        if (
          statementDoesPositive &&
          sharesActionContext(statementKeywords, forbiddenAction, pair)
        ) {
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
