/**
 * Statement Matcher Utility
 * Weighted matching for validate_statement tool
 */

import type { Requirement, RequirementLevel } from '../types/index.js';
import { createRequirementRegex } from '../constants.js';
import { clipAtClauseEnd } from './text.js';

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
   * 判定（isValid）を下すために最上位マッチに要求する、主語以外の一致語数。
   *
   * 主語だけが一致した状態（"The client" とだけ書いた主張）でもスコアは
   * 主語一致ボーナス 5 + 主語語 3 = 8 になり `MIN_SCORE_FOR_VERDICT` を超える。
   * 主語は「誰の話か」しか示さないので、何を論じているかを示す語を別に求める。
   */
  MIN_CONTENT_KEYWORDS_FOR_VERDICT: 2,
  /**
   * 「禁じられた行為を文が述べている」と判定するために求める、主動詞以外の
   * 内容語の重なり。動詞だけが一致した当たりを落とす。
   */
  MIN_SHARED_TERMS_FOR_PROHIBITION: 3,
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
  return SUBJECT_TERMS.has(singular(word.toLowerCase()));
}

/**
 * 複数形を単数形にそろえる。
 *
 * `SUBJECT_TERMS` は単数形で持っているため、そろえないと RFC 本文の
 * "Endpoints MUST NOT …" が主語として認識されない。
 */
export function singular(word: string): string {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(?:ss|sh|ch|x|s)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

/**
 * Extract subject from text
 *
 * 2 段構えで探す。まず単数形そのままの語を左から探し、見つからないときだけ
 * 複数形を単数形に直して探す。
 *
 * 順序を分けるのは、単数形化を無条件に混ぜると別の語を先に拾うためである。
 * RFC 6455 §5.1 の
 * "To avoid confusing network intermediaries (such as intercepting proxies) …
 *  a client MUST mask all frames that it sends to the server"
 * では、"proxies" を単数形に直すと "proxy" が "client" より先に当たり、
 * この要件の主語が proxy になる。主語で照合している矛盾検出から
 * 「クライアントはマスクする」という要件が外れてしまう。
 */
export function extractSubject(text: string): string | null {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z]/g, ''));

  for (const word of words) {
    if (SUBJECT_TERMS.has(word)) return word;
  }

  for (const word of words) {
    const cleaned = singular(word);
    if (SUBJECT_TERMS.has(cleaned)) return cleaned;
  }

  return null;
}

/**
 * 要件の主語を、`extractSubject` と同じ形（単数形の主語語）にそろえて返す。
 *
 * `Requirement.subject` は本文からそのまま取るため、"endpoints"（複数形）や
 * "an endpoint"（冠詞付き）の形で入っている。v0.6.6 まではこれを
 * `statementSubject` と `===` で比べていた。RFC 9114 §6.2.3 の
 * "Endpoints MUST NOT consider these streams to have any meaning upon receipt."
 * は、主語が "endpoints" であるために「主語が一致しない」と扱われ、
 *
 * - 順位付けで主語一致ボーナス (5) が付かず、一致語 6 語ありながら
 *   一致語 3 語の無関係な要件より下に落ちた
 * - `detectConflicts` の入口で弾かれ、矛盾の検査自体が行われなかった
 */
