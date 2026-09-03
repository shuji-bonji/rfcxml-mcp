/**
 * 監査で当てる不変条件。
 *
 * ここに並ぶのは「どの RFC でも成り立っていなければならないこと」であり、
 * 単体テストとは役割が違う。単体テストは私が書いた入力に対する assert で、
 * 書いた通りに動くかを確かめる。不変条件は実物の RFC に当てて、想定していない
 * 書式で破れる場所を出す。v0.6.9 以降の不具合はすべてこちらで見つかった。
 *
 * 各条件は `check` が破れの説明を配列で返す。空なら合格。
 *
 * A6（目次にある節が構造にある）は、節の欠落をそのまま測る。v0.6.15 で直した
 * 6 件のうち 3 件が節の欠落で、どれも「その節の要件が手前の節に付く」という
 * 形で表に出ていた。欠落は他の条件を破らないので、これを見ないと気づけない。
 */

/** その語が図・表の行らしいか（要件の出どころを見分ける）。 */
const DIAGRAM_PATTERNS = [
  /^[ \t]*[A-Za-z][\w-]*[ \t]*=[ \t]/m,
  / {2};/,
  /[-+]{4,}/,
  /\|[ \t]{2,}/,
  /^[ \t]*\|.*\|[ \t]*$/m,
  /\S {3,}\S[^\n]* {3,}\S/,
];

/** 定義の用語として認めない見出し。 */
const NOT_A_TERM =
  /^(?:Request for Comments|Category|ISSN|Obsoletes|Updates|Network Working Group|BCP|STD|FYI|EMail|Email|E-Mail|URI|URL|Phone|Fax|Tel|Telephone|NOTE|Note|Notes|Example|EXAMPLE|Examples)$|^o\s/;

/** 主語として認めない語。`requirement-extractor` の `NOT_A_SUBJECT` と揃える。 */
const FUNCTION_WORD_SUBJECT =
  /^(?:and|or|but|nor|so|then|it|its|this|that|these|those|they|them|we|you|he|she|which|who|whom|there|here|if|when|while|also|thus|hence|however|therefore|otherwise|the|a|an|of|to|in|on|at|by|as|for|from|with|is|are|was|were|be|been|being|has|have|had|not|no|all|any|each|every|such|other|both)$/i;

/** 主語の末尾に来ると、機能語を巻き込んでいることを示す語。 */
const TRAILING_SUBJECT_WORD =
  /\s(?:and|or|but|nor|of|to|in|on|at|by|as|for|from|with|is|are|was|were|be|been|being|has|have|had|not|the|a|an|that|which|it|this)$/i;

/** 参考文献の欄の見出し。 */
const REFERENCE_HEADING =
  /^(?:\d+(?:\.\d+)*\.?\s+)?(?:(?:normative|informative)\s+)?(?:references(?:\s+and\s+bibliography)?|bibliography)\s*$/i;

/** 文の書き出しに来る語。これで始まる「用語」は文である。 */
const SENTENCE_OPENER =
  /^(?:The|This|These|Those|That|It|Its|A|An|Each|Every|All|There|If|When|Note that)\s/;

/** 用語の中に現れると、用語ではなく文の一部であることを示す語。 */
const RELATIVE_CLAUSE = /\s(?:that|which|who|have|has|are|is|be|was|were)\s/i;

/** 題名の末尾に来ると折り返しを疑う語。 */
const TRAILING_FUNCTION_WORD =
  /\s(?:of|to|and|with|in|for|the|a|an|or|on|from|by|at|as|that|which|into|over|under)$/i;

const looksLikeDiagram = (text) => DIAGRAM_PATTERNS.some((pattern) => pattern.test(text ?? ''));

