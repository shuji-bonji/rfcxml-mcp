/**
 * handlers テスト
 * ハンドラーの統合テスト
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleGetRFCStructure,
  handleGetRequirements,
  handleGetDefinitions,
  handleGetDependencies,
  handleGetRelatedSections,
  handleGenerateChecklist,
  handleValidateStatement,
  clearParseCache,
  orderByDocument,
} from './handlers.js';
import { clearCache } from '../services/rfc-fetcher.js';
import type { Author } from '../types/index.js';
import { MATCHING_LIMITS } from '../utils/statement-matcher.js';

// モック用のサンプル XML
const mockRFCXML = `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9999">
  <front><title>Test RFC for Handlers</title><date month="08" year="2022"/></front>
  <middle>
    <section anchor="section-1" pn="section-1">
      <name>Introduction</name>
      <t>The client MUST connect to the server. See Section 2 for details.</t>
    </section>
    <section anchor="section-2" pn="section-2">
      <name>Protocol Details</name>
      <t>The server SHOULD respond quickly.</t>
      <section anchor="section-2.1" pn="section-2.1">
        <name>Request Format</name>
        <t>Requests MAY include optional headers.</t>
      </section>
    </section>
    <section anchor="terminology">
      <name>Terminology</name>
      <dl>
        <dt>Endpoint</dt>
        <dd>A participant in the communication</dd>
      </dl>
    </section>
  </middle>
  <back>
    <references anchor="normative">
      <name>Normative References</name>
      <reference anchor="RFC2119">
        <front><title>Key words</title></front>
        <seriesInfo name="RFC" value="2119"/>
      </reference>
    </references>
  </back>
</rfc>`;

// fetch をモック
const originalFetch = globalThis.fetch;

describe('handleGetRFCStructure', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockRFCXML),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('should return RFC structure with metadata', async () => {
    const result = await handleGetRFCStructure({ rfc: 9999 });

    expect(result.metadata.title).toBe('Test RFC for Handlers');
    expect(result.metadata.number).toBe(9999);
    expect(result._source).toBe('xml');
  });

  it('should return sections without content by default', async () => {
    const result = await handleGetRFCStructure({ rfc: 9999 });

    expect(result.sections.length).toBeGreaterThan(0);
    // content が含まれていないことを確認
    for (const section of result.sections) {
      expect(section.content).toBeUndefined();
    }
  });

  it('should include content when requested', async () => {
    const result = await handleGetRFCStructure({ rfc: 9999, includeContent: true });

    const sectionWithContent = result.sections.find((s: any) => s.content);
    expect(sectionWithContent).toBeDefined();
  });

  it('should include reference counts', async () => {
    const result = await handleGetRFCStructure({ rfc: 9999 });

    expect(result.referenceCount).toBeDefined();
    expect(typeof result.referenceCount.normative).toBe('number');
    expect(typeof result.referenceCount.informative).toBe('number');
  });

  it('enriches metadata from Datatracker API (Phase 2)', async () => {
    // XML body と Datatracker `document` API の両方を返すモック
    clearParseCache();
    clearCache();
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/v1/doc/document/rfc9999/')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              title: 'API Title (should be overridden by XML)',
              std_level: '/api/v1/name/stdlevelname/ps/',
              stream: '/api/v1/name/streamname/ietf/',
              time: '2026-04-01T00:00:00Z',
              abstract: 'From API',
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(mockRFCXML),
      });
    });

    const result = await handleGetRFCStructure({ rfc: 9999 });

    // XML 由来のフィールドは XML 優先
    expect(result.metadata.title).toBe('Test RFC for Handlers');
    expect(result.metadata.number).toBe(9999);
    // API 由来のフィールドが追加されている
    expect(result.metadata.category).toBe('std');
    expect(result.metadata.stream).toBe('IETF');
    // date は本文の front/date（公開日）。Datatracker の time はレコードの
    // 更新時刻なので採らない。
    expect(result.metadata.date).toBe('2022-08');
    expect(result.metadata.date).not.toBe('2026-04-01T00:00:00Z');
    expect(result.metadata.abstract).toBe('From API');
    // includeAuthors を渡していないので authors は不在
    expect(result.metadata.authors).toBeUndefined();
  });

  it('resolves authors when includeAuthors=true (Phase 2)', async () => {
    clearParseCache();
    clearCache();
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/v1/doc/document/rfc9999/')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              title: 'X',
              std_level: '/api/v1/name/stdlevelname/std/',
              stream: '/api/v1/name/streamname/ietf/',
            }),
        });
      }
      if (urlStr.includes('/doc/documentauthor/')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              meta: { total_count: 1 },
              objects: [
                {
                  affiliation: 'Acme',
                  email: '/api/v1/person/email/jane@acme.com/',
                  person: '/api/v1/person/person/42/',
                  order: 1,
                },
              ],
            }),
        });
      }
      if (urlStr.includes('/person/person/42/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 42, name: 'Jane Smith', ascii: 'Jane Smith' }),
        });
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(mockRFCXML),
      });
    });

    const result = await handleGetRFCStructure({ rfc: 9999, includeAuthors: true });
    expect(Array.isArray(result.metadata.authors)).toBe(true);
    expect(result.metadata.authors).toHaveLength(1);
    const author = (
      result.metadata.authors as Array<{ fullname: string; organization: string }>
    )[0];
    expect(author.fullname).toBe('Jane Smith');
    expect(author.organization).toBe('Acme');
  });
});

describe('handleGetRequirements', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockRFCXML),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('should return requirements with statistics', async () => {
    const result = await handleGetRequirements({ rfc: 9999 });

    expect(result.rfc).toBe(9999);
    expect(result.stats.total).toBeGreaterThan(0);
    expect(result.requirements.length).toBe(result.stats.total);
  });

  it('should filter by level', async () => {
    const result = await handleGetRequirements({ rfc: 9999, level: 'MUST' });

    expect(result.filter.level).toBe('MUST');
    for (const req of result.requirements) {
      expect(req.level).toBe('MUST');
    }
  });

  it('should include byLevel statistics', async () => {
    const result = await handleGetRequirements({ rfc: 9999 });

    expect(result.stats.byLevel).toBeDefined();
    expect(typeof result.stats.byLevel).toBe('object');
  });
});

describe('handleGetDefinitions', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockRFCXML),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('should return definitions', async () => {
    const result = await handleGetDefinitions({ rfc: 9999 });

    expect(result.rfc).toBe(9999);
    expect(result.definitions).toBeDefined();
    expect(Array.isArray(result.definitions)).toBe(true);
  });

  it('should filter by term', async () => {
    const result = await handleGetDefinitions({ rfc: 9999, term: 'Endpoint' });

    expect(result.searchTerm).toBe('Endpoint');
    if (result.definitions.length > 0) {
      expect(
        result.definitions.some(
          (d: any) =>
            d.term.toLowerCase().includes('endpoint') ||
            d.definition.toLowerCase().includes('endpoint')
        )
      ).toBe(true);
    }
  });
});

describe('handleGetDependencies', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockRFCXML),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('should return normative and informative references', async () => {
    const result = await handleGetDependencies({ rfc: 9999 });

    expect(result.rfc).toBe(9999);
    expect(Array.isArray(result.normative)).toBe(true);
    expect(Array.isArray(result.informative)).toBe(true);
  });

  it('should include RFC numbers in references', async () => {
    const result = await handleGetDependencies({ rfc: 9999 });

    if (result.normative.length > 0) {
      expect(result.normative[0]).toHaveProperty('rfcNumber');
      expect(result.normative[0]).toHaveProperty('title');
    }
  });

  it('should handle includeReferencedBy flag', async () => {
    // Mock both RFC XML fetch and Datatracker referencedBy API
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('relateddocument')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              meta: { total_count: 1, next: null },
              objects: [
                {
                  source: '/api/v1/doc/document/rfc9876/',
                  target: '/api/v1/doc/document/rfc9999/',
                  relationship: '/api/v1/name/docrelationshipname/refnorm/',
                },
              ],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(mockRFCXML),
      });
    });

    const result = await handleGetDependencies({ rfc: 9999, includeReferencedBy: true });

    expect(result.referencedBy).toBeDefined();
    expect(Array.isArray(result.referencedBy)).toBe(true);
    if (result.referencedBy && result.referencedBy.length > 0) {
      expect(result.referencedBy[0]).toHaveProperty('rfcNumber');
      expect(result.referencedBy[0]).toHaveProperty('relationship');
    }
  });

  it('should report _referencesSource = xml when XML provides references', async () => {
    // mockRFCXML has a normative reference to RFC 2119 — XML path should win.
    const result = await handleGetDependencies({ rfc: 9999 });
    expect(result._source).toBe('xml');
    expect(result._referencesSource).toBe('xml');
  });

  it('falls back to Datatracker API when XML has no references', async () => {
    // 既存テストで rfc 9999 のパース結果がキャッシュされている可能性があるので、
    // キャッシュをクリアして別の RFC 番号で実行する。
    clearParseCache();
    clearCache();

    // XML body without any <references> section -> XML path yields empty refs,
    // so the handler should fetch from the API instead.
    const xmlNoRefs = `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9991">
  <front><title>No Refs RFC</title></front>
  <middle>
    <section anchor="s1"><name>Only section</name><t>The client MUST do X.</t></section>
  </middle>
</rfc>`;

    globalThis.fetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('source__name=rfc9991')) {
        // references API (this RFC's outgoing references)
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              meta: { total_count: 2, next: null },
              objects: [
                {
                  source: '/api/v1/doc/document/rfc9991/',
                  target: '/api/v1/doc/document/rfc8174/',
                  relationship: '/api/v1/name/docrelationshipname/refnorm/',
                },
                {
                  source: '/api/v1/doc/document/rfc9991/',
                  target: '/api/v1/doc/document/rfc7405/',
                  relationship: '/api/v1/name/docrelationshipname/refinfo/',
                },
              ],
            }),
        });
      }
      // RFC body fetch
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(xmlNoRefs),
      });
    });

    const result = await handleGetDependencies({ rfc: 9991 });
    expect(result._source).toBe('xml');
    expect(result._referencesSource).toBe('api');
    expect(result.normative).toHaveLength(1);
    expect(result.normative[0].rfcNumber).toBe(8174);
    expect(result.informative).toHaveLength(1);
    expect(result.informative[0].rfcNumber).toBe(7405);
  });

  it('reports _referencesSource = "text" when text body has refs (v0.5.2 fix)', async () => {
    // v0.5.1 のバグ: text パーサが refs を抽出していても _referencesSource が
    // 'xml' のままになっていた。v0.5.2 では正しく 'text' を返す。
    clearParseCache();
    clearCache();

    // 古い RFC を装うために RFC 番号 < 8650 を使い、XML 取得は失敗させて
    // text フォールバックに落とす。
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('.xml')) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      if (urlStr.includes('.txt')) {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              `

Network Working Group                                          J. Doe
Request for Comments: 2222                                  Test Inc.
Category: Informational                                     April 2026


                          Test Old RFC


Status of This Memo

   This memo provides information for the Internet community.

1.  Introduction

   The client MUST do something.

References

   [RFC2119]  Bradner, S., "Key words for use in RFCs to Indicate
              Requirement Levels", BCP 14, RFC 2119, March 1997.

   [RFC8174]  Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC
              2119 Key Words", BCP 14, RFC 8174, May 2017.
`
            ),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    const result = await handleGetDependencies({ rfc: 2222 });
    expect(result._source).toBe('text');
    // 重要: text パーサが refs を拾えたので 'text' になる ('xml' ではない)
    expect(result._referencesSource).toBe('text');
    // refs がある以上 "not available" 警告は出さない
    expect(result._sourceNote).toBeDefined();
    expect(result._sourceNote).not.toMatch(/not available/);
    expect(result.informative.length + result.normative.length).toBeGreaterThan(0);
  });

  it('emits "not available" only when refs are genuinely empty (v0.5.2 fix)', async () => {
    clearParseCache();
    clearCache();

    // XML 形式で <references> セクションが空のケース。さらに API も 0件を返す。
    // → body も API も refs 0件、_sourceNote が「not available」を含むはず。
    const xmlNoRefs = `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9992">
  <front><title>Empty Refs RFC</title></front>
  <middle>
    <section anchor="s1"><name>Only section</name><t>The client MUST do X.</t></section>
  </middle>
</rfc>`;

    globalThis.fetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('source__name=rfc9992')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ meta: { total_count: 0, next: null }, objects: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(xmlNoRefs),
      });
    });

    const result = await handleGetDependencies({ rfc: 9992 });
    expect(result.normative).toHaveLength(0);
    expect(result.informative).toHaveLength(0);
    // body も API も空 → ソースノートで通知
    expect(result._sourceNote).toBeDefined();
  });
});

describe('handleGetRelatedSections', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockRFCXML),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('should find section by number', async () => {
    const result = await handleGetRelatedSections({ rfc: 9999, section: '1' });

    expect(result.error).toBeUndefined();
    expect(result.section).toBe('1');
    expect(result.title).toBe('Introduction');
  });

  it('should find section by anchor format', async () => {
    const result = await handleGetRelatedSections({ rfc: 9999, section: 'section-1' });

    expect(result.error).toBeUndefined();
    expect(result.title).toBe('Introduction');
  });

  it('should return error for non-existent section', async () => {
    const result = await handleGetRelatedSections({ rfc: 9999, section: '999' });

    expect(result.error).toBeDefined();
    expect(result.error).toContain('not found');
  });

  it('should extract related sections from cross-references', async () => {
    const result = await handleGetRelatedSections({ rfc: 9999, section: '1' });

    expect(result.relatedSections).toBeDefined();
    expect(Array.isArray(result.relatedSections)).toBe(true);
  });
});

describe('handleGenerateChecklist', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockRFCXML),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('should generate markdown checklist', async () => {
    const result = await handleGenerateChecklist({ rfc: 9999 });

    expect(result.rfc).toBe(9999);
    expect(result.markdown).toBeDefined();
    expect(result.markdown).toContain('# RFC 9999');
    expect(result.markdown).toContain('- [ ]');
  });

  it('should include statistics', async () => {
    const result = await handleGenerateChecklist({ rfc: 9999 });

    expect(result.stats).toBeDefined();
    expect(typeof result.stats.must).toBe('number');
    expect(typeof result.stats.should).toBe('number');
    expect(typeof result.stats.may).toBe('number');
    expect(result.stats.total).toBe(result.stats.must + result.stats.should + result.stats.may);
  });

  it('should filter by role', async () => {
    const result = await handleGenerateChecklist({ rfc: 9999, role: 'client' });

    expect(result.role).toBe('client');
  });
});

describe('handleValidateStatement', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockRFCXML),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('should validate statement against requirements', async () => {
    const result = await handleValidateStatement({
      rfc: 9999,
      statement: 'The client must connect to the server',
    });

    expect(result.rfc).toBe(9999);
    expect(result.statement).toBeDefined();
    // isValid は三値。判断できるだけの一致が無ければ null を返す
    expect([true, false, null]).toContain(result.isValid);
    expect(Array.isArray(result.matchingRequirements)).toBe(true);
  });

  it('should return isValid=null when nothing matches', async () => {
    const result = await handleValidateStatement({
      rfc: 9999,
      statement: 'サーバは受信したフレームをそのまま返す',
    });

    // 一致が無いのに「準拠している」と主張してはならない
    expect(result.matchingRequirements).toHaveLength(0);
    expect(result.isValid).toBeNull();
    expect(result._verdictNote).toContain('not a statement of compliance');
  });

  it('should return isValid=null when only the subject matches', async () => {
    // 主語は「誰の話か」しか示さない。何を論じているかを示す語が要る。
    const result = await handleValidateStatement({ rfc: 9999, statement: 'The client' });

    expect(result.isValid).toBeNull();
  });

  it('should return isValid=null when the only matches are weak', async () => {
    const result = await handleValidateStatement({
      rfc: 9999,
      statement: 'data',
    });

    if (result.matchingRequirements.length > 0) {
      const topScore = result.matchingRequirements[0]._matchScore;
      expect(topScore).toBeLessThan(MATCHING_LIMITS.MIN_SCORE_FOR_VERDICT);
    }
    expect(result.isValid).toBeNull();
  });

  it('should find matching requirements', async () => {
    const result = await handleValidateStatement({
      rfc: 9999,
      statement: 'client connect server',
    });

    // "client", "connect", "server" などのキーワードにマッチする要件があるはず
    expect(result.matchingRequirements.length).toBeGreaterThan(0);
  });

  it('should provide suggestions when no matches', async () => {
    const result = await handleValidateStatement({
      rfc: 9999,
      statement: 'xyz123 completely unrelated text',
    });

    if (result.matchingRequirements.length === 0) {
      expect(result.suggestions).toBeDefined();
    }
  });
});

// キャッシュのテスト
describe('RFC caching', () => {
  beforeEach(() => {
    // 既存のキャッシュをクリア
    clearParseCache();
    clearCache();

    // URL によって XML / Datatracker JSON を出し分けるモック。
    // Phase 2 で handleGetRFCStructure が API メタデータも並列取得するように
    // なったため、両方のレスポンスが必要になった。
    globalThis.fetch = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/v1/doc/document/')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              title: 'Test RFC for Handlers',
              std_level: '/api/v1/name/stdlevelname/std/',
              stream: '/api/v1/name/streamname/ietf/',
              time: '2026-01-01T00:00:00Z',
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(mockRFCXML),
      });
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('should cache parsed RFC', async () => {
    // 1回目の呼び出し
    await handleGetRFCStructure({ rfc: 9999 });

    // 並列フェッチで XML 2本 + API メタデータ 1本 = 3 回
    const fetchCountAfterFirst = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    // 2回目の呼び出し（キャッシュから取得されるはず）
    await handleGetRFCStructure({ rfc: 9999 });

    // 2回目の呼び出し後、fetch回数が増えていないことを確認
    expect(globalThis.fetch).toHaveBeenCalledTimes(fetchCountAfterFirst);
  });
});

describe('著者を本文の並びにそろえること', () => {
  const author = (fullname: string): Author => ({ fullname });

  it('顔ぶれが同じなら本文の順に並べ替える', () => {
    const api = [author('Alexey Melnikov'), author('Ian Fette')];

    expect(orderByDocument(api, ['fette', 'melnikov']).map((a) => a.fullname)).toEqual([
      'Ian Fette',
      'Alexey Melnikov',
    ]);
  });

  it('顔ぶれが違えば API の並びをそのまま返す', () => {
    // RFC 2616 は本文が `H. Frystyk`、Datatracker が `Henrik Frystyk Nielsen`。
    const api = [author('Henrik Frystyk Nielsen'), author('Roy T. Fielding')];

    expect(orderByDocument(api, ['fielding', 'frystyk']).map((a) => a.fullname)).toEqual([
      'Henrik Frystyk Nielsen',
      'Roy T. Fielding',
    ]);
  });

  it('件数が違えば並べ替えない', () => {
    const api = [author('Adam Barth')];

    expect(orderByDocument(api, ['barth', 'berkeley']).map((a) => a.fullname)).toEqual([
      'Adam Barth',
    ]);
  });

  it('本文の並びが取れなければ並べ替えない', () => {
    const api = [author('B'), author('A')];

    expect(orderByDocument(api, undefined).map((a) => a.fullname)).toEqual(['B', 'A']);
  });
});