export function requirementSubjectOf(requirement: Requirement): string | null {
  const raw = requirement.subject?.toLowerCase();
  if (raw) {
    for (const word of raw.split(/[^a-z]+/)) {
      const cleaned = singular(word);
      if (SUBJECT_TERMS.has(cleaned)) return cleaned;
    }
  }
  return extractSubject(requirement.text);
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
  const reqSubject = requirementSubjectOf(requirement);
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

/**
 * どの動詞にも共通する否定の言い回し。
 *
 * `NEGATION_PAIRS` の `negative` は手書きだったため、動詞ごとに揃っていなかった。
 * `mask` には "without mask" があるのに `send` には無く、RFC 2818 §2.2.1 の
 * "Clients MUST send a closure alert before closing the connection." に対する
 * 「The client closes the connection **without sending** a close_notify alert.」が
 * 矛盾として挙がらなかった。
 *
 * 一致は部分文字列で見るので、"without send" は "without sending" にも当たる。
 * 不規則な否定形（unmask / exclude / reject など）は各対に書く。
 */
function commonNegations(positive: string): string[] {
  return [`not ${positive}`, `never ${positive}`, `without ${positive}`];
}

/** 手書きの不規則な否定形に、共通の言い回しを足したもの。 */
function withCommonNegations(pairs: NegationPair[]): NegationPair[] {
  return pairs.map((pair) => ({
    ...pair,
    negative: [...new Set([...pair.negative, ...commonNegations(pair.positive)])],
  }));
}

const NEGATION_PAIRS: NegationPair[] = withCommonNegations([
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
]);

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

  const headVerb = headVerbOf(actionLower);

  for (const pair of NEGATION_PAIRS) {
    // 動詞は要求アクションの主動詞であること。文字数の窓で見ると、
    // RFC 6455 §6.2 の "remove masking for data frames received from a client" が
    // 「mask を求めている」と読まれ、「サーバはマスクなしのフレームを送る」と
    // 矛盾することになる。この要求が求めているのは masking を remove することである。
    if (!headVerb || !headVerb.startsWith(pair.positive)) continue;

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

// ========================================
// 同じ事柄についての矛盾かを確かめる
// ========================================

/**
 * 全大文字だが識別子ではない語。プロトコル名や一般的な略語。
 *
 * これらを「その要件に固有の名前」として扱うと、ほとんどの要件が
 * 「文に HTTP が無いから別の事柄」と判定されてしまう。
 */
const GENERIC_ACRONYMS = new Set([
  'HTTP',
  'HTTPS',
  'TCP',
  'UDP',
  'TLS',
  'SSL',
  'QUIC',
  'URI',
  'URL',
  'IRI',
  'MIME',
  'ASCII',
  'UTF',
  'ABNF',
  'IANA',
  'IETF',
  'RFC',
  'DNS',
  'API',
  'JSON',
  'XML',
  'HTML',
  'SP',
  'CRLF',
  'LF',
  'CR',
  'OK',
  'ID',
  'BCP',
  'STD',
  'FIPS',
  'MUST',
  'NOT',
  'SHALL',
  'SHOULD',
  'MAY',
  'REQUIRED',
  'OPTIONAL',
  'RECOMMENDED',
]);

/**
 * 要求アクションの中の、その要件に固有の名前。
 *
 * RFC はフレーム名・メソッド名・エラーコードを全大文字やアンダースコア付きで書く
 * （`MAX_PUSH_ID` `PUSH_PROMISE` `CANCEL_PUSH` `TRACE` `H3_NO_ERROR`）。
 * これが要件を互いに区別している語であり、一般名詞（frame / request）ではない。
 *
 * 角括弧の引用（`[RFC5246]`）は名前ではないので先に落とす。
 */
export function identifiersOf(text: string): string[] {
  const withoutCitations = text.replace(/\[[^\]]*\]/g, ' ');
  const found = new Set<string>();

  // ハイフンでつないだ頭大文字の語（フィールド名）: Content-Length / Sec-WebSocket-Protocol
  for (const match of withoutCitations.matchAll(/\b[A-Z][A-Za-z0-9]*(?:-[A-Z][A-Za-z0-9]*)+\b/g)) {
    found.add(match[0]);
  }

  // "Date header field" のように、頭大文字の語がフィールドや欄を名指しする形
  for (const match of withoutCitations.matchAll(
    /\b([A-Z][a-z][A-Za-z0-9]*)\s+(?:header\s+field|header|field)\b/g
  )) {
    found.add(match[1]);
  }

  // 状態符号: 1xx / 204 / 1002
  for (const match of withoutCitations.matchAll(/\b([1-5]xx|[1-9]\d{2,3})\b/g)) {
    found.add(match[1]);
  }

  for (const token of withoutCitations.split(/[^A-Za-z0-9_]+/)) {
    if (!token) continue;

    // 語の内側のアンダースコアだけを名前とみなす。RFC 6455 は本文で定義語を
    // `_Establish a WebSocket Connection_` と囲むので、前後のアンダースコアを
    // 名前と読むと関係のない要件まで除外してしまう。
    if (/^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+$/.test(token)) {
      found.add(token);
      continue;
    }
    if (token.includes('_')) continue;
    if (token.length >= 3 && token === token.toUpperCase() && /[A-Z]/.test(token)) {
      if (!GENERIC_ACRONYMS.has(token)) found.add(token);
    }
  }

  return [...found];
}

/**
 * 禁止や要求を限定している語。
 *
 * RFC 6455 §7.3 の "Clients SHOULD NOT close the WebSocket connection arbitrarily."
 * が禁じているのは「理由なく閉じること」であって、閉じること自体ではない。
 * 限定語を落として語の重なりだけを見ると、理由を述べて閉じる記述まで違反になる。
 */
const QUALIFIER_WORDS = [
  'arbitrarily',
  'unnecessarily',
  'needlessly',
  'blindly',
  'silently',
  'automatically',
  'solely',
  'merely',
  'unless',
  'except',
  'other than',
  'without',
];

export function qualifiersOf(action: string): string[] {
  const lower = action.toLowerCase();
  return QUALIFIER_WORDS.filter((word) => lower.includes(word));
}

/**
 * 文の条件節（"when it detects a masked frame"）。
 * `parseRequirementComponents` が要件から取るものと同じ形にそろえる。
 */
export function conditionOf(text: string): string | null {
  const match = text.match(/\b(if|when|unless|where|in case)\s+(.+)/is);
  if (!match) return null;

  const condition = clipAtClauseEnd(match[2]);
  return condition.length > 0 ? condition : null;
}

/** 2 つの文字列に共通する内容語があるか。 */
function sharesContentWord(a: string, b: string): boolean {
  const wordsOf = (text: string): string[] =>
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= MATCHING_LIMITS.MIN_KEYWORD_LENGTH && !STOP_WORDS.has(word));

  const other = wordsOf(b).join(' ');
  return wordsOf(a).some((word) => requirementTextHasKeyword(other, word));
}

