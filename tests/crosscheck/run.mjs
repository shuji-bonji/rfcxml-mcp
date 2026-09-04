#!/usr/bin/env node
/**
 * 突き合わせ — 7 つのツールの出力が互いに矛盾しないかを見る。
 *
 *   npm run build && npm run crosscheck
 *   npm run crosscheck -- --rfc 9110    1 本だけ見る
 *
 * `npm run audit` との違いは、見るものが「1 つの出力の中の条件」か
 * 「出力どうしの食い違い」かである。監査は 1 本の RFC の 1 つの出力に条件を
 * 当てる。ここは、同じものを違う呼び方で取ったときに答えが揃うかを見る。
 *
 * この形でしか見つからない不具合が実際にあった。
 *
 * | 版 | 見つかったもの |
 * |---|---|
 * | v0.6.34 | XML 経路の構造に後付録が無いのに、定義は §A.2.5 を指していた |
 * | v0.6.35 | 同じ RFC の目次が、XML 経路とテキスト経路で食い違っていた |
 * | v0.6.36 | validate_statement が教えた id を get_requirements で引けなかった |
 *
 * RFC の本文は `tests/audit/.cache/` を使い回す。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
process.env.RFCXML_CACHE_DIR ??= path.join(HERE, '..', 'audit', '.cache', 'disk');

const { toolHandlers } = await import('../../dist/tools/handlers.js');
const { CORPUS } = await import('../audit/corpus.mjs');

/** 目印から要件になる割合の下限。これを下回ると、静かに落ちている疑いがある。 */
const MIN_MARKER_TO_REQUIREMENT = 0.55;

function parseArgs(argv) {
  const options = { rfc: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rfc') options.rfc = Number(argv[++i]);
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: npm run crosscheck [-- --rfc 9110]');
      process.exit(0);
    }
  }
  return options;
}

const walk = (sections, fn) => {
  for (const section of sections ?? []) {
    fn(section);
    walk(section.subsections, fn);
  }
};

