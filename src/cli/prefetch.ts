#!/usr/bin/env node
/**
 * rfcxml-prefetch — pre-populate the on-disk RFCXML cache.
 *
 * Phase 3 component. Bridges the gap between the MCP runtime (which fetches
 * one RFC at a time on demand) and operators who need offline / CI-pinned
 * access to a known set of RFCs. The CLI walks a list of RFC numbers, fetches
 * each via the same pipeline as the MCP server (so source-priority and
 * validation are identical), and writes them to the same disk cache layout.
 *
 * Usage:
 *   rfcxml-prefetch --range 9000-9120
 *   rfcxml-prefetch --rfc 9110 --rfc 9112 --rfc 9000
 *   rfcxml-prefetch --range 9000-9010 --cache-dir ./my-cache
 *   rfcxml-prefetch --range 9000-9050 --concurrency 4 --force
 *
 * Defaults:
 *   --cache-dir   = $RFCXML_CACHE_DIR (or ~/.cache/rfcxml-mcp if unset)
 *   --concurrency = 3 (RFC Editor is shared infrastructure — be polite)
 *   --force       = false (skip RFCs already on disk)
 *
 * Why not just `curl` in a loop?
 *   - Single source-priority list (rfc-editor first, datatracker fallback)
 *   - XML validation matches the MCP runtime expectations
 *   - Disk layout matches what the MCP runtime reads, no schema drift
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fetchRFCText, fetchRFCXML, resetDiskCacheForTesting } from '../services/rfc-fetcher.js';
import { DiskCache } from '../utils/disk-cache.js';
import { PACKAGE_INFO } from '../config.js';

interface CliOptions {
  rfcs: number[];
  cacheDir: string;
  concurrency: number;
  force: boolean;
}

const USAGE = `\
rfcxml-prefetch v${PACKAGE_INFO.version}

Pre-populate the RFCXML disk cache so the MCP server can serve cached RFCs
without hitting the network at runtime.

Usage:
  rfcxml-prefetch --range A-B [--cache-dir DIR] [--concurrency N] [--force]
  rfcxml-prefetch --rfc N [--rfc N ...]
  rfcxml-prefetch --help

Options:
  --range A-B          Inclusive RFC number range (e.g. --range 9000-9120)
  --rfc N              Single RFC number; can be repeated
  --cache-dir DIR      Disk cache root (default: $RFCXML_CACHE_DIR or
                       ~/.cache/rfcxml-mcp)
  --concurrency N      Parallel fetches (default: 3)
  --force              Re-download even if the file is already on disk
  --help, -h           Show this help

Notes:
  - Old RFCs (< 8650) generally have no XML; those are cached as text instead.
  - The MCP server picks up the cache automatically when started with
    RFCXML_CACHE_DIR pointing at the same directory.
`;

/**
 * RFC 番号を読む。数字だけを受け付ける。
 *
 * `parseInt` は `9110abc` を 9110 として通していた（Issue #17）。
 */
export function parseRFCNumber(value: string | undefined, flag: string): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new Error(`${flag} expects a positive integer, got "${value ?? ''}"`);
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`${flag} expects a positive integer, got "${value}"`);
  }
  return n;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    rfcs: [],
    cacheDir:
      process.env.RFCXML_CACHE_DIR?.trim() || path.join(os.homedir(), '.cache', 'rfcxml-mcp'),
    concurrency: 3,
    force: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help':
      case '-h':
        process.stdout.write(USAGE);
        process.exit(0);
        break;
      case '--range': {
        const v = argv[++i];
        const m = v?.match(/^(\d+)-(\d+)$/);
        if (!m) throw new Error(`--range expects N-M, got "${v}"`);
        const from = parseRFCNumber(m[1], '--range');
        const to = parseRFCNumber(m[2], '--range');
        if (from > to) throw new Error(`--range: from (${from}) > to (${to})`);
        for (let n = from; n <= to; n++) opts.rfcs.push(n);
        break;
      }
      case '--rfc': {
        opts.rfcs.push(parseRFCNumber(argv[++i], '--rfc'));
        break;
      }
      case '--cache-dir':
        opts.cacheDir = argv[++i];
        if (!opts.cacheDir) throw new Error(`--cache-dir requires a path`);
        break;
      case '--concurrency': {
        const v = argv[++i];
        const n = parseInt(v ?? '', 10);
        if (!Number.isInteger(n) || n <= 0) throw new Error(`--concurrency expects positive int`);
        opts.concurrency = n;
        break;
      }
      case '--force':
        opts.force = true;
        break;
      default:
        throw new Error(`Unknown argument: ${a}\n\n${USAGE}`);
    }
  }

  if (opts.rfcs.length === 0) {
    throw new Error(`No RFCs specified. Use --range or --rfc.\n\n${USAGE}`);
  }

  // Dedup + sort for stable output ordering.
  opts.rfcs = Array.from(new Set(opts.rfcs)).sort((a, b) => a - b);
  return opts;
}

