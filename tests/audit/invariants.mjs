/**
 * 監査で当てる不変条件。
 *
 * ここに並ぶのは「どの RFC でも成り立っていなければならないこと」であり、
 * 単体テストとは役割が違う。単体テストは私が書いた入力に対する assert で、
 * 書いた通りに動くかを確かめる。不変条件は実物の RFC に当てて、想定していない
 * 書式で破れる場所を出す。v0.6.9 以降の不具合はすべてこちらで見つかった。
 *
 * 各条件は `check` が破れの説明を配列で返す。空なら合格。
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

const looksLikeDiagram = (text) => DIAGRAM_PATTERNS.some((pattern) => pattern.test(text ?? ''));

/** 題名の中の略語。ここに挙げた語のあとの `.` は文の終わりではない。 */
const TITLE_ABBREVIATION = /(?:^|[\s(])(?:pp?|vol|nos?|secs?|chs?|figs?|eds?|al|etc|cf|vs|e\.g|i\.e)\.$/i;

/** 題名の中に、略語でない句点があるか。 */
const containsSentenceBreak = (title) => {
  const pattern = /[.!?]\s+\S/g;
  let match;
  while ((match = pattern.exec(title)) !== null) {
    if (!TITLE_ABBREVIATION.test(title.slice(0, match.index + 1))) return true;
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
  const normalize = (value) => (value ?? '').replace(/^section-/, '');
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
        .filter((r) => !new RegExp(`\\b${String(r.level).replace(' ', '\\s+')}\\b`).test(r.text ?? ''))
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
    id: 'C1',
    description: '用語に飾り（末尾のコロン・引用符）が残っていない',
    check: ({ parsed }) =>
      parsed.definitions
        .filter((d) => /:\s*$/.test(d.term) || /^["'].*["']$/.test(d.term))
        .map((d) => `"${d.term}"`),
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
    id: 'F3',
    description: 'チェックリストの項目が 900 文字を超えない',
    check: ({ checklist }) =>
      checklist
        .split('\n')
        .filter((line) => line.startsWith('- [ ]') && line.length > 900)
        .map((line) => `${line.length} 文字: ${line.slice(0, 60)}`),
  },
];
