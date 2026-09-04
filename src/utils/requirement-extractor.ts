/**
 * 要件抽出の共通ユーティリティ
 * XML/テキストパーサー共通で使用
 */

import type { Section, Requirement, RequirementLevel } from '../types/index.js';
import {
  clipAtClauseEnd,
  extractSentence,
  foldWhitespace,
  requirementSource,
  stripListMarker,
} from './text.js';
import { normalizeSectionNumber } from './section.js';

/**
 * 要件抽出フィルタ
 */
export interface RequirementFilter {
  /** 単一セクション（後方互換性のため維持） */
  section?: string;
  /** 複数セクション指定 */
  sections?: string[];
  /** サブセクションを含めるか（デフォルト: true） */
  includeSubsections?: boolean;
  /** 要件レベルでフィルタ */
  level?: RequirementLevel;
}

/**
 * 要件構成要素の解析オプション
 */
export interface ParseOptions {
  /** 主語・アクション等の構成要素を解析するか */
  parseComponents?: boolean;
}

/**
 * セクション番号を正規化（`section-6.2.3` → `6.2.3`、`section-appendix.a.2.5` → `A.2.5`）
 */
function normalizeSectionId(id: string): string {
  return normalizeSectionNumber(id);
}

/**
 * セクションがフィルタに一致するかチェック
 */
function matchesSectionFilter(sectionId: string, filter?: RequirementFilter): boolean {
  // フィルタなしの場合は全て一致
  if (!filter) return true;

  const normalizedId = normalizeSectionId(sectionId);
  const includeSubsections = filter.includeSubsections !== false; // デフォルト true

  // 複数セクション指定
  const filterSections = filter.sections || (filter.section ? [filter.section] : []);
  if (filterSections.length === 0) return true;

  for (const filterSec of filterSections) {
    const normalizedFilter = normalizeSectionId(filterSec);

    // 完全一致
    if (normalizedId === normalizedFilter) return true;

    // サブセクション一致（例: "3.5.1" は "3.5" にマッチ）
    if (includeSubsections && normalizedId.startsWith(normalizedFilter + '.')) {
      return true;
    }
  }

  return false;
}

/**
 * セクションから要件を再帰的に抽出
 */