interface FetchResult {
  rfc: number;
  status: 'ok' | 'skipped' | 'failed';
  error?: string;
}

/**
 * Process one RFC. Returns a result row instead of throwing so the runner can
 * tally totals across the whole batch.
 */
async function processOne(
  rfc: number,
  cache: DiskCache,
  textCache: DiskCache,
  force: boolean
): Promise<FetchResult> {
  // XML でもテキストでもディスクにあれば飛ばす。v0.6.52 までは `xml/` しか
  // 見ていなかったので、XML の無い RFC 8649 は毎回 404 を 2 本投げてから
  // `Text loaded from disk cache` になり、"fetched" と数えられていた（Issue #17）。
  if (!force && ((await cache.has(rfc)) || (await textCache.has(rfc)))) {
    return { rfc, status: 'skipped' };
  }
  try {
    const xml = await fetchRFCXML(rfc, { forceFresh: force });
    // fetchRFCXML already writes to the disk cache when RFCXML_CACHE_DIR is
    // set, so this is usually redundant. But we set it explicitly to handle
    // the `--force` case where we want a guaranteed write even if the
    // in-memory cache returned a stale entry on a previous loop iteration.
    await cache.set(rfc, xml);
    return { rfc, status: 'ok' };
  } catch (xmlError) {
    // RFCXML が無い RFC はテキストで読む（RFC 8650 より前のほとんど）。
    // ここで取っておかないと、MCP サーバは起動のたびに本文を取り直す。
    try {
      await fetchRFCText(rfc, { forceFresh: force });
      return { rfc, status: 'ok' };
    } catch {
      return {
        rfc,
        status: 'failed',
        error: xmlError instanceof Error ? xmlError.message : String(xmlError),
      };
    }
  }
}

/**
 * Bounded-concurrency runner. Plain Promise.all would saturate RFC Editor on
 * a 1000-RFC range — keep it polite.
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<FetchResult>
): Promise<FetchResult[]> {
  const results: FetchResult[] = [];
  let cursor = 0;

  async function next(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx]);
      // Progress line — write to stderr so stdout stays clean for piping.
      process.stderr.write(
        `[${idx + 1}/${items.length}] rfc${results[idx].rfc}: ${results[idx].status}` +
          (results[idx].error ? ` (${results[idx].error.split('\n')[0]})` : '') +
          '\n'
      );
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
  return results;
}

async function main(): Promise<void> {
  let opts: CliOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    // 引数の誤りも取得の失敗も 1 で終わる（Issue #17: `--rfc 9110abc` は exit 1）。
    process.exit(1);
  }

  // Plumb the cache dir into the env so fetchRFCXML's lazy init picks it up.
  process.env.RFCXML_CACHE_DIR = opts.cacheDir;
  resetDiskCacheForTesting();

  const cache = new DiskCache(path.join(opts.cacheDir, 'xml'));
  const textCache = new DiskCache(path.join(opts.cacheDir, 'text'), 'text');
  await fs.mkdir(cache.dir, { recursive: true });
  await fs.mkdir(textCache.dir, { recursive: true });

  process.stderr.write(
    `rfcxml-prefetch: ${opts.rfcs.length} RFCs -> ${cache.dir} ` +
      `(concurrency=${opts.concurrency}, force=${opts.force})\n`
  );

  const results = await runWithConcurrency(opts.rfcs, opts.concurrency, (rfc) =>
    processOne(rfc, cache, textCache, opts.force)
  );

  const summary = results.reduce(
    (acc, r) => {
      acc[r.status]++;
      return acc;
    },
    { ok: 0, skipped: 0, failed: 0 }
  );

  process.stderr.write(
    `\nDone: ${summary.ok} fetched, ${summary.skipped} skipped, ${summary.failed} failed\n`
  );

  if (summary.failed > 0) {
    process.stderr.write('\nFailures:\n');
    for (const r of results.filter((r) => r.status === 'failed')) {
      process.stderr.write(`  rfc${r.rfc}: ${r.error}\n`);
    }
    process.exit(1);
  }
}

// テストが parseRFCNumber を import できるよう、CLI として起動されたときだけ走る。
const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
