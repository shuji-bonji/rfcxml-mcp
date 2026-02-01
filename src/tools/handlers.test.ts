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
} from './handlers.js';
import { clearCache } from '../services/rfc-fetcher.js';

// モック用のサンプル XML
const mockRFCXML = `<?xml version="1.0" encoding="UTF-8"?>
<rfc number="9999">
  <front><title>Test RFC for Handlers</title></front>
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
    const result = await handleGetDependencies({ rfc: 9999, includeReferencedBy: true });

    expect(result.referencedBy).toBeDefined();
    expect(result._note).toContain('not implemented');
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
    expect(typeof result.isValid).toBe('boolean');
    expect(Array.isArray(result.matchingRequirements)).toBe(true);
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

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockRFCXML),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('should cache parsed RFC', async () => {
    // 1回目の呼び出し
    await handleGetRFCStructure({ rfc: 9999 });

    // 並列フェッチで3つのソースにリクエストされる
    const fetchCountAfterFirst = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    // 2回目の呼び出し（キャッシュから取得されるはず）
    await handleGetRFCStructure({ rfc: 9999 });

    // 2回目の呼び出し後、fetch回数が増えていないことを確認
    expect(globalThis.fetch).toHaveBeenCalledTimes(fetchCountAfterFirst);
  });
});