/**
 * 主張の主動詞。主語語の次に来る語を採る。
 *
 * "The server removes masking for data frames …" の主動詞は removes であって
 * mask ではない。この区別が無いと、§6.2 が求めている動作（マスクを外す）が
 * §5.1 の "MUST NOT mask" に反すると判定される。
 */
export function statementMainVerb(statement: string, subject: string | null): string | null {
  if (!subject) return null;

  const words = statement
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z]/g, ''))
    .filter(Boolean);

  const index = words.findIndex((word) => singular(word) === subject);
  if (index === -1 || index + 1 >= words.length) return null;

  return words[index + 1];
}

/** 主張が実際にその動詞の行為を述べているか（主動詞で見る）。 */
/** 主語と動詞の間に挟まる限定句を、何語まで飛ばすか。 */
const SUBJECT_TO_VERB_GAP = 8;

/**
 * 主張の中でその行為を述べている動詞の位置を返す。無ければ `null`。
 *
 * 主語の**直後**だけを見ると、限定句を挟む主張で動詞が見つからない。
 *
 * - `An origin server without a clock generates a Date header field.`
 *   → 主語 "server" の次は "without" で、動詞ではない
 *
 * 主語から数語のあいだを見て、その行為の動詞（同義語を含む）を探す。
 */
function findStatementVerb(
  statement: string,
  subject: string | null,
  verb: string
): { index: number; words: string[]; matched: string } | null {
  if (!subject) return null;

  const words = statement
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z']/g, ''))
    .filter(Boolean);

  const start = words.findIndex((word) => singular(word) === subject);
  if (start === -1) return null;

  const group = VERB_SYNONYMS.find((synonyms) => synonyms.includes(verb)) ?? [verb];
  const limit = Math.min(words.length, start + 1 + SUBJECT_TO_VERB_GAP);

  // 飛ばしてよいのは、主語のすぐあとに続く限定句だけである。
  // 語なら何でも飛ばすと、目的語の中の語を動詞と取り違える。
  //
  //   "The server removes masking for data frames received from a client."
  //
  // ここで "masking" を動詞と取ると、「サーバはマスクしてはならない」に
  // 違反していると誤って報告する（実際はマスクを外す側の話である）。
  let previousWasQualifier = false;

  for (let index = start + 1; index < limit; index++) {
    const word = words[index];
    if (group.some((synonym) => word.startsWith(synonym))) {
      return { index, words, matched: word };
    }

    const isQualifier = SUBJECT_QUALIFIER_WORDS.has(word);
    if (!isQualifier && !previousWasQualifier) return null;
    previousWasQualifier = isQualifier;
  }

  return null;
}

/**
 * 主語と動詞の間に挟まってよい語。
 *
 * 「限定句のすぐ次の 1 語」も飛ばす（"without **a clock** generates" の "clock"）。
 */
