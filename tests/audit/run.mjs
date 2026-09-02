#!/usr/bin/env node
/**
 * 監査 — 実物の RFC に不変条件を当てる。
 *
 *   npm run build && npm run audit
 *   npm run audit -- --update       破れの基準値を書き換える
 *   npm run audit -- --rfc 1122     1 本だけ見る
 *   npm run audit -- --generation 1990s-early-text
 *
 * 単体テストとの違いは `invariants.mjs` の頭に書いた。要するに、単体テストは
 * 「書いた通りに動くか」、監査は「想定していない書式で破れないか」を見る。
 *
 * 破れの件数は `baseline.json` と突き合わせる。増えたら失敗（終了コード 1）、
 * 減ったら報告だけする。基準値に残っているものは、直せないと判断したもので、
 * その理由は CHANGELOG に書いてある（表の中の要件、原文の誤りなど）。
 *
 * RFC の本文は `tests/audit/.cache/` に置く。初回だけ取得し、以降は使い回す。
 * rfc-editor.org は共有の資源なので、毎回取りに行かない。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRFCXML } from '../../dist/services/rfcxml-parser.js';
import { parseRFCText } from '../../dist/services/rfc-text-parser.js';
import { extractRequirementsFromSections } from '../../dist/utils/requirement-extractor.js';
import {
  generateChecklist,
  generateChecklistMarkdown,
} from '../../dist/services/checklist-generator.js';

import { CORPUS, CORPUS_BY_GENERATION, generationOf } from './corpus.mjs';
import { INVARIANTS } from './invariants.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, '.cache');
const BASELINE_PATH = path.join(HERE, 'baseline.json');

const USER_AGENT = 'rfcxml-mcp-audit (+https://github.com/shuji-bonji/rfcxml-mcp)';

function parseArgs(argv) {
  const options = { update: false, rfcs: null, generation: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--update') options.update = true;
    else if (argv[i] === '--rfc') (options.rfcs ??= []).push(Number(argv[++i]));
    else if (argv[i] === '--generation') options.generation = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(
        [
          'Usage: npm run audit [-- options]',
          '',
          '  --update             破れの件数を baseline.json に書き込む',
          '  --rfc N              その RFC だけ見る（繰り返し可）',
          '  --generation NAME    その世代だけ見る',
          '',
          `世代: ${Object.keys(CORPUS_BY_GENERATION).join(', ')}`,
        ].join('\n')
      );
      process.exit(0);
    }
  }
  return options;
}

/** RFC の本文を取る。`tests/audit/.cache/` にあればそれを使う。 */
async function loadSource({ rfc, kind }) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${rfc}.${kind}`);

  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    // まだ取っていない
  }

  const url = `https://www.rfc-editor.org/rfc/rfc${rfc}.${kind === 'xml' ? 'xml' : 'txt'}`;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`RFC ${rfc} を取得できない (${response.status}) ${url}`);

  const body = await response.text();
  await fs.writeFile(file, body, 'utf8');
  return body;
}

async function auditOne(entry) {
  const source = await loadSource(entry);
  const parsed =
    entry.kind === 'xml' ? parseRFCXML(source) : parseRFCText(source, entry.rfc);
  const requirements = extractRequirementsFromSections(parsed.sections, undefined, {
    parseComponents: true,
  });
  const checklist = generateChecklistMarkdown(
    generateChecklist(entry.rfc, parsed.metadata.title ?? '', requirements.slice(0, 300))
  );

  const context = { rfc: entry.rfc, parsed, requirements, checklist };
  const violations = {};
  for (const invariant of INVARIANTS) {
    const found = invariant.check(context);
    if (found.length > 0) violations[invariant.id] = found;
  }

  return {
    rfc: entry.rfc,
    sections: countSections(parsed.sections),
    requirements: requirements.length,
    definitions: parsed.definitions.length,
    violations,
  };
}

function countSections(sections) {
  let count = 0;
  const walk = (list) => {
    for (const section of list ?? []) {
      count++;
      walk(section.subsections);
    }
  };
  walk(sections);
  return count;
}