export function extractRequirementsFromSections(
  sections: Section[],
  filter?: RequirementFilter,
  options: ParseOptions = { parseComponents: true }
): Requirement[] {
  const requirements: Requirement[] = [];

  /**
   * 要件の id の連番。**節ごとに数える。**
   *
   * 文書全体で 1 本の連番にしていたため、同じ要件が呼び方で違う id を持って
   * いた。`validate_statement` は全件から取るので RFC 9110 §6.6.1 の禁止を
   * `R-6.6.1-76` と報告するが、利用者がそれを読もうと
   * `get_requirements({ rfc: 9110, section: "6.6.1" })` を呼ぶと、返るのは
   * `R-6.6.1-1` 〜 `R-6.6.1-7` で、**教えられた id が存在しない**。
   *
   * 節ごとに数えれば「その節の n 番目」という意味になり、絞り込みで変わらない。
   */
  const idCounters = new Map<string, number>();
  const nextId = (sectionId: string): string => {
    const next = (idCounters.get(sectionId) ?? 0) + 1;
    idCounters.set(sectionId, next);
    return `R-${sectionId}-${next}`;
  };

  /**
   * 出力済みの要件を記録する。キーは「セクション + レベル + 要件文」。
   *
   * 1 つの文に同じレベルのキーワードが 2 回現れると（例: 要求 ID ラベルや
   * "MUST X and MUST Y"）、マーカーが 2 個立って同じ文が 2 件出力される。
   * 文が同一なら要件としても同一なので、最初の 1 件だけを残す。
   */
  const seen = new Set<string>();

  function isDuplicate(sectionId: string, level: string, text: string): boolean {
    const key = `${sectionId}\u0000${level}\u0000${text}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  }

/**
 * その位置のキーワードが、**行為を求めているのではなく語として名指されて**
 * いるか。
 *
 * BCP 14 のキーワードは名詞にもなる。RFC 2119 §7 は
 *
 * > The effects on security of not implementing **a MUST or SHOULD**, or doing
 * > something the specification says MUST NOT or SHOULD NOT be done, are very
 * > subtle.
 *
 * と書く。この 1 文から MUST / SHOULD / MUST NOT / SHOULD NOT の 4 件が立って
 * いた。RFC 9051 の付録 E は `(Changed from a SHOULD to a MUST.)`、RFC 5246 §1.2 は
 * `Support for the SSLv2 backward-compatible hello is now a MAY, not a SHOULD,
 * with sending it a SHOULD NOT.` である。
 *
 * 形容詞として名詞に付く `an OPTIONAL feature` `the RECOMMENDED default values`
 * も同じで、その節の実装が何かをすることを求めていない。
 *
 * **冠詞が直前に来ることだけ**を見る。引用符付き（`"MUST"`）は `B10` が、
 * BCP 14 の定型文は `B9` が既に落としている。
 *
 * 実測（RFC 82 本）: 48 件。うち 9 件は 1 つの文から複数のレベルが立っていた
 * もので、名指しでないほうのキーワードは残る（RFC 9051 §6.2.2 の
 * `It MAY also negotiate an OPTIONAL security layer` は MAY が残り
 * OPTIONAL が落ちる）。
 */
const ARTICLE_BEFORE_KEYWORD = /\b(?:an?|the)\s+$/i;

/** BCP 14 のキーワード。名指しかどうかを見るために、位置から読み直す。 */
const KEYWORD_AT_POSITION =
  /^(?:MUST NOT|SHALL NOT|SHOULD NOT|NOT RECOMMENDED|MUST|SHALL|SHOULD|MAY|REQUIRED|RECOMMENDED|OPTIONAL)/;

/**
 * 名詞として置かれたキーワードの後ろに来るもの。
 *
 * 冠詞だけを見ると、**形容詞として名詞に付く**書き方まで落ちる。
 * `an OPTIONAL feature of HTTP`（RFC 9110 §14）、
 * `the RECOMMENDED default values for these two parameters are 3.5 seconds …`
 * （RFC 3550 §6.2）、`A RECOMMENDED mechanism to achieve this is …`
 * （RFC 3261 §16.7）は、その節が何を選ぶべきかを述べており要件である。
 *
 * 名指しのときはキーワードの後ろに名詞が来ない。
 * `a MUST or SHOULD` / `a MAY, not a SHOULD` / `a SHOULD to a MUST.`
 */
const KEYWORD_AS_BARE_NOUN =
  /^\s*(?:[,.;:)"'\u201d]|$|(?:or|and|to|not|nor|than|instead|rather|level|keyword|in|of|for|by|with|from|at|on|into)\b)/i;

function namesTheKeyword(text: string, position: number): boolean {
  if (!ARTICLE_BEFORE_KEYWORD.test(text.slice(Math.max(0, position - 12), position))) return false;

  const keyword = KEYWORD_AT_POSITION.exec(text.slice(position));
  if (!keyword) return false;

  return KEYWORD_AS_BARE_NOUN.test(text.slice(position + keyword[0].length));
}

/**
 * 語を並べただけで、文になっていないか。
 *
 * RFC 2578 §3.7 は ASN.1 の予約語 96 個を字下げして並べる。
 *
 * ```
 *         ABSENT ACCESS AGENT-CAPABILITIES ANY APPLICATION AUGMENTS BEGIN
 *         BIT BITS BOOLEAN BY CHOICE COMPONENT COMPONENTS CONTACT-INFO
 *         …
 *         OPTIONAL ORGANIZATION Opaque PLUS-INFINITY PRESENT PRIVATE
 * ```
 *
 * この中の `OPTIONAL` から要件が 1 件立ち、チェックリストの 1 項目が
 * **903 文字の語の並び**になっていた。
 *
 * 小文字だけの語が 1 つも無いことで見分ける。地の文は `the` `of` `to` `is` の
 * ような語を必ず含む。予約語の一覧は `BY` `FROM` `OF` `WITH` のように大文字で
 * 書かれるので、これらは小文字の語として数えない。
 *
 * 実測（RFC 97 本）: 1 件。
 */
const LOWERCASE_WORD = /(?:^|\s)[a-z][a-z']*(?:\s|$)/;

function looksLikeWordList(sentence: string): boolean {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;

  return !LOWERCASE_WORD.test(` ${sentence} `);
}

  function processSection(section: Section, path: string) {
    // 内部の識別子（RFCXML の `pn`）はそのままでは外に出せない。出力する
    // `id` と `section` は節番号にそろえる。
    const sectionId = normalizeSectionId(section.number || section.anchor || path);

    // セクションフィルタリング
    const shouldProcess = matchesSectionFilter(sectionId, filter);

    if (shouldProcess) {
      // テキストブロックから要件抽出
      for (const block of section.content) {
        if (block.type === 'text' && block.requirements.length > 0) {
          for (const marker of block.requirements) {
            if (filter?.level && marker.level !== filter.level) {
              continue;
            }

            // 図・ABNF は空白を畳まない。ABNF の注釈は散文として組み直す。
            const source = requirementSource(block.content, marker.position, marker.level);
            const raw = extractSentence(source.text, source.position);
            // `text` は必ず 1 行にする。要件文は文として読まれ、`generate_checklist` は
            // 1 項目 1 行の Markdown にする。図の桁を残すのは `fullContext` の役目である。
            const sentence = foldWhitespace(stripListMarker(raw));

            if (isDuplicate(sectionId, marker.level, sentence)) {
              continue;
            }

            // キーワードのほかに語が無いものは要件文ではない。
            // RFC 5280 §11.2 の ASN.1 の切れ端 `"OPTIONAL,"` `"} OPTIONAL,"` が
            // 要件として出ていた（RFC 90 本・要件 9,584 件のうち 4 件）。
            if (!hasSubstance(sentence)) {
              continue;
            }

            // キーワードが名詞として置かれているものは要件ではない。
            if (namesTheKeyword(block.content, marker.position)) {
              continue;
            }

            // 語を並べただけの塊は文ではない。
            if (looksLikeWordList(sentence)) {
              continue;
            }

            // 図・表の行から取った要件には主語も条件もアクションも無い。
            // RFC 2131 §4.3.1 の表の行 "Message SHOULD SHOULD SHOULD" に
            // `subject: "message should"` `action: "SHOULD SHOULD"` が付いていた。
            const components =
              options.parseComponents && source.prose
                ? parseRequirementComponents(sentence, marker.level, block.content)
                : {};

            requirements.push({
              id: nextId(sectionId),
              level: marker.level,
              text: sentence,
              section: sectionId,
              sectionTitle: section.title,
              // `text` と同じく行頭の箇条書き記号を落とす。同じ段落の同じ書き出しで
              // 片方だけ "o " が残っていた。
              fullContext: source.prose
                ? foldWhitespace(stripListMarker(block.content))
                : block.content,
              ...components,
            });
          }
        }

        // リストアイテムからも抽出
        if (block.type === 'list') {
          for (const item of block.items) {
            for (const marker of item.requirements) {
              if (filter?.level && marker.level !== filter.level) {
                continue;
              }

              // 箇条書きの項目も、文の単位で切り出す。
              //
              // 箇条書きの項目は 1 文であることが多く、v0.6.14 まではその前提で
              // 項目の全文を要件文にしていた。RFCXML の `<dl>` は 1 項目が段落に
              // なる。RFC 9113 §8.3.1 の `":authority"` の項目は 2,150 文字の
              // 段落で、その中に MUST・MUST NOT・SHOULD・MAY が入っているため、
              // 同じ 2,150 文字が 4 件の要件として並んでいた。
              const itemContext = foldWhitespace(stripListMarker(item.content));
              const itemText = foldWhitespace(
                stripListMarker(extractSentence(item.content, marker.position))
              );
              if (isDuplicate(sectionId, marker.level, itemText)) {
                continue;
              }

              if (!hasSubstance(itemText)) {
                continue;
              }

              if (namesTheKeyword(item.content, marker.position)) {
                continue;
              }

              if (looksLikeWordList(itemText)) {
                continue;
              }

              const components = options.parseComponents
                ? parseRequirementComponents(itemText, marker.level, itemContext)
                : {};

              requirements.push({
                id: nextId(sectionId),
                level: marker.level,
                text: itemText,
                section: sectionId,
                sectionTitle: section.title,
                fullContext: itemContext,
                ...components,
              });
            }
          }
        }
      }
    }

    // サブセクションを再帰処理
    for (const subsection of section.subsections) {
      processSection(subsection, `${sectionId}.${subsection.number || ''}`);
    }
  }

  for (const section of sections) {
    processSection(section, section.number || '');
  }

  return requirements;
}

/**
 * 要件文に、キーワード以外の語があるか。
 *
 * ASN.1 の切れ端が要件として出ることがある。RFC 5280 §11.2 の
 * `OPTIONAL,` や `} OPTIONAL,` は、キーワードを外すと何も残らない。
 * 要件は「誰が何をするか」を書いた文であって、キーワード単体ではない。
 */
function hasSubstance(text: string): boolean {
  const withoutKeywords = text.replace(
    /\b(?:MUST|SHALL|SHOULD|MAY|REQUIRED|OPTIONAL|RECOMMENDED|NOT)\b/g,
    ' '
  );
  return /[A-Za-z0-9]/.test(withoutKeywords);
}

/**
 * 要件文から構成要素を解析
 */
function parseRequirementComponents(
  text: string,
  level: RequirementLevel,
  context?: string
): Partial<Requirement> {
  const result: Partial<Requirement> = {};

  // 主語の抽出（"The client MUST" → "client"）
  //
  // **文頭に固定しない。** RFC の要件文は前置きから始まることが多い。
  //
  // - `(Note that masking is done …) The server MUST close the connection …`
  // - `In this case, a server MAY send a Close frame …`
  // - `Because of the potential for trailer fields to be discarded, a server …`
  //
  // 文頭で探すと、これらの主語が取れない。実測（RFC 64 本・要件 9,684 件）で
  // `subject` が付くのは 27.9% だけだった。キーワードの直前から取ると 91.8%。
  //
  // `subject` は `generate_checklist` の `role` の絞り込みにも使う。取れないと
  // 絞り込みが効かず、`role: "client"` にサーバの要件が 865 件（8.9%）残っていた。
  // 冠詞のあとには**必ず空白がある**。`\\s*` にすると、冠詞の候補が語の頭の
  // 1 文字を食う。"Automated clients MUST" の "A" が冠詞として消費され、
  // 主語が "utomated clients" になっていた（実測で 600 件、6.20%）。
  //
  // 直前の語が接続詞や代名詞のことがある。1 つの文に要件が 2 つあると、
  // 2 つ目のキーワードの手前が "and" になる（RFC 9110 §4.3.4 の
  // "MUST log the error to an appropriate audit log (if available) and MUST
  // provide …"）。代名詞（it / this / they）も同じで、指しているものは
  // 文の前の方にある。**主語ではないので、名乗らせない。**
  const subjectMatch = new RegExp(
    `\\b(?:(?:The|A|An|Each|Every|All)\\s+)?([A-Za-z][\\w-]*(?:\\s+[A-Za-z][\\w-]*)?)\\s+${level.replace(' ', '\\s+')}\\b`,
    'i'
  ).exec(text);
  if (subjectMatch) {
    // 2 語の取り込みが冠詞ごと拾うことがある（"of a client MUST" → "a client"）。
    const subject = subjectMatch[1]
      .toLowerCase()
      .replace(/^(?:the|a|an|each|every|all)\s+/, '')
      .trim();
    if (subject && PRONOUN_SUBJECT.has(subject)) {
      // 代名詞が指しているものは、同じ段落の前の文にある。
      const antecedent = context ? subjectBeforeSentence(context, text) : undefined;
      if (antecedent) result.subject = antecedent;
    } else {
      // 2 語の取り込みが機能語を巻き込むことがある（"response and MUST" →
      // "response and"、"methods are REQUIRED" → "methods are"）。前後の機能語を
      // 落として、残りを主語とする。全部落ちたら主語は無い。
      const trimmed = trimFunctionWords(subject);
      if (trimmed) result.subject = trimmed;
    }
  }

  // 条件の抽出（"if", "when", "where", "in case"）
  //
  // `unless` はここに入れない。例外の側と重なり、`condition` と `exception` に
  // 同じ文字列が入る。実測（RFC 49 本・要件 7,797 件）で 247 件（3.2%）あった。
  // 「X でない限り」は条件ではなく例外である。
  //
  // 切り出しは clipAtClauseEnd に任せる。`[^,.]+` で止めると、括弧内のカンマや
  // 節番号のピリオドで切れて "this fails (e" のようになる。
  const conditionMatch = text.match(/\b(if|when|where|in case)\s+(.+)/is);
  if (conditionMatch) {
    const condition = clipAtClauseEnd(conditionMatch[2]);
    if (condition) result.condition = condition;
  }

  // 例外の抽出
  const exceptionMatch = text.match(/\b(unless|except|excluding)\s+(.+)/is);
  if (exceptionMatch) {
    const exception = clipAtClauseEnd(exceptionMatch[2]);
    if (exception) result.exception = exception;
  }

  // アクションの抽出（キーワードの後）
  const actionMatch = text.match(new RegExp(`${level}\\s+(.+)`, 'is'));
  if (actionMatch) {
    const action = clipAtClauseEnd(actionMatch[1]);
    if (action) result.action = action;
  }

  return result;
}

/**
 * 代名詞が指しているものを、同じ段落の前の文から取る。
 *
 * RFC 6455 §5.1 は
 *
 * > A client MUST close a connection if it detects a masked frame.
 * > **In this case, it MAY use the status code 1002** (protocol error) …
 *
 * と書く。`it` は client を指す。取れないと `generate_checklist` の
 * `role: "server"` にもこの項目が出る（主語が無ければ本文を見るが、本文にも
 * client / server の語が無いため両方に残る）。
 *
 * 前の文の中で、キーワードの直前に置かれた語を採る。要件文と同じ取り方である。
 */
function subjectBeforeSentence(context: string, sentence: string): string | undefined {
  // **文の全体で探す。** 頭の数十文字で探すと、同じ書き出しの文が段落に 2 つ
  // あるときに手前の方に当たる。RFC 6455 §5.1 は "In this case, …" を 2 回書く
  // ので、40 文字で探すと 1 つ目に当たり、引き継ぐ主語が server になっていた
  // （正しくは直前の文の client）。
  //
  // 段落と文で空白の畳み方が違う（段落は改行を含み、文は切り出したまま）。
  // 両方を畳んでから探す。
  const folded = foldWhitespace(context);
  const at = folded.indexOf(foldWhitespace(sentence));
  if (at <= 0) return undefined;

  const before = folded.slice(0, at);
  let found: string | undefined;
  //
  // 冠詞は大文字で始まることがある（文頭の "A client MUST …"）。小文字だけで
  // 書くと、文頭の文が当たらず、その手前の文の主語を引き継いでいた。
  const pattern =
    /\b(?:(?:[Tt]he|[Aa]n?|[Ee]ach|[Ee]very|[Aa]ll)\s+)?([A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*)?)\s+(?:MUST|SHALL|SHOULD|MAY|REQUIRED|RECOMMENDED|OPTIONAL)\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(before)) !== null) {
    const candidate = match[1].toLowerCase().trim();
    // 2 語の取り込みが接続詞を巻き込むことがある（"requests and MUST" →
    // "requests and"）。1 語でも機能語が混じっていたら主語ではない。
    if (candidate.split(/\s+/).some((word) => NOT_A_SUBJECT.has(word))) continue;
    found = candidate;
  }
  return found;
}

/**
 * 前後の機能語を落とす。残らなければ `undefined`。
 *
 * 主語はキーワードの直前 1〜2 語から取るので、機能語を巻き込むことがある。
 * "An origin server MUST NOT generate a Date header field" の 2 語は
 * "response and"（RFC 9110 §10.2.1）や "methods are"（同 §9.1）になる。
 * 落とすと "response" "methods" が残る。両方とも機能語なら主語ではない。
 */
function trimFunctionWords(subject: string): string | undefined {
  const words = subject.split(/\s+/).filter((word) => word.length > 0);
  while (words.length > 0 && NOT_A_SUBJECT.has(words[words.length - 1])) words.pop();
  while (words.length > 0 && NOT_A_SUBJECT.has(words[0])) words.shift();
  return words.length > 0 ? words.join(' ') : undefined;
}

/** 前の文から引き継ぐ代名詞。 */
const PRONOUN_SUBJECT = new Set(['it', 'they', 'them', 'this', 'these', 'those', 'he', 'she']);

/** 主語として認めない語。接続詞・代名詞・関係詞。 */
const NOT_A_SUBJECT = new Set([
  'and',
  'or',
  'but',
  'nor',
  'so',
  'then',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'they',
  'them',
  'we',
  'you',
  'he',
  'she',
  'which',
  'who',
  'whom',
  'there',
  'here',
  'if',
  'when',
  'while',
  'also',
  'thus',
  'hence',
  'however',
  'therefore',
  'otherwise',
  // 冠詞・前置詞・繋辞。1 語だけ取れたときに残ることがある。
  'the',
  'a',
  'an',
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'as',
  'for',
  'from',
  'with',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'has',
  'have',
  'had',
  'not',
  'no',
  'all',
  'any',
  'each',
  'every',
  'such',
  'other',
  'both',
]);
