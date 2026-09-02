#!/usr/bin/env node
/**
 * 出力見本 — 代表的な呼び出しの結果を固定し、差分を目で見る。
 *
 *   npm run build && npm run snapshot
 *   npm run snapshot -- --update        見本を書き換える
 *   npm run snapshot -- --case checklist-9110-9.3.5
 *
 * `npm run audit` との違いは、見るものが「条件」か「見た目」かである。
 * 監査は 23 種の条件に当てはまるかを機械で見る。ここは、条件に落とせない
 * 崩れ（読めない要件文、抜けた節、余計な注記）を人が見る。
 *
 * 見本は `tests/snapshot/__snapshots__/<case>.txt` に置き、git に入れる。
 * 差分が出たら、直したのか壊したのかを判断して `--update` で更新する。
 *
 * RFC の本文は `tests/audit/.cache/disk/` に置く（`RFCXML_CACHE_DIR` として
 * 渡す）。初回だけ取得し、以降は使い回す。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.join(HERE, '__snapshots__');

// ハンドラを読み込む前に置く。ディスクキャッシュは最初の呼び出しで固定される。
process.env.RFCXML_CACHE_DIR ??= path.join(HERE, '..', 'audit', '.cache', 'disk');

const { toolHandlers } = await import('../../dist/tools/handlers.js');
const { CASES } = await import('./cases.mjs');

function parseArgs(argv) {
  const options = { update: false, cases: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--update') options.update = true;
    else if (argv[i] === '--case') (options.cases ??= []).push(argv[++i]);
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(
        [
          'Usage: npm run snapshot [-- options]',
          '',
          '  --update        見本を書き換える',
          '  --case NAME     その見本だけ見る（繰り返し可）',
        ].join('\n')
      );
      process.exit(0);
    }
  }
  return options;
}

/**
 * 実行ごとに変わる値を消す。
 *
 * `generatedAt` は生成時刻で、毎回変わる。ここを残すと全件が差分になる。
 */
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === 'generatedAt') {
        out[key] = '<generatedAt>';
        continue;
      }
      out[key] = normalize(item);
    }
    return out;
  }
  if (typeof value === 'string') {
    return value.replace(/Generated: \d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, 'Generated: <generatedAt>');
  }
  return value;
}

/**
 * 見本の本文を組み立てる。
 *
 * JSON をそのまま書くと、Markdown の中の `\n` が読めない。`markdown` だけは
 * 生のまま別に出す。見本は人が読むためのものである。
 */
function render(testCase, result) {
  const normalized = normalize(result);
  const lines = [
    `# ${testCase.name}`,
    '',
    `tool: ${testCase.tool}`,
    `args: ${JSON.stringify(testCase.args)}`,
    '',
  ];

  if (typeof normalized.markdown === 'string') {
    lines.push('--- markdown ---', normalized.markdown.replace(/\s+$/, ''), '');
    const { markdown, ...rest } = normalized;
    lines.push('--- json ---', JSON.stringify(rest, null, 2));
  } else {
    lines.push('--- json ---', JSON.stringify(normalized, null, 2));
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });

  let cases = CASES;
  if (options.cases) cases = cases.filter((c) => options.cases.includes(c.name));
  if (cases.length === 0) {
    console.error('該当する見本が無い');
    process.exit(2);
  }

  console.log(`出力見本: ${cases.length} 件`);
  console.log('');

  const changed = [];
  const created = [];
  const failed = [];

  for (const testCase of cases) {
    const file = path.join(SNAPSHOT_DIR, `${testCase.name}.txt`);
    let actual;
    try {
      const handler = toolHandlers[testCase.tool];
      if (!handler) throw new Error(`ツール ${testCase.tool} が無い`);
      actual = render(testCase, await handler(testCase.args));
    } catch (error) {
      failed.push({ testCase, message: error instanceof Error ? error.message : String(error) });
      console.log(`  ERR  ${testCase.name}`);
      continue;
    }

    let expected = null;
    try {
      expected = await fs.readFile(file, 'utf8');
    } catch {
      // まだ見本が無い
    }

    if (expected === null) {
      await fs.writeFile(file, actual, 'utf8');
      created.push(testCase.name);
      console.log(`  NEW  ${testCase.name}`);
    } else if (expected === actual) {
      console.log(`  OK   ${testCase.name}`);
    } else if (options.update) {
      await fs.writeFile(file, actual, 'utf8');
      changed.push({ name: testCase.name, expected, actual });
      console.log(`  更新 ${testCase.name}`);
    } else {
      changed.push({ name: testCase.name, expected, actual });
      console.log(`  差分 ${testCase.name}`);
    }
  }

  console.log('');

  if (created.length > 0) {
    console.log(`新しい見本を ${created.length} 件書いた。中身を読んでから commit してください。`);
    console.log('');
  }

  if (failed.length > 0) {
    console.log('失敗:');
    for (const item of failed) console.log(`  ${item.testCase.name}: ${item.message}`);
    console.log('');
    process.exitCode = 2;
  }

  if (changed.length > 0 && !options.update) {
    console.log('差分:');
    for (const item of changed) {
      console.log(`  --- ${item.name}`);
      for (const line of diffLines(item.expected, item.actual)) console.log(`    ${line}`);
    }
    console.log('');
    console.log('直したのなら --update で見本を更新してください。');
    process.exitCode = 1;
    return;
  }

  if (failed.length === 0 && changed.length === 0) console.log('差分は無し。');
}

/** 行単位の差分。前後 2 行だけ出す。 */
function diffLines(expected, actual, context = 2) {
  const before = expected.split('\n');
  const after = actual.split('\n');
  const out = [];

  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;

  let endBefore = before.length - 1;
  let endAfter = after.length - 1;
  while (endBefore > start && endAfter > start && before[endBefore] === after[endAfter]) {
    endBefore--;
    endAfter--;
  }

  for (let i = Math.max(0, start - context); i < start; i++) out.push(`  ${before[i]}`);
  for (let i = start; i <= endBefore; i++) out.push(`- ${clip(before[i])}`);
  for (let i = start; i <= endAfter; i++) out.push(`+ ${clip(after[i])}`);
  for (let i = endBefore + 1; i <= Math.min(before.length - 1, endBefore + context); i++)
    out.push(`  ${before[i]}`);

  return out.slice(0, 40);
}

const clip = (line) => (line.length > 200 ? `${line.slice(0, 200)}…` : line);

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