const fold = (value) => (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * 突き合わせの一覧。
 *
 * それぞれ `{ id, description, check(context) }` で、食い違いの説明を配列で返す。
 */
const CHECKS = [
  {
    id: 'X1',
    description: '要件の section が構造にある',
    check: ({ titles, requirements }) =>
      requirements
        .filter((r) => r.section && !titles.has(r.section))
        .map((r) => `${r.id} の S${r.section} が構造に無い`),
  },
  {
    id: 'X2',
    description: '要件の sectionTitle が構造の題名と一致する',
    check: ({ titles, requirements }) =>
      requirements
        .filter(
          (r) => r.sectionTitle && titles.has(r.section) && titles.get(r.section) !== r.sectionTitle
        )
        .map((r) => `${r.id} 構造="${titles.get(r.section)}" 要件="${r.sectionTitle}"`),
  },
  {
    id: 'X3',
    description: '定義の section が構造にある',
    check: ({ titles, definitions }) =>
      definitions
        .filter((d) => d.section && !titles.has(d.section))
        .map((d) => `"${d.term}" の S${d.section} が構造に無い`),
  },
  {
    id: 'X4',
    description: '要件の action / condition / exception が本文にある',
    check: ({ requirements }) => {
      const broken = [];
      for (const requirement of requirements) {
        const scope = fold(`${requirement.text} ${requirement.fullContext ?? ''}`);
        for (const field of ['action', 'condition', 'exception']) {
          const value = requirement[field];
          if (value && !scope.includes(fold(value).slice(0, 50))) {
            broken.push(`${requirement.id} の ${field} が本文に無い`);
          }
        }
      }
      return broken;
    },
  },
  {
    id: 'X5',
    description: 'checklist の件数が要件の数と合う',
    check: ({ requirements, checklist }) =>
      checklist.stats.total === requirements.length
        ? []
        : [`要件 ${requirements.length} 件に対して checklist.total=${checklist.stats.total}`],
  },
  {
    id: 'X6',
    description: '目印の 55% 以上が要件になる',
    // 1 つの文に同じレベルのキーワードが 2 回あると 1 件に畳まれるので 1.0 には
    // ならない。実測の中央値は 0.95、最も低い RFC 9293 で 0.60 だった。
    check: ({ markers, requirements }) => {
      if (markers === 0) return [];
      const ratio = requirements.length / markers;
      return ratio >= MIN_MARKER_TO_REQUIREMENT
        ? []
        : [`目印 ${markers} 件に対して要件 ${requirements.length} 件（${ratio.toFixed(2)}）`];
    },
  },
];

/** 呼び方を変えても答えが揃うか。RFC ごとに数回だけ呼ぶ。 */
async function compareCallShapes(rfc, requirements, numbers) {
  const broken = [];

  const bySection = new Map();
  for (const requirement of requirements) {
    if (!bySection.has(requirement.section)) bySection.set(requirement.section, []);
    bySection.get(requirement.section).push(requirement);
  }

  // X7: 節を指定した取得が、全件のうちその節のものと一致する（id を含めて）
  for (const section of [...bySection.keys()].slice(0, 5)) {
    const one = await toolHandlers.get_requirements({ rfc, section });
    const got = one.requirements.filter((r) => r.section === section).map((r) => r.id);
    const want = bySection.get(section).map((r) => r.id);
    if (got.join(',') !== want.join(',')) {
      broken.push(`X7 §${section}: 全件=[${want.join(',')}] 節指定=[${got.join(',')}]`);
    }
  }

  // X8: レベルを指定した取得が、全件のうちそのレベルのものと一致する
  for (const level of ['MUST', 'MUST NOT', 'SHOULD']) {
    const one = await toolHandlers.get_requirements({ rfc, level });
    const want = requirements.filter((r) => r.level === level).length;
    if (one.requirements.length !== want) {
      broken.push(`X8 ${level}: 全件から=${want} level 指定=${one.requirements.length}`);
    }
  }

  // X9: 親節を指定すると下位節も入る
  const sections = [...bySection.keys()];
  const parent = sections.find(
    (s) => /^\d+$/.test(s) && sections.some((other) => other.startsWith(`${s}.`))
  );
  if (parent) {
    const withSub = await toolHandlers.get_requirements({ rfc, section: parent });
    const want = requirements.filter(
      (r) => r.section === parent || r.section.startsWith(`${parent}.`)
    ).length;
    if (withSub.requirements.length !== want) {
      broken.push(`X9 §${parent}: 期待=${want} 実際=${withSub.requirements.length}`);
    }
  }

  // X11: validate_statement が示す矛盾の相手が、一致の一覧に入っている
  //
  // 矛盾は RFC 全体を相手に取っていたので、`matchingRequirements` に出てこない
  // 要件が `conflicts` に入っていた。利用者は示された相手を一覧から探せない。
  for (const requirement of requirements.filter((r) => r.text.length < 300).slice(0, 2)) {
    const verdict = await toolHandlers.validate_statement({ rfc, statement: requirement.text });
    const matched = new Set((verdict.matchingRequirements ?? []).map((m) => m.id));
    for (const conflict of verdict.conflicts ?? []) {
      if (!matched.has(conflict.requirement.id)) {
        broken.push(`X11 ${requirement.id}: 矛盾の相手 ${conflict.requirement.id} が一致の一覧に無い`);
      }
    }
  }

  // X10: get_related_sections が返す節が構造にある
  const sample = [...numbers].filter((n) => /^\d+(\.\d+)?$/.test(n)).slice(0, 4);
  for (const section of sample) {
    const related = await toolHandlers.get_related_sections({ rfc, section });
    for (const item of related.relatedSections ?? []) {
      if (!numbers.has(item.number)) broken.push(`X10 §${section} -> §${item.number} が構造に無い`);
    }
  }

  return broken;
}

/** 1 つの文に複数の要件が入っているぶん。目印の数を戻すために使う。 */
function countCollapsed(requirements) {
  const seen = new Map();
  for (const requirement of requirements) {
    const key = `${requirement.section} ${requirement.level} ${requirement.text}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let extra = 0;
  for (const [, times] of seen) if (times > 1) extra += times - 1;
  return extra;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const corpus = options.rfc ? CORPUS.filter((entry) => entry.rfc === options.rfc) : CORPUS;
  if (corpus.length === 0) {
    console.error('該当する RFC が無い');
    process.exit(2);
  }

  console.log(`突き合わせ: RFC ${corpus.length} 本`);
  console.log('');

  const failures = [];
  let checked = 0;

  for (const entry of corpus) {
    const rfc = entry.rfc;
    const structure = await toolHandlers.get_rfc_structure({ rfc });
    const titles = new Map();
    const numbers = new Set();
    walk(structure.sections, (section) => {
      titles.set(section.number, section.title);
      numbers.add(section.number);
    });

    const requirements = (await toolHandlers.get_requirements({ rfc })).requirements;
    const definitions = (await toolHandlers.get_definitions({ rfc })).definitions;
    const checklist = await toolHandlers.generate_checklist({ rfc });
    const markers = requirements.length + countCollapsed(requirements);

    const context = { rfc, titles, requirements, definitions, checklist, markers };
    for (const check of CHECKS) {
      checked++;
      const found = check.check(context);
      if (found.length > 0) {
        failures.push({ rfc, id: check.id, description: check.description, found });
      }
    }

    const shapes = await compareCallShapes(rfc, requirements, numbers);
    checked += 5;
    if (shapes.length > 0) {
      failures.push({
        rfc,
        id: 'X7-X11',
        description: '同じものを違う呼び方で取る',
        found: shapes,
      });
    }
  }

  console.log(`当てた条件: ${checked}`);
  console.log('');

  if (failures.length === 0) {
    console.log('食い違いは無し。');
    return;
  }

  console.log('食い違い:');
  for (const failure of failures) {
    console.log(`  ${failure.id} RFC ${failure.rfc}: ${failure.description}`);
    for (const line of failure.found.slice(0, 5)) console.log(`      ${line}`);
    if (failure.found.length > 5) console.log(`      … 他 ${failure.found.length - 5} 件`);
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
