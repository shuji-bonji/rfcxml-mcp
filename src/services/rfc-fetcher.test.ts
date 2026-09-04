/**
 * rfc-fetcher のユニットテスト
 *
 * Phase 1 で追加した Datatracker API 系の関数（fetchAuthors / fetchReferences /
 * fetchDocEvents）と、URI 形式 std_level / stream をスラグに正規化するように
 * なった fetchRFCMetadata を対象にする。
 *
 * fetch をモックして HTTP をしない。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  fetchRFCMetadata,
  fetchAuthors,
  fetchReferences,
  fetchReferencedBy,
  fetchDocEvents,
  fetchRFCXML,
  fetchRFCText,
  RFCXMLNotAvailableError,
  clearCache,
  resetDiskCacheForTesting,
} from './rfc-fetcher.js';

const originalFetch = globalThis.fetch;

/**
 * URL ごとに別のモックレスポンスを返すヘルパー。
 * `urlMap` は `URL に含まれる部分文字列 -> JSON` の対応表。
 */
function mockFetchByUrl(urlMap: Record<string, unknown>): void {
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    for (const [key, body] of Object.entries(urlMap)) {
      if (url.includes(key)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(body),
          text: () => Promise.resolve(JSON.stringify(body)),
        } as Response);
      }
    }
    return Promise.resolve({ ok: false, status: 404 } as Response);
  });
}