async function readBaseline() {
  try {
    return JSON.parse(await fs.readFile(BASELINE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  let corpus = CORPUS;
  if (options.generation) {
    corpus = CORPUS_BY_GENERATION[options.generation] ?? [];
    if (corpus.length === 0) {
      console.error(`世代 "${options.generation}" は無い`);
      process.exit(2);
    }
  }
  if (options.rfcs) corpus = corpus.filter((entry) => options.rfcs.includes(entry.rfc));

  console.log(`監査: RFC ${corpus.length} 本 × 不変条件 ${INVARIANTS.length} 種`);
  console.log('');

  const results = [];
  for (const entry of corpus) {
    try {
      results.push(await auditOne(entry));
    } catch (error) {
      console.error(`RFC ${entry.rfc}: ${error.message}`);
      process.exitCode = 2;
    }
  }

  const totals = results.reduce(
    (sum, result) => ({
      sections: sum.sections + result.sections,
      requirements: sum.requirements + result.requirements,
      definitions: sum.definitions + result.definitions,
    }),
    { sections: 0, requirements: 0, definitions: 0 }
  );
  console.log(
    `合計: 節 ${totals.sections} / 要件 ${totals.requirements} / 定義 ${totals.definitions}`
  );
  console.log('');

  // 破れを不変条件ごとにまとめる
  const counts = {};
  for (const result of results) {
    for (const [id, found] of Object.entries(result.violations)) {
      (counts[id] ??= {})[result.rfc] = found.length;
    }
  }

  if (options.update) {
    // 絞って走らせたときは、見た RFC の分だけ差し替える。全体を上書きすると、
    // 見ていない RFC の基準値が消えて、次の全体実行が「新しい破れ」を出す。
    const merged = options.rfcs || options.generation ? await readBaseline() : {};
    const examined = new Set(results.map((result) => result.rfc));
    for (const id of new Set([...Object.keys(merged), ...Object.keys(counts)])) {
      const kept = Object.fromEntries(
        Object.entries(merged[id] ?? {}).filter(([rfc]) => !examined.has(Number(rfc)))
      );
      const updated = { ...kept, ...(counts[id] ?? {}) };
      if (Object.keys(updated).length > 0) merged[id] = updated;
      else delete merged[id];
    }
    await fs.writeFile(BASELINE_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    console.log(`基準値を書き込んだ: ${path.relative(process.cwd(), BASELINE_PATH)}`);
    printDetail(results);
    return;
  }

  const baseline = await readBaseline();
  const regressions = [];
  const improvements = [];

  // 今回見た RFC だけを突き合わせる。`--rfc` や `--generation` で絞ったとき、
  // 見ていない RFC の基準値を「解消」として出さないため。
  const examined = new Set(results.map((result) => String(result.rfc)));

  for (const invariant of INVARIANTS) {
    const now = counts[invariant.id] ?? {};
    const before = baseline[invariant.id] ?? {};
    for (const rfc of new Set([...Object.keys(now), ...Object.keys(before)])) {
      if (!examined.has(rfc)) continue;
      const actual = now[rfc] ?? 0;
      const expected = before[rfc] ?? 0;
      if (actual > expected)
        regressions.push({ invariant, rfc: Number(rfc), actual, expected });
      else if (actual < expected)
        improvements.push({ invariant, rfc: Number(rfc), actual, expected });
    }
  }

  printDetail(results, baseline);

  if (improvements.length > 0) {
    console.log('解消:');
    for (const item of improvements)
      console.log(
        `  ${item.invariant.id} RFC ${item.rfc}: ${item.expected} -> ${item.actual} 件（${item.invariant.description}）`
      );
    console.log('  --update で基準値を更新してください。');
    console.log('');
  }

  if (regressions.length > 0) {
    console.log('新しい破れ:');
    for (const item of regressions) {
      const detail = results.find((r) => r.rfc === item.rfc)?.violations[item.invariant.id] ?? [];
      console.log(
        `  ${item.invariant.id} RFC ${item.rfc}（${generationOf(item.rfc)}）: ${item.expected} -> ${item.actual} 件 — ${item.invariant.description}`
      );
      for (const line of detail.slice(0, 5)) console.log(`      ${line}`);
      if (detail.length > 5) console.log(`      ... 他 ${detail.length - 5} 件`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('新しい破れは無し。');
}

function printDetail(results, baseline) {
  const counts = {};
  for (const result of results) {
    for (const [id, found] of Object.entries(result.violations)) {
      counts[id] = (counts[id] ?? 0) + found.length;
    }
  }

  const rows = INVARIANTS.map((invariant) => ({
    id: invariant.id,
    description: invariant.description,
    count: counts[invariant.id] ?? 0,
    known: Object.values((baseline ?? {})[invariant.id] ?? {}).reduce((a, b) => a + b, 0),
  }));

  for (const row of rows) {
    const mark = row.count === 0 ? 'OK  ' : row.count <= row.known ? '既知' : 'NEW ';
    const suffix = row.count === 0 ? '' : ` ${row.count} 件${baseline ? `（基準 ${row.known}）` : ''}`;
    console.log(`  ${mark} ${row.id} ${row.description}${suffix}`);
  }
  console.log('');
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
