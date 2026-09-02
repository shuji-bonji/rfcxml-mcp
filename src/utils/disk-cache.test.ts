/**
 * DiskCache ユニットテスト
 *
 * 各テストごとに一時ディレクトリを作って隔離する。
 * `RFCXML_CACHE_DIR` 環境変数の挙動も合わせて確認する。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DiskCache } from './disk-cache.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rfcxml-mcp-disk-cache-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('DiskCache.fromEnv', () => {
  const originalEnv = process.env.RFCXML_CACHE_DIR;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.RFCXML_CACHE_DIR;
    else process.env.RFCXML_CACHE_DIR = originalEnv;
  });

  it('returns null when RFCXML_CACHE_DIR is unset', () => {
    delete process.env.RFCXML_CACHE_DIR;
    expect(DiskCache.fromEnv()).toBeNull();
  });

  it('returns null when RFCXML_CACHE_DIR is empty', () => {
    process.env.RFCXML_CACHE_DIR = '';
    expect(DiskCache.fromEnv()).toBeNull();
  });

  it('returns null when RFCXML_CACHE_DIR is whitespace', () => {
    process.env.RFCXML_CACHE_DIR = '   ';
    expect(DiskCache.fromEnv()).toBeNull();
  });

  it('returns DiskCache rooted at <dir>/xml when set', () => {
    process.env.RFCXML_CACHE_DIR = '/tmp/foo';
    const cache = DiskCache.fromEnv();
    expect(cache).not.toBeNull();
    expect(cache?.dir).toBe(path.join('/tmp/foo', 'xml'));
  });
});

describe('DiskCache.has / get / set', () => {
  it('reports has=false on cold cache', async () => {
    const cache = new DiskCache(tmpDir);
    expect(await cache.has(9999)).toBe(false);
    expect(await cache.get(9999)).toBeNull();
  });

  it('reads back what set wrote', async () => {
    const cache = new DiskCache(tmpDir);
    await cache.set(9110, '<?xml version="1.0"?><rfc></rfc>');
    expect(await cache.has(9110)).toBe(true);
    expect(await cache.get(9110)).toBe('<?xml version="1.0"?><rfc></rfc>');
  });

  it('creates the directory tree on first set', async () => {
    const nested = path.join(tmpDir, 'a', 'b', 'c');
    const cache = new DiskCache(nested);
    await cache.set(1, '<rfc>');
    const stat = await fs.stat(nested);
    expect(stat.isDirectory()).toBe(true);
  });

  it('produces filepaths under the configured dir', () => {
    const cache = new DiskCache('/var/cache/foo');
    expect(cache.filepath(123)).toBe(path.join('/var/cache/foo', 'rfc123.xml'));
  });

  it('does not throw on read of a non-existent dir', async () => {
    const cache = new DiskCache(path.join(tmpDir, 'never-created'));
    expect(await cache.get(1)).toBeNull();
    expect(await cache.has(1)).toBe(false);
  });

  it('overwrites an existing entry on set', async () => {
    const cache = new DiskCache(tmpDir);
    await cache.set(1, 'first');
    await cache.set(1, 'second');
    expect(await cache.get(1)).toBe('second');
  });
});

describe('テキストのディスクキャッシュ', () => {
  it('kind: text は .txt を text/ の下に置く', () => {
    const cache = new DiskCache('/var/cache/foo/text', 'text');
    expect(cache.filepath(1122)).toBe(path.join('/var/cache/foo/text', 'rfc1122.txt'));
  });

  it('fromEnv("text") は <RFCXML_CACHE_DIR>/text/ を指す', () => {
    process.env.RFCXML_CACHE_DIR = '/tmp/example';
    const cache = DiskCache.fromEnv('text');
    expect(cache?.dir).toBe(path.join('/tmp/example', 'text'));
    expect(cache?.kind).toBe('text');
  });

  it('書いたテキストを読み戻せる', async () => {
    const cache = new DiskCache(path.join(tmpDir, 'text'), 'text');
    await cache.set(768, 'User Datagram Protocol');
    expect(await cache.get(768)).toBe('User Datagram Protocol');
  });
});