describe('fetchRFCMetadata', () => {
  beforeEach(() => {
    clearCache();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('extracts slug from URI-form std_level and stream', async () => {
    // 実 API は `/api/v1/name/stdlevelname/std/` 形式の URI を返す。
    // 旧実装は string match で常に 'info' / 'IETF' に落ちていた。
    mockFetchByUrl({
      '/doc/document/rfc9110/': {
        title: 'HTTP Semantics',
        time: '2022-06-01T00:00:00Z',
        std_level: '/api/v1/name/stdlevelname/std/',
        stream: '/api/v1/name/streamname/ietf/',
        abstract: 'HTTP semantics doc.',
      },
    });

    const meta = await fetchRFCMetadata(9110);
    expect(meta.title).toBe('HTTP Semantics');
    expect(meta.category).toBe('std');
    expect(meta.stream).toBe('IETF');
    expect(meta.abstract).toBe('HTTP semantics doc.');
    // includeAuthors を渡していないので空のまま
    expect(meta.authors).toEqual([]);
  });

  it('maps Proposed Standard URI to std', async () => {
    mockFetchByUrl({
      '/doc/document/rfc9999/': {
        title: 'Test',
        std_level: '/api/v1/name/stdlevelname/ps/',
        stream: '/api/v1/name/streamname/ietf/',
      },
    });
    const meta = await fetchRFCMetadata(9999);
    expect(meta.category).toBe('std');
  });

  it('maps Best Current Practice', async () => {
    mockFetchByUrl({
      '/doc/document/rfc9998/': {
        std_level: '/api/v1/name/stdlevelname/bcp/',
        stream: '/api/v1/name/streamname/ietf/',
      },
    });
    const meta = await fetchRFCMetadata(9998);
    expect(meta.category).toBe('bcp');
  });

  it('maps ISE stream to independent', async () => {
    mockFetchByUrl({
      '/doc/document/rfc9997/': {
        std_level: '/api/v1/name/stdlevelname/inf/',
        stream: '/api/v1/name/streamname/ise/',
      },
    });
    const meta = await fetchRFCMetadata(9997);
    expect(meta.stream).toBe('independent');
  });

  it('falls back to minimal metadata when document API fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    const meta = await fetchRFCMetadata(9000);
    expect(meta.number).toBe(9000);
    expect(meta.title).toBe('RFC 9000');
    expect(meta.authors).toEqual([]);
    // Issue #14: 届かなかったときに 'info' / 'IETF' を捏造しない。理由を残す。
    expect(meta.category).toBeUndefined();
    expect(meta.stream).toBeUndefined();
    expect(meta.datatrackerError).toBe('HTTP 500');
    expect('category' in meta).toBe(false);
  });

  it('omits category / stream for values outside the mapping (RFC 1: unkn / legacy)', async () => {
    // Issue #14: Datatracker は RFC 1 を std_level=unkn, stream=legacy と返す。
    // 以前は default 節で 'info' / 'IETF' にしていた。
    mockFetchByUrl({
      '/doc/document/rfc1/': {
        title: 'Host Software',
        std_level: '/api/v1/name/stdlevelname/unkn/',
        stream: '/api/v1/name/streamname/legacy/',
      },
    });
    const meta = await fetchRFCMetadata(1);
    expect(meta.title).toBe('Host Software');
    expect('category' in meta).toBe(false);
    expect('stream' in meta).toBe(false);
    expect(meta.datatrackerError).toBeUndefined();
  });

  it('maps the inf slug to info explicitly', async () => {
    // 'info' は default ではなく 'inf' に対する対応でなければならない。
    mockFetchByUrl({
      '/doc/document/rfc6151/': {
        title: 'Updated Security Considerations for MD5',
        std_level: '/api/v1/name/stdlevelname/inf/',
        stream: '/api/v1/name/streamname/ietf/',
      },
    });
    const meta = await fetchRFCMetadata(6151);
    expect(meta.category).toBe('info');
    expect(meta.stream).toBe('IETF');
  });

  it('includes authors when includeAuthors=true', async () => {
    mockFetchByUrl({
      '/doc/document/rfc9110/': {
        title: 'HTTP Semantics',
        std_level: '/api/v1/name/stdlevelname/std/',
        stream: '/api/v1/name/streamname/ietf/',
      },
      '/doc/documentauthor/': {
        meta: { total_count: 1 },
        objects: [
          {
            affiliation: 'Adobe',
            email: '/api/v1/person/email/fielding@gbiv.com/',
            person: '/api/v1/person/person/16400/',
            order: 1,
          },
        ],
      },
      '/person/person/16400/': {
        id: 16400,
        name: 'Roy T. Fielding',
        ascii: 'Roy T. Fielding',
      },
    });

    const meta = await fetchRFCMetadata(9110, { includeAuthors: true });
    expect(meta.authors).toHaveLength(1);
    expect(meta.authors[0]).toEqual({
      fullname: 'Roy T. Fielding',
      email: 'fielding@gbiv.com',
      organization: 'Adobe',
    });
  });
});

describe('fetchAuthors', () => {
  beforeEach(() => {
    clearCache();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('sorts authors by `order` field', async () => {
    mockFetchByUrl({
      '/doc/documentauthor/': {
        meta: { total_count: 2 },
        objects: [
          // 意図的に order を逆順にする
          {
            affiliation: 'B',
            email: '/api/v1/person/email/b@x.com/',
            person: '/api/v1/person/person/2/',
            order: 2,
          },
          {
            affiliation: 'A',
            email: '/api/v1/person/email/a@x.com/',
            person: '/api/v1/person/person/1/',
            order: 1,
          },
        ],
      },
      '/person/person/1/': { id: 1, name: 'Alice', ascii: 'Alice' },
      '/person/person/2/': { id: 2, name: 'Bob', ascii: 'Bob' },
    });

    const authors = await fetchAuthors(9999);
    expect(authors).toHaveLength(2);
    expect(authors[0].fullname).toBe('Alice');
    expect(authors[1].fullname).toBe('Bob');
  });

  it('returns Unknown for unresolvable person', async () => {
    mockFetchByUrl({
      '/doc/documentauthor/': {
        meta: { total_count: 1 },
        objects: [
          {
            affiliation: '',
            email: '/api/v1/person/email/x@y.com/',
            person: '/api/v1/person/person/9999999/',
            order: 1,
          },
        ],
      },
      // person は 404
    });

    const authors = await fetchAuthors(9999);
    expect(authors).toHaveLength(1);
    expect(authors[0].fullname).toBe('Unknown');
    expect(authors[0].email).toBe('x@y.com');
    expect(authors[0].organization).toBeUndefined();
  });

  it('returns empty array on API failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    const authors = await fetchAuthors(9999);
    expect(authors).toEqual([]);
  });
});

describe('fetchReferences', () => {
  beforeEach(() => {
    clearCache();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('extracts RFC references from API response', async () => {
    mockFetchByUrl({
      '/doc/relateddocument/': {
        meta: { total_count: 3, next: null },
        objects: [
          {
            source: '/api/v1/doc/document/rfc9110/',
            target: '/api/v1/doc/document/rfc8174/',
            relationship: '/api/v1/name/docrelationshipname/refnorm/',
          },
          {
            source: '/api/v1/doc/document/rfc9110/',
            target: '/api/v1/doc/document/rfc7405/',
            relationship: '/api/v1/name/docrelationshipname/refinfo/',
          },
          // BCP / STD alias は除外される
          {
            source: '/api/v1/doc/document/rfc9110/',
            target: '/api/v1/doc/document/bcp35/',
            relationship: '/api/v1/name/docrelationshipname/refinfo/',
          },
        ],
      },
    });

    const refs = await fetchReferences(9110);
    expect(refs).toHaveLength(2);
    // RFC 番号順にソートされている
    expect(refs[0]).toEqual({
      rfcNumber: 7405,
      name: 'RFC7405',
      relationship: 'refinfo',
    });
    expect(refs[1]).toEqual({
      rfcNumber: 8174,
      name: 'RFC8174',
      relationship: 'refnorm',
    });
  });

  it('returns empty array on API failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    const refs = await fetchReferences(9110);
    expect(refs).toEqual([]);
  });

  it('filters out unrecognized relationship slugs', async () => {
    mockFetchByUrl({
      '/doc/relateddocument/': {
        meta: { total_count: 1, next: null },
        objects: [
          {
            source: '/api/v1/doc/document/rfc9110/',
            target: '/api/v1/doc/document/rfc8174/',
            relationship: '/api/v1/name/docrelationshipname/obsoletes/',
          },
        ],
      },
    });
    const refs = await fetchReferences(9110);
    expect(refs).toEqual([]);
  });
});

describe('fetchReferencedBy', () => {
  beforeEach(() => {
    clearCache();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('extracts RFCs that reference the target', async () => {
    mockFetchByUrl({
      '/doc/relateddocument/': {
        meta: { total_count: 1, next: null },
        objects: [
          {
            source: '/api/v1/doc/document/rfc9999/',
            target: '/api/v1/doc/document/rfc9110/',
            relationship: '/api/v1/name/docrelationshipname/refnorm/',
          },
        ],
      },
    });

    const refs = await fetchReferencedBy(9110);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      rfcNumber: 9999,
      name: 'RFC9999',
      relationship: 'refnorm',
    });
  });
});

describe('fetchRFCXML disk cache integration (Phase 3)', () => {
  let tmpDir: string;
  const originalEnv = process.env.RFCXML_CACHE_DIR;

  beforeEach(async () => {
    clearCache();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rfcxml-mcp-fetcher-'));
    process.env.RFCXML_CACHE_DIR = tmpDir;
    resetDiskCacheForTesting();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
    if (originalEnv === undefined) delete process.env.RFCXML_CACHE_DIR;
    else process.env.RFCXML_CACHE_DIR = originalEnv;
    resetDiskCacheForTesting();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes fetched XML to disk cache when env var is set', async () => {
    const xml = '<?xml version="1.0"?><rfc number="9999"></rfc>';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(xml),
    });

    await fetchRFCXML(9999);

    // ファイルが <tmp>/xml/rfc9999.xml に保存されているはず
    const expectedPath = path.join(tmpDir, 'xml', 'rfc9999.xml');
    const written = await fs.readFile(expectedPath, 'utf-8');
    expect(written).toBe(xml);
  });

  it('serves from disk cache without HTTP when in-memory cache is empty', async () => {
    // 事前にファイルを置いて、in-memory はクリアした状態でスタート
    const xml = '<?xml version="1.0"?><rfc number="8888">cached</rfc>';
    const xmlDir = path.join(tmpDir, 'xml');
    await fs.mkdir(xmlDir, { recursive: true });
    await fs.writeFile(path.join(xmlDir, 'rfc8888.xml'), xml, 'utf-8');

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const result = await fetchRFCXML(8888);
    expect(result).toBe(xml);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forceFresh bypasses both caches and re-downloads', async () => {
    // ディスクには古いコピーを置いておく
    const xmlDir = path.join(tmpDir, 'xml');
    await fs.mkdir(xmlDir, { recursive: true });
    await fs.writeFile(path.join(xmlDir, 'rfc7777.xml'), '<old/>', 'utf-8');

    const fresh = '<?xml version="1.0"?><rfc number="7777">new</rfc>';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(fresh),
    });

    const result = await fetchRFCXML(7777, { forceFresh: true });
    expect(result).toBe(fresh);
    // 上書きされている
    const onDisk = await fs.readFile(path.join(xmlDir, 'rfc7777.xml'), 'utf-8');
    expect(onDisk).toBe(fresh);
  });
});