const SUBJECT_QUALIFIER_WORDS = new Set([
  'with',
  'without',
  'that',
  'which',
  'who',
  'has',
  'have',
  'having',
  'no',
  'a',
  'an',
  'the',
  'of',
  'in',
  'on',
  'for',
  'its',
  'their',
  'and',
  'or',
]);

export function statementPerformsVerb(
  statement: string,
  subject: string | null,
  verb: string
): boolean {
  return findStatementVerb(statement, subject, verb) !== null;
}

/**
 * 主張と要求アクションが同じ事柄についてのものか。
 *
 * 矛盾検出はこれまで語の重なりだけで判定していた。語の重なりは「同じ話題」を
 * 示すが、「同じ行為」を示さない。v0.6.7 で主語の照合を直して検査対象が広がった
 * ところ、準拠した記述 18 文のうち 5 文に矛盾が出るようになった。内訳は
 *
 * - `send` のような一般的な動詞で、共通語が frame / request しかないもの
 *   （"send a MAX_PUSH_ID frame" と「GOAWAY フレームを送る」）
 * - 限定付きの禁止（"close … arbitrarily"）に、理由を述べた記述が当たるもの
 * - 適用場面が違うもの（接続を確立する手順の要件と、マスク検出時に閉じる記述）
 *
 * どれも「語は重なるが行為が違う」である。ここで 3 つ確かめる。
 *
 * 1. 要求アクションに固有の名前があれば、主張にもあること
 * 2. 要求アクションに限定語があれば、主張にもあること
 * 3. 双方に条件節があるなら、内容語が 1 語以上重なること
 *    （片方にしか無い場合は判断材料が無いので通す）
 */
export function describesSameAct(
  statement: string,
  requirement: Requirement,
  action: string
): boolean {
  const lower = statement.toLowerCase();

  // 名前と限定は要件文全体から取る。要求アクションの外に置かれることがある。
  //   "An origin server **without a clock** MUST NOT generate a Date header field."
  //   "The **HEAD** method is identical to GET except that the server MUST NOT send content …"
  const scope = `${requirement.text} ${action}`;

  for (const identifier of identifiersOf(scope)) {
    if (!lower.includes(identifier.toLowerCase())) return false;
  }

  for (const qualifier of qualifiersOf(scope)) {
    if (!lower.includes(qualifier)) return false;
  }

  const statementCondition = conditionOf(statement);
  if (requirement.condition && statementCondition) {
    if (!sharesContentWord(requirement.condition, statementCondition)) return false;
  }

  return true;
}

/**
 * 否定の要件（`MUST NOT` など）。
 */
const NEGATIVE_LEVELS = new Set<RequirementLevel>([
  'MUST NOT',
  'SHALL NOT',
  'SHOULD NOT',
  'NOT RECOMMENDED',
]);

/**
 * 禁じられた行為の主動詞について、RFC の散文で入れ替わる書き方。
 *
 * `NEGATION_PAIRS` は「肯定形と否定形の対」（mask ↔ unmask）を持つが、
 * 主張と要件が別の動詞で同じ行為を述べている場合には当たらない。RFC 9114 §6.2.3 の
 * "Endpoints MUST NOT consider these streams to have any meaning upon receipt." に対し
 * 「An endpoint treats a reserved stream type as having a defined meaning upon receipt.」
 * は、consider と treat が入れ替わっているだけで同じ行為である。
 *
 * **網羅ではない。** ここに無い動詞では矛盾を検出しない。検出しないことは
 * `isValid: true` の意味（矛盾が見つからなかった）と一致しており、
 * 準拠していることの主張ではない。
 */
const VERB_SYNONYMS: string[][] = [
  ['consider', 'treat', 'regard', 'interpret', 'deem', 'assume'],
  ['send', 'sent', 'transmit', 'emit', 'forward'],
  ['accept', 'allow', 'permit'],
  ['reject', 'refuse', 'deny', 'discard', 'drop'],
  ['change', 'modify', 'alter', 'rewrite', 'transform'],
  ['include', 'contain', 'carry', 'insert'],
  ['use', 'employ', 'apply'],
  ['close', 'terminate', 'abort'],
  ['ignore', 'disregard', 'skip'],
  ['fragment', 'split'],
  ['mask', 'obscure'],
];

/**
 * 文が否定を含むか。
 *
 * 否定を含む主張は、禁止に従っていることを述べている見込みが高いので、
 * 「禁止された行為をしている」検査の対象から外す。
 */
