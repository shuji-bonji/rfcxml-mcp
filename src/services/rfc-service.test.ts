/**
 * rfc-service のユニットテスト
 *
 * fetch をモックして HTTP をしない。`getParsedRFC` の
 * 「同時呼び出しをまとめる」（Issue #15）と
 * 「XML の一時的な失敗でテキストへ落ちる」（Issue #20）を見る。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getParsedRFC, clearParseCache } from './rfc-service.js';
import { clearCache } from './rfc-fetcher.js';

const originalFetch = globalThis.fetch;

const TEXT_9112 = `Internet Engineering Task Force (IETF)                        R. Fielding
Request for Comments: 9112                                        Adobe
Category: Standards Track                                     June 2022


                               HTTP/1.1

1.  Introduction

   A server MUST respond.

2.  Message

   A client MUST send a request.
`;

const XML_9112 = `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9112">
  <front><title>HTTP/1.1</title><date month="06" year="2022"/></front>
  <middle>
    <section anchor="section-1" pn="section-1">
      <name>Introduction</name>
      <t>A server MUST respond.</t>
    </section>
  </middle>
</rfc>`;

function response(ok: boolean, status: number, body = ''): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve({}),
  } as Response;
}

describe('getParsedRFC', () => {
  beforeEach(() => {
    clearParseCache();
    clearCache();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('shares one fetch + parse among concurrent calls (Issue #15)', async () => {
    const spy = vi
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(response(true, 200, XML_9112)), 5))
      );
    globalThis.fetch = spy;

    const results = await Promise.all([getParsedRFC(9112), getParsedRFC(9112), getParsedRFC(9112)]);

    expect(results[0].source).toBe('xml');
    // 3 本とも同じ解析結果（同じオブジェクト）。解析は 1 回。
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
    // 2 つの XML 取得元に 1 回ずつ。3 本なら 6 回だった。
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('falls back to text when XML fails with 5xx on an RFC >= 8650 (Issue #20)', async () => {
    const spy = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('.txt')) return Promise.resolve(response(true, 200, TEXT_9112));
      return Promise.resolve(response(false, 503));
    });
    globalThis.fetch = spy;

    const result = await getParsedRFC(9112);

    expect(result.source).toBe('text');
    expect(result.xmlFetchError).toContain('503');
    expect(result.data.sections.length).toBeGreaterThan(0);
    // XML 2 本 + テキスト 1 本
    expect(spy.mock.calls.map((c) => String(c[0])).some((u) => u.endsWith('.txt'))).toBe(true);
  });

  it('falls back to text when XML fetch rejects (timeout / DNS) on an RFC >= 8650 (Issue #20)', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('.txt')) return Promise.resolve(response(true, 200, TEXT_9112));
      return Promise.reject(new Error('fetch failed'));
    });

    const result = await getParsedRFC(9112);
    expect(result.source).toBe('text');
    expect(result.xmlFetchError).toContain('fetch failed');
  });

  it('does not try text when every XML source is 404 on an RFC >= 8650 (unpublished)', async () => {
    const spy = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('.txt')) return Promise.resolve(response(true, 200, TEXT_9112));
      return Promise.resolve(response(false, 404));
    });
    globalThis.fetch = spy;

    await expect(getParsedRFC(99999)).rejects.toThrow('No RFC with that number is published');
    expect(spy.mock.calls.map((c) => String(c[0])).some((u) => u.endsWith('.txt'))).toBe(false);
  });

  it('treats a mix of 404 and 5xx as transient, not as not-found', async () => {
    let n = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('.txt')) return Promise.resolve(response(true, 200, TEXT_9112));
      n++;
      return Promise.resolve(response(false, n === 1 ? 404 : 503));
    });

    const result = await getParsedRFC(9112);
    expect(result.source).toBe('text');
    expect(result.xmlFetchError).toBeDefined();
  });

  it('does not cache a transient text fallback, so XML is retried next time', async () => {
    let xmlUp = false;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('.txt')) return Promise.resolve(response(true, 200, TEXT_9112));
      return Promise.resolve(xmlUp ? response(true, 200, XML_9112) : response(false, 502));
    });

    const first = await getParsedRFC(9112);
    expect(first.source).toBe('text');

    xmlUp = true;
    const second = await getParsedRFC(9112);
    expect(second.source).toBe('xml');
    expect(second.xmlFetchError).toBeUndefined();
  });

  it('old RFC with 404 XML uses text without xmlFetchError', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('.txt')) return Promise.resolve(response(true, 200, TEXT_9112));
      return Promise.resolve(response(false, 404));
    });
    const result = await getParsedRFC(6455);
    expect(result.source).toBe('text');
    expect(result.xmlFetchError).toBeUndefined();
  });
});