describe('fetchDocEvents', () => {
  beforeEach(() => {
    clearCache();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('returns the most recent doc events', async () => {
    mockFetchByUrl({
      '/doc/docevent/': {
        meta: { total_count: 2 },
        objects: [
          {
            type: 'sync_from_rfc_editor',
            desc: 'Imported',
            time: '2022-11-02T05:15:17Z',
            rev: '19',
          },
          {
            type: 'std_history_marker',
            desc: 'No history',
            time: '2022-11-02T05:15:17Z',
            rev: null,
          },
        ],
      },
    });

    const events = await fetchDocEvents(9110, 5);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('sync_from_rfc_editor');
    expect(events[1].rev).toBeNull();
  });

  it('returns empty array on failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    const events = await fetchDocEvents(9110);
    expect(events).toEqual([]);
  });
});

describe('concurrent calls share one fetch (Issue #15)', () => {
  beforeEach(() => {
    clearCache();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  /** 少し待ってから返す fetch。同時呼び出しが in-flight のあいだに重なるようにする。 */
  function slowFetch(body: string, jsonBody?: unknown): ReturnType<typeof vi.fn> {
    return vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                status: 200,
                text: () => Promise.resolve(body),
                json: () => Promise.resolve(jsonBody ?? {}),
              } as Response),
            5
          )
        )
    );
  }

  it('fetchRFCXML: 3 concurrent calls hit the network once per source', async () => {
    const xml = '<?xml version="1.0"?><rfc number="9112"></rfc>';
    const spy = slowFetch(xml);
    globalThis.fetch = spy;

    const results = await Promise.all([fetchRFCXML(9112), fetchRFCXML(9112), fetchRFCXML(9112)]);

    expect(results).toEqual([xml, xml, xml]);
    // RFC_XML_SOURCES は 2 つ（rfcEditor + datatracker）。3 本なら 6 回だった。
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('fetchRFCText: 3 concurrent calls hit the network once', async () => {
    const text = 'Request for Comments: 6455\n\nThe WebSocket Protocol';
    const spy = slowFetch(text);
    globalThis.fetch = spy;

    await Promise.all([fetchRFCText(6455), fetchRFCText(6455), fetchRFCText(6455)]);

    // RFC_TEXT_SOURCES は 1 つ。
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('fetchRFCText: forceFresh bypasses the in-memory cache (Issue #17)', async () => {
    const text = 'Request for Comments: 6455\n\nThe WebSocket Protocol';
    const spy = slowFetch(text);
    globalThis.fetch = spy;

    await fetchRFCText(6455);
    await fetchRFCText(6455);
    expect(spy).toHaveBeenCalledTimes(1);

    await fetchRFCText(6455, { forceFresh: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('fetchRFCMetadata: concurrent calls with the same depth share one request', async () => {
    const spy = slowFetch('{}', {
      title: 'HTTP/1.1',
      std_level: '/api/v1/name/stdlevelname/std/',
      stream: '/api/v1/name/streamname/ietf/',
    });
    globalThis.fetch = spy;

    const [a, b] = await Promise.all([fetchRFCMetadata(9112), fetchRFCMetadata(9112)]);
    expect(a.category).toBe('std');
    expect(b).toBe(a);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('fetchRFCXML: a failed fetch is not shared with later calls', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      calls++;
      if (calls <= 2) return Promise.resolve({ ok: false, status: 503 } as Response);
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('<?xml version="1.0"?><rfc number="9112"></rfc>'),
      } as Response);
    });

    await expect(fetchRFCXML(9112)).rejects.toThrow();
    await expect(fetchRFCXML(9112)).resolves.toContain('<rfc');
  });
});

describe('RFCXMLNotAvailableError.notFound (Issue #20)', () => {
  it('is true only when every source returned 404', () => {
    expect(
      new RFCXMLNotAvailableError(9112, [
        'All sources failed: [rfcEditor] HTTP 404; [datatracker] HTTP 404',
      ]).notFound
    ).toBe(true);
    expect(
      new RFCXMLNotAvailableError(9112, [
        'All sources failed: [rfcEditor] HTTP 503; [datatracker] HTTP 404',
      ]).notFound
    ).toBe(false);
    expect(
      new RFCXMLNotAvailableError(9112, ['All sources failed: [rfcEditor] fetch failed']).notFound
    ).toBe(false);
    expect(new RFCXMLNotAvailableError(9112).notFound).toBe(false);
  });
});