/** 動詞に否定が付いているか。直前の 2 語だけを見る。 */
const NEGATION_WORD = /^(?:not|never|cannot|without|refrain|neither|nor|no)$|n't$/;

function isNegatedVerb(words: string[], verbIndex: number): boolean {
  for (let offset = 1; offset <= 2; offset++) {
    const word = words[verbIndex - offset];
    if (word && NEGATION_WORD.test(word)) return true;
  }
  return false;
}

/**
 * 禁じられた行為の主動詞を取り出す。
 *
 * `Requirement.action` はキーワードの直後から始まるので、先頭が主動詞になる。
 * "be fragmented" のように受動態のときは be を飛ばす。
 */
function headVerbOf(action: string): string | null {
  const words = action
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

  for (const word of words) {
    if (word === 'be' || word === 'been' || word === 'being') continue;
    return word;
  }

  return null;
}

/**
 * その語（または語幹）が文に語として現れるか。
 *
 * `requirementTextHasKeyword` と同じ語形の吸収を行いつつ、語頭で境界を取る。
 */
function statementHasTerm(statement: string, term: string): boolean {
  return keywordVariants(term).some((variant) => new RegExp(`\\b${variant}`).test(statement));
}

/**
 * 禁じられた行為を、文が肯定形で述べているか。
 *
 * v0.6.6 まで、RFC 9114 §6.2.3 の `MUST NOT` に正面から反する文が
 * `isValid: true`（矛盾なし）になっていた。`NEGATION_PAIRS` に載っていない
 * 動詞の入れ替え（consider → treat）を見ていなかったためである。
 *
 * 誤検出を避けるため、3 つとも満たすことを求める。
 *
 * 1. 文が否定を含まないこと。含むなら禁止に従っている見込みが高い。
 * 2. 禁じられた行為の主動詞、またはその同義語が文に現れること。
 *    これが要点である。"A server MUST NOT mask any frames that it sends to
 *    the client." に対する「The server sends frames to the client.」は、
 *    frames / sends / client が重なるが mask が無いので矛盾ではない。
 * 3. 主動詞以外に、行為の内容語が 2 語以上重なること。動詞だけの一致では
 *    別の事柄を論じている見込みがある。
 *
 * 主語の一致は呼び出し側（`detectConflicts`）が先に確かめている。
 */
export function findProhibitionViolation(
  statement: string,
  forbiddenAction: string,
  subject: string | null,
  requirementSubject?: string
): { verb: string; sharedTerms: string[] } | null {
  const statementLower = statement.toLowerCase();

  const verb = headVerbOf(forbiddenAction);
  if (!verb) return null;

  // 主張の主動詞がその行為であること。文中のどこかに動詞が現れるだけでは、
  // 別の行為を述べている見込みがある。
  const found = findStatementVerb(statementLower, subject, verb);
  if (!found) return null;

  // 否定は**動詞に付いたもの**だけを見る。文全体を見ると、要件の条件を
  // そのまま書き写した主張が落ちる。
  //
  //   "An origin server without a clock generates a Date header field."
  //
  // この "without" は行為を否定していない。要件
  // "An origin server without a clock MUST NOT generate a Date header field."
  // の条件を書き写しただけで、これは違反そのものである。
  if (isNegatedVerb(found.words, found.index)) return null;

  const matchedVerb = found.matched;

  const sharedTerms: string[] = [];
  const seen = new Set<string>();

  // 行為が短い禁止は、動詞を除くと共通語が 3 個に届かず落ちていた。
  //
  //   "clients MUST NOT show it to end users."（RFC 6455 §5.5.1）
  //   → 行為 "show it to end users" の内容語は "end" と "users" の 2 個
  //
  // 何を誰に禁じているかは要件の主語にもあるので、そちらも語の元にする。
  const pool = `${forbiddenAction} ${requirementSubject ?? ''}`;

  for (const word of pool.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!word || word === verb) continue;
    if (word.length < MATCHING_LIMITS.MIN_KEYWORD_LENGTH) continue;
    if (STOP_WORDS.has(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);

    if (statementHasTerm(statementLower, word)) sharedTerms.push(word);
  }

  if (sharedTerms.length < MATCHING_LIMITS.MIN_SHARED_TERMS_FOR_PROHIBITION) return null;

  return { verb: matchedVerb, sharedTerms };
}