/** 題名の中の略語。ここに挙げた語のあとの `.` は文の終わりではない。 */
const TITLE_ABBREVIATION =
  /(?:^|[\s(])(?:pp?|vol|nos?|secs?|chs?|figs?|eds?|al|etc|cf|vs|e\.g|i\.e|[A-Z]|[IVX]{1,4})\.$/i;

/** 題名の中に、略語でない句点があるか。 */
const containsSentenceBreak = (title) => {
  const pattern = /[.!?]\s+\S/g;
  let match;
  while ((match = pattern.exec(title)) !== null) {
    const head = title.slice(0, match.index + 1);
    // 三点リーダは文の終わりではない（RFC 1866 §5.4 "Headings: H1 ... H6"）。
    if (/\.\.$/.test(head)) continue;
    if (!TITLE_ABBREVIATION.test(head)) return true;
  }
  return false;
};

const walk = (sections, fn) => {
  for (const section of sections ?? []) {
    fn(section);
    walk(section.subsections, fn);
  }
};

const findSection = (sections, target) => {
  let found = null;
  // 後付録は `section-appendix.a.2.5` の形で入っている。製品側の
  // `normalizeSectionNumber` と同じく `A.2.5` に直してから比べる。
  const normalize = (value) => {
    const bare = (value ?? '').replace(/^section-/, '');
    const appendix = /^appendix\.([a-z])((?:\.\d+)*)$/i.exec(bare);
    if (appendix) return `${appendix[1].toUpperCase()}${appendix[2]}`;
    // 後付録の下位節が `e.1` の形になる RFC がある（RFC 8949）。
    const letterSection = /^([a-z])((?:\.\d+)*)$/.exec(bare);
    return letterSection ? `${letterSection[1].toUpperCase()}${letterSection[2]}` : bare;
  };
  walk(sections, (section) => {
    if (found) return;
    if (normalize(section.number) === normalize(target)) found = section;
    else if (normalize(section.anchor) === normalize(target)) found = section;
  });
  return found;
};

/**
 * @typedef {object} AuditContext
 * @property {number} rfc
 * @property {import('../../dist/services/rfcxml-parser.js').ParsedRFC} parsed
 * @property {Array<Record<string, unknown>>} requirements
 * @property {string} checklist
 */

/** @type {Array<{ id: string, description: string, check: (context: AuditContext) => string[] }>} */
export const INVARIANTS = [
  {
    id: 'A1',
    description: '節番号が一意',
    check: ({ parsed }) => {
      const numbers = [];
      walk(parsed.sections, (section) => numbers.push(section.number ?? ''));
      const duplicated = [...new Set(numbers.filter((n, i) => n && numbers.indexOf(n) !== i))];
      return duplicated.map((number) => `節番号 ${number} が重複`);
    },
  },
  {
    id: 'A2',
    description: '節の題名が空でない',
    check: ({ parsed }) => {
      const broken = [];
      walk(parsed.sections, (section) => {
        const title = (section.title ?? '').trim();
        if (!title || title === 'Untitled Section') broken.push(`S${section.number} の題名が空`);
      });
      return broken;
    },
  },
  {
    id: 'A3',
    description: '目次の行が節になっていない',
    check: ({ parsed }) => {
      const broken = [];
      walk(parsed.sections, (section) => {
        if (/(?:\.\s?){3,}\s*\d+\s*$/.test(section.title ?? ''))
          broken.push(`S${section.number} は目次の行`);
      });
      return broken;
    },
  },
  {
    id: 'A4',
    description: '折り返した本文が節になっていない',
    check: ({ parsed }) => {
      const broken = [];
      walk(parsed.sections, (section) => {
        // 題名に「句点 + 空白 + 語」があれば、それは文であって題名ではない。
        // ただし RFC 1123 は出典を題名に書く
        // （"Option Negotiation: RFC-854, pp. 2-3"）。略語のあとの句点は除く。
        if (containsSentenceBreak(section.title ?? ''))
          broken.push(`S${section.number} の題名が文: ${(section.title ?? '').slice(0, 60)}`);
      });
      return broken;
    },
  },
  {
    id: 'A6',
    description: '目次にある節と付録が構造にある',
    check: ({ kind, source, parsed }) => {
      // 目次を持つのはテキスト経路だけ。RFCXML には目次の行が無い。
      if (kind !== 'text') return [];

      const have = new Set();
      walk(parsed.sections, (section) => have.add(section.number));

      // 目次の行「番号 題名 …… ページ」から番号を拾う
      const toc = new Map();
      for (const line of source.split('\n')) {
        // 数字の節と、文字の付録（`Appendix A.` / `A.1.`）の両方を拾う
        const match =
          /^\s{0,15}(?:Appendix\s+)?(\d+(?:\.\d+)*|[A-Z](?:\.\d+)*)\.?\s+(\S.*?)\s*(?:\.\s?){3,}\s*\d+\s*$/.exec(
            line
          );
        if (match) toc.set(match[1], match[2]);
      }
      // 目次が短いものは、目次ではなく本文の並びを拾っている
      if (toc.size < 5) return [];

      return [...toc.keys()]
        .filter((number) => !have.has(number))
        .map((number) => `目次の S${number} "${toc.get(number).slice(0, 40)}" が構造に無い`);
    },
  },
  {
    id: 'A7',
    description: '節が 1 つ以上ある',
    check: ({ parsed }) => {
      let count = 0;
      walk(parsed.sections, () => count++);
      return count === 0 ? ['節が 1 つも取れていない'] : [];
    },
  },
  {
    id: 'A5',
    description: 'メタデータに題名と公開日がある',
    check: ({ parsed }) => {
      const broken = [];
      if (!parsed.metadata.title || parsed.metadata.title === 'Untitled') broken.push('題名が無い');
      if (!parsed.metadata.date) broken.push('公開日が無い');
      return broken;
    },
  },
  {
    id: 'B1',
    description: '要件の id が一意',
    check: ({ requirements }) => {
      const seen = new Set();
      const broken = [];
      for (const requirement of requirements) {
        if (seen.has(requirement.id)) broken.push(`${requirement.id} が重複`);
        seen.add(requirement.id);
      }
      return broken;
    },
  },
  {
    id: 'B2',
    description: '要件文が 10 文字以上',
    check: ({ requirements }) =>
      requirements
        .filter((r) => !r.text || r.text.length < 10)
        .map((r) => `${r.id}: ${JSON.stringify(r.text)}`),
  },
  {
    id: 'B13',
    description: '要件文にキーワード以外の語がある',
    check: ({ requirements }) =>
      requirements
        .filter(
          (r) =>
            !/[A-Za-z0-9]/.test(
              (r.text ?? '').replace(
                /\b(?:MUST|SHALL|SHOULD|MAY|REQUIRED|OPTIONAL|RECOMMENDED|NOT)\b/g,
                ' '
              )
            )
        )
        .map((r) => `${r.id}: ${JSON.stringify(r.text)}`),
  },
  {
    id: 'B14',
    description: '主語に冠詞が入っていない',
    check: ({ requirements }) =>
      requirements
        .filter((r) => /^(?:the|a|an|each|every|all)\s/.test(r.subject ?? ''))
        .map((r) => `${r.id}: subject=${JSON.stringify(r.subject)}`),
  },
  {
    id: 'B15',
    description: '主語の先頭が削られていない',
    // 代名詞の主語は前の文から引き継ぐので、その語は要件文の中に無い。
    // 段落（`fullContext`）まで見る。
    check: ({ requirements }) =>
      requirements
        .filter((r) => {
          if (!r.subject) return false;
          const head = r.subject.split(/\s+/)[0].replace(/[^a-z0-9_-]/gi, '');
          if (head.length < 3) return false;
          const scope = `${r.text ?? ''} ${r.fullContext ?? ''}`;
          return !new RegExp(`\\b${head}`, 'i').test(scope);
        })
        .map((r) => `${r.id}: subject=${JSON.stringify(r.subject)}`),
  },
  {
    id: 'B3',
    description: '要件文が 1 行（改行と 4 個以上の連続空白が無い）',
    check: ({ requirements }) =>
      requirements.filter((r) => /\n| {4,}/.test(r.text ?? '')).map((r) => `${r.id}`),
  },
  {
    id: 'B4',
    description: '要件文の区切りが壊れていない',
    check: ({ requirements }) =>
      requirements
        .filter((r) => /[,;]\s*;|\bor;|\band;/.test(r.text ?? ''))
        .map((r) => `${r.id}: ${(r.text ?? '').slice(0, 60)}`),
  },
  {
    id: 'B5',
    description: '要件の section が節番号（pn 形式でない）',
    check: ({ requirements }) =>
      requirements.filter((r) => /^section-/.test(r.section ?? '')).map((r) => `${r.id}`),
  },
  {
    id: 'B6',
    description: '要件の section が実在する',
    check: ({ parsed, requirements }) =>
      requirements
        .filter((r) => r.section && !findSection(parsed.sections, r.section))
        .map((r) => `${r.id} の S${r.section} が引けない`),
  },
  {
    id: 'B7',
    description: '要件文にそのレベルのキーワードが入っている',
    check: ({ requirements }) =>
      requirements
        .filter(
          (r) => !new RegExp(`\\b${String(r.level).replace(' ', '\\s+')}\\b`).test(r.text ?? '')
        )
        .map((r) => `${r.id} に ${r.level} が無い`),
  },
  {
    id: 'B8',
    description: '図・表の行から取った要件に構成要素を付けない',
    check: ({ requirements }) =>
      requirements
        .filter((r) => looksLikeDiagram(r.text) && (r.subject || r.condition || r.action))
        .map((r) => `${r.id}: subject=${JSON.stringify(r.subject)}`),
  },
  {
    id: 'B9',
    description: 'BCP 14 の定型文から要件を出さない',
    check: ({ requirements }) =>
      requirements
        .filter((r) => /\bare to be interpreted as described in\b/i.test(r.text ?? ''))
        .map((r) => `${r.id}: ${(r.text ?? '').slice(0, 60)}`),
  },
  {
    id: 'B10',
    description: '引用符に囲まれたキーワードから要件を出さない',
    check: ({ requirements }) =>
      requirements
        .filter((r) => {
          const index = (r.text ?? '').indexOf(r.level);
          if (index <= 0) return false;
          const before = r.text[index - 1];
          const after = r.text.slice(index + r.level.length);
          return /["'“‘`]/.test(before) && /^(?:["'”’`]|-\w)/.test(after);
        })
        .map((r) => `${r.id}: ${(r.text ?? '').slice(0, 60)}`),
  },
  {
    id: 'B11',
    description: '否定のキーワードを肯定形として拾っていない',
    check: ({ requirements }) =>
      requirements
        .filter((r) => {
          if (/NOT/.test(r.level)) return false;
          // 1 つの文が "MUST NOT X, and MUST Y" と書くことがあるので、
          // レベルの出現が **すべて** NOT を伴うときだけ誤りとみなす。
          const occurrences = [...(r.text ?? '').matchAll(new RegExp(`\\b${r.level}\\b`, 'g'))];
          if (occurrences.length === 0) return false;
          return occurrences.every((match) =>
            /^\s+NOT\b/.test(r.text.slice(match.index + r.level.length))
          );
        })
        .map(
          (r) => `${r.id}: ${r.level} の出現がすべて NOT を伴う — ${(r.text ?? '').slice(0, 60)}`
        ),
  },
  {
    id: 'B12',
    description: 'condition と exception に同じ文字列を入れない',
    check: ({ requirements }) =>
      requirements
        .filter((r) => r.condition && r.exception && r.condition === r.exception)
        .map((r) => `${r.id}: "${String(r.condition).slice(0, 50)}"`),
  },
  {
    id: 'C1',
    description: '用語に飾り（末尾のコロン・引用符）が残っていない',
    check: ({ parsed }) =>
      parsed.definitions
        .filter((d) => /:\s*$/.test(d.term) || /^["'].*["']$/.test(d.term))
        .map((d) => `"${d.term}"`),
  },
  {
    id: 'C5',
    description: '用語に英数字が入っている',
    check: ({ parsed }) =>
      parsed.definitions
        .filter((d) => !/[A-Za-z0-9]/.test(d.term ?? ''))
        .map((d) => `"${d.term}" は記号だけ`),
  },
  {
    id: 'C2',
    description: '定義に中身がある',
    check: ({ parsed }) =>
      parsed.definitions
        .filter((d) => !d.definition || d.definition.trim().length < 3)
        .map((d) => `"${d.term}" -> ${JSON.stringify(d.definition)}`),
  },
  {
    id: 'C3',
    description: '索引の項目が定義になっていない',
    check: ({ parsed }) =>
      parsed.definitions.filter((d) => /Paragraph \d/.test(d.definition)).map((d) => `"${d.term}"`),
  },
  {
    id: 'C4',
    description: '定義の section が節番号（pn 形式でない）',
    check: ({ parsed }) =>
      parsed.definitions.filter((d) => /^section-/.test(d.section ?? '')).map((d) => `"${d.term}"`),
  },
  {
    id: 'D1',
    description: '相互参照の参照先が実在する',
    check: ({ parsed }) => {
      const broken = [];
      let checked = 0;
      walk(parsed.sections, (section) => {
        if (checked > 40) return;
        checked++;
        for (const block of section.content ?? []) {
          if (block.type !== 'text') continue;
          for (const reference of block.crossReferences ?? []) {
            if (reference.type !== 'section' || !reference.section) continue;
            if (!findSection(parsed.sections, reference.section))
              broken.push(`S${section.number} -> ${reference.section}`);
          }
        }
      });
      return [...new Set(broken)];
    },
  },
  {
    id: 'E1',
    description: '参照に題名がある',
    check: ({ parsed }) =>
      [...parsed.references.normative, ...parsed.references.informative]
        .filter((reference) => !reference.title || !reference.title.trim())
        .map((reference) => `${reference.anchor}`),
  },
  {
    id: 'E2',
    description: '自分自身を参照していない',
    check: ({ rfc, parsed }) =>
      [...parsed.references.normative, ...parsed.references.informative]
        .filter((reference) => reference.rfcNumber === rfc)
        .map((reference) => `${reference.anchor}`),
  },
  {
    id: 'E3',
    description: '参照の題名に読点が残っていない',
    check: ({ parsed }) =>
      [...parsed.references.normative, ...parsed.references.informative]
        .filter((reference) => /[,;]$/.test(reference.title ?? ''))
        .map((reference) => `[${reference.anchor}] "${reference.title}"`),
  },
  {
    id: 'E4',
    description: '参照の番号を題名から拾っていない',
    check: ({ parsed }) =>
      [...parsed.references.normative, ...parsed.references.informative]
        .filter((reference) => {
          if (!reference.rfcNumber || !reference.title) return false;
          // 題名が取れなかったときの埋め草（`RFC 1123`）は誤りではない
          if (reference.title === `RFC ${reference.rfcNumber}`) return false;
          // 題名の中の "RFC-987" だけを根拠に番号を付けていないか
          return new RegExp(`\\bRFC[\\s-]*${reference.rfcNumber}\\b`, 'i').test(reference.title);
        })
        .map((reference) => `[${reference.anchor}] ${reference.rfcNumber} <- "${reference.title}"`),
  },
  {
    id: 'E6',
    description: '参照の題名に目印が残っていない',
    check: ({ parsed }) =>
      [...parsed.references.normative, ...parsed.references.informative]
        .filter((reference) => /^\[/.test(reference.title ?? ''))
        .map((reference) => `[${reference.anchor}] "${(reference.title ?? '').slice(0, 40)}"`),
  },
  {
    id: 'E5',
    description: '参照の題名が目印のままになっていない',
    check: ({ parsed }) =>
      [...parsed.references.normative, ...parsed.references.informative]
        .filter((reference) => reference.title === reference.anchor)
        .map((reference) => `[${reference.anchor}] の題名が取れていない`),
  },
  {
    id: 'F1',
    description: 'チェックリストの各項目がレベル付きの 1 行',
    check: ({ checklist }) =>
      checklist
        .split('\n')
        .filter((line) => line.startsWith('- [ ]') && !/^- \[ \] \*\*[A-Z ]+\*\* /.test(line))
        .map((line) => line.slice(0, 60)),
  },
  {
    id: 'F2',
    description: 'チェックリストに継続行が漏れていない',
    check: ({ checklist }) =>
      checklist
        .split('\n')
        .filter((line) => /^\s+\S/.test(line))
        .map((line) => line.slice(0, 60)),
  },
  {
    id: 'G1',
    description: '定義の用語が表紙・著者欄・注記の見出しでない',
    // テキスト経路の定義は「行の中の `X: Y`」でしか見分けられない。同じ形が
    // RFC の表紙（`Request for Comments: 7519`）、末尾の著者欄（`EMail: …`）、
    // 本文の注記（`NOTE: …`）、IANA 登録票（`o  Type name: application`）にも
    // 出る。実測（RFC 64 本）: 3,118 件のうち 660 件がこの 4 種だった。
    check: ({ parsed }) =>
      (parsed.definitions ?? [])
        .filter((definition) => NOT_A_TERM.test(definition.term ?? ''))
        .map((definition) => `"${definition.term}" は用語ではない`),
  },
  {
    id: 'G2',
    description: '同じ用語が 3 回以上出ていない',
    // 見出しフィールドの例示（`Set-Cookie: SID=…`）が定義として並んでいた。
    // RFC 6265 §3.1 は `Set-Cookie` を 10 回以上書く。実測: 633 件。
    check: ({ parsed }) => {
      const count = new Map();
      for (const definition of parsed.definitions ?? []) {
        count.set(definition.term, (count.get(definition.term) ?? 0) + 1);
      }
      return [...count.entries()]
        .filter(([, times]) => times >= 3)
        .map(([term, times]) => `"${term}" が ${times} 回`);
    },
  },
  {
    id: 'B16',
    description: '要件の主語が機能語でない',
    // 1 つの文に要件が 2 つあると、2 つ目のキーワードの手前が "and" になる
    // （RFC 9110 §4.3.4 の "… audit log (if available) and MUST provide …"）。
    // 代名詞（it / this）も同じで、指しているものは文の前の方にある。
    // 実測（RFC 67 本）: 744 件 → 0 件。
    check: ({ requirements }) =>
      requirements
        .filter((requirement) => FUNCTION_WORD_SUBJECT.test(requirement.subject ?? ''))
        .map((requirement) => `${requirement.id} の主語が "${requirement.subject}"`),
  },
  {
    id: 'B17',
    description: '主語の末尾が機能語でない',
    // 主語はキーワードの直前 1〜2 語から取るので、機能語を巻き込むことがある
    // （"response and MUST" → "response and"、"methods are REQUIRED" →
    // "methods are"）。実測（RFC 67 本）: 375 件 → 0 件。
    check: ({ requirements }) =>
      requirements
        .filter((requirement) => TRAILING_SUBJECT_WORD.test(requirement.subject ?? ''))
        .map((requirement) => `${requirement.id} の主語が "${requirement.subject}"`),
  },
  {
    id: 'G4',
    description: '定義の section が実在する',
    // XML 経路の構造は `<middle>` だけを見ていたため、後付録が 1 つも入って
    // いなかった。RFC 9114 の Appendix A.2.5 には本物の定義があり、
    // `get_definitions` は §A.2.5 と返すのに、その節が構造に無かった。
    // 箇条書きの中の `<t>` は `pn="section-7.1-8.1"` になり、末尾の `-\d+` だけを
    // 外すと節が "7.1-8.1" になっていた（RFC 9110）。実測: 56 件 → 0 件。
    check: ({ parsed }) =>
      (parsed.definitions ?? [])
        .filter(
          (definition) => definition.section && !findSection(parsed.sections, definition.section)
        )
        .map((definition) => `"${definition.term}" の S${definition.section} が引けない`),
  },
  {
    id: 'B18',
    description: '要件の id の連番が節ごとに 1 から始まる',
    // 連番を文書全体で 1 本にしていたため、同じ要件が呼び方で違う id を持って
    // いた。`validate_statement` は全件から取るので RFC 9110 §6.6.1 の禁止を
    // `R-6.6.1-76` と報告するが、`get_requirements({ section: "6.6.1" })` が
    // 返すのは `R-6.6.1-1` 〜 `R-6.6.1-7` で、教えられた id が存在しなかった。
    // 実測（RFC 67 本）: 節を指定した取得 245 件のうち 194 件で id が食い違って
    // いた（件数は同じ）。
    check: ({ requirements }) => {
      const bySection = new Map();
      for (const requirement of requirements) {
        const match = /^R-(.+)-(\d+)$/.exec(requirement.id ?? '');
        if (!match) continue;
        if (!bySection.has(match[1])) bySection.set(match[1], []);
        bySection.get(match[1]).push(Number(match[2]));
      }
      const broken = [];
      for (const [section, numbers] of bySection) {
        const sorted = [...numbers].sort((a, b) => a - b);
        if (sorted[0] !== 1) broken.push(`S${section} の連番が ${sorted[0]} から始まる`);
        else if (sorted[sorted.length - 1] !== sorted.length) {
          broken.push(
            `S${section} の連番が飛んでいる（${sorted.length} 件で最大 ${sorted[sorted.length - 1]}）`
          );
        }
      }
      return broken;
    },
  },
  {
    id: 'E7',
    description: '参考文献の欄があるなら参照が 1 件以上ある',
    // 見出しの語を `References` だけで見ていたため、`Bibliography` と書く RFC の
    // 参考文献が 1 件も取れず、`get_rfc_dependencies` が空を返していた。
    // RFC 1034 / 1035 / 1058 は `REFERENCES and BIBLIOGRAPHY`、RFC 2822 は
    // `6. Bibliography`。実測で 63 件が落ちていた。
    check: ({ kind, source, parsed }) => {
      if (kind !== 'text') return [];
      const hasHeading = source
        .split('\n')
        .some((line) => REFERENCE_HEADING.test(line.replace(/\s+$/, '').trim()));
      if (!hasHeading) return [];
      const count =
        (parsed.references?.normative?.length ?? 0) + (parsed.references?.informative?.length ?? 0);
      return count === 0 ? ['参考文献の欄はあるが参照が 0 件'] : [];
    },
  },
  {
    id: 'G3',
    description: '定義の用語が文の一部でない',
    // 用語欄は「用語: 説明」「用語 / 字下げした説明」の形をしているが、
    // 折り返した文の途中も同じ形になる。
    //   "The protocol has two parts: a handshake and the data transfer."
    //   "Implementations that have implementation: and/or platform-specific"
    check: ({ parsed }) =>
      (parsed.definitions ?? [])
        .filter(
          (definition) =>
            SENTENCE_OPENER.test(definition.term ?? '') ||
            RELATIVE_CLAUSE.test(definition.term ?? '')
        )
        .map((definition) => `"${definition.term}" は文の一部`),
  },
  {
    id: 'A8',
    description: '節の題名が折り返しの途中で終わっていない',
    // 題名は右余白で折り返す。2 行目を継がないと
    // 「Sub-Namespace Registration of」「…with Self-Signed Public-Key」のように
    // 前置詞・接続詞で終わる。何の登録か、何の証明書かが消える。
    //
    // 本物の題名にもこの形はある（RFC 2445 の "Sent By" "Related To"）。
    // 基準に 5 件入れてある。
    check: ({ parsed }) => {
      const broken = [];
      walk(parsed.sections, (section) => {
        if (TRAILING_FUNCTION_WORD.test(section.title ?? '')) {
          broken.push(`S${section.number} "${section.title}" が前置詞・接続詞で終わる`);
        }
      });
      return broken;
    },
  },
  {
    id: 'F3',
    description: 'チェックリストの項目が 900 文字を超えない',
    check: ({ checklist }) =>
      checklist
        .split('\n')
        .filter((line) => line.startsWith('- [ ]') && line.length > 900)
        .map((line) => `${line.length} 文字: ${line.slice(0, 60)}`),
  },
];