/** 受動態の行為。`MUST NOT` の直後が "be 過去分詞" になっている。 */
const PASSIVE_ACTION_PATTERN = /^be\s+[a-z]+(?:ed|n|t)\b/;

/**
 * 受動態で書かれた禁止のうち、違反しているかを機械で決められないものを返す。
 *
 * 矛盾検出は、文の主語が禁じられた動詞を実行しているかを見る
 * （`statementPerformsVerb`）。要件が "A reference identity of type CN-ID
 * MUST NOT be used by clients." のように受動態で書かれていると、禁じられた
 * 行為に実行者がいない。文が "The client uses the cn-id identifier type."
 * でも矛盾は出ず、`conflicts` は空になる。
 *
 * 空の `conflicts` をそのまま `isValid: true` にすると、違反している文に
 * 「矛盾なし」と返す。ここで拾って `null`（判断できない）にする。
 *
 * 実測（RFC 9110/9111/9112/9113/9114/6455/8446/5280 の `MUST NOT` から機械で
 * 作った受動態の違反文 40 件）: `isValid` は `true` が 13 件、`null` が 27 件、
 * `false` は 0 件だった。この 13 件が誤解を招く形である。
 */
export function findUndecidablePassiveProhibition(
  statement: string,
  matches: MatchResult[]
): Requirement | null {
  const lower = statement.toLowerCase();

  // 文自身が否定なら、準拠していると述べている。判断を取り下げる必要はない。
  if (/\b(?:not|never|no|cannot)\b/.test(lower)) return null;

  for (const match of matches) {
    const req = match.requirement;
    if (!NEGATIVE_LEVELS.has(req.level)) continue;

    const action = (requiredActionOf(req) ?? '')
      .replace(/must not|shall not|should not|not recommended/gi, '')
      .trim()
      .toLowerCase();
    if (!PASSIVE_ACTION_PATTERN.test(action)) continue;
    if (!describesSameAct(lower, req, action)) continue;
    return req;
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
    const reqSubject = requirementSubjectOf(req);

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
      const contradiction = describesSameAct(statementLower, req, reqAction)
        ? findActionContradiction(statementLower, reqAction, statementKeywords)
        : null;
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
    if (NEGATIVE_LEVELS.has(reqLevel)) {
      // Extract the forbidden action (after MUST NOT)
      const forbiddenAction = (reqAction ?? '')
        .replace(/must not|shall not|should not|not recommended/gi, '')
        .trim();
      let pairConflict = false;

      // Find the PRIMARY forbidden action (the verb that appears first)
      // Only check that specific pair to avoid false positives
      const forbiddenHeadVerb = headVerbOf(forbiddenAction.toLowerCase());

      for (const pair of NEGATION_PAIRS) {
        // 禁じられているのはこの動詞であること（付随的な言及ではない）
        if (!forbiddenHeadVerb || !forbiddenHeadVerb.startsWith(pair.positive)) continue;

        const statementDoesPositive =
          hasPositiveAction(statementLower, pair) &&
          statementPerformsVerb(statementLower, statementSubject, pair.positive);

        // 一般的な動詞では、動詞が一致しただけの当たりを落とす（例: "MUST NOT send
        // back a |Sec-WebSocket-Protocol| header field" と「マスクなしのフレームを送る」）
        if (
          statementDoesPositive &&
          sharesActionContext(statementKeywords, forbiddenAction, pair) &&
          describesSameAct(statementLower, req, forbiddenAction)
        ) {
          conflicts.push({
            requirement: req,
            reason: `Statement does what "${reqLevel}" forbids: "${forbiddenAction}"`,
            statementLevel,
            requirementLevel: reqLevel,
          });
          pairConflict = true;
          break;
        }
      }

      // 動詞の入れ替え（consider → treat）で述べられた違反を拾う。
      // `NEGATION_PAIRS` は肯定形と否定形の対しか見ないため、ここで漏れていた。
      if (
        !pairConflict &&
        forbiddenAction &&
        describesSameAct(statementLower, req, forbiddenAction)
      ) {
        const violation = findProhibitionViolation(
          statementLower,
          forbiddenAction,
          statementSubject,
          req.subject
        );
        if (violation) {
          conflicts.push({
            requirement: req,
            reason: `Statement does what "${reqLevel}" forbids ("${violation.verb}", shared: ${violation.sharedTerms.join(', ')}): "${forbiddenAction}"`,
            statementLevel,
            requirementLevel: reqLevel,
          });
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
