/**
 * RFC 取得サービス
 * RFCXML ソースの取得とキャッシュ管理
 */

import type { RFCMetadata } from '../types/index.js';
import { LRUCache } from '../utils/cache.js';
import { fetchFromMultipleSources } from '../utils/fetch.js';
import {
  CACHE_CONFIG,
  RFC_XML_SOURCES,
  RFC_TEXT_SOURCES,
  DATATRACKER_API,
  HTTP_CONFIG,
  RFC_CONFIG,
} from '../config.js';

// LRU キャッシュ（設定は config.ts から）
const xmlCache = new LRUCache<number, string>(CACHE_CONFIG.xml);
const textCache = new LRUCache<number, string>(CACHE_CONFIG.text);
const metadataCache = new LRUCache<number, RFCMetadata>(CACHE_CONFIG.metadata);

/**
 * RFCXML を取得（並列フェッチ）
 * 複数ソースに同時リクエストし、最初に成功したものを返す
 */
export async function fetchRFCXML(rfcNumber: number): Promise<string> {
  // キャッシュチェック
  const cached = xmlCache.get(rfcNumber);
  if (cached) {
    return cached;
  }

  // ソースリストを作成
  const sources = Object.entries(RFC_XML_SOURCES).map(([name, urlFn]) => ({
    name,
    url: urlFn(rfcNumber),
  }));

  try {
    // 並列フェッチ（最初に成功したものを返す）
    const { text: xml, source } = await fetchFromMultipleSources(sources, {
      headers: { Accept: 'application/xml, text/xml' },
      validate: (text) => text.includes('<?xml') || text.includes('<rfc'),
    });

    xmlCache.set(rfcNumber, xml);
    console.error(`[RFC ${rfcNumber}] Fetched from ${source}`);
    return xml;
  } catch (error) {
    // すべて失敗した場合
    throw new RFCXMLNotAvailableError(rfcNumber, [
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

/**
 * RFC メタデータを取得（IETF Datatracker API）
 */
export async function fetchRFCMetadata(rfcNumber: number): Promise<RFCMetadata> {
  // キャッシュチェック
  const cached = metadataCache.get(rfcNumber);
  if (cached) {
    return cached;
  }

  const url = DATATRACKER_API.document(rfcNumber);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': HTTP_CONFIG.userAgent,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      title?: string;
      time?: string;
      std_level?: string;
      stream?: string;
      abstract?: string;
    };

    const metadata: RFCMetadata = {
      number: rfcNumber,
      title: data.title || `RFC ${rfcNumber}`,
      authors: [], // TODO: 別 API から取得
      date: data.time || '',
      category: mapCategory(data.std_level ?? null),
      stream: mapStream(data.stream ?? null),
      abstract: data.abstract || undefined,
    };

    metadataCache.set(rfcNumber, metadata);
    return metadata;
  } catch (_error) {
    // フォールバック: 最小限のメタデータ
    return {
      number: rfcNumber,
      title: `RFC ${rfcNumber}`,
      authors: [],
      date: '',
      category: 'info',
      stream: 'IETF',
    };
  }
}

/**
 * RFC テキストを取得（並列フェッチ）
 * 複数ソースに同時リクエストし、最初に成功したものを返す
 */
export async function fetchRFCText(rfcNumber: number): Promise<string> {
  // キャッシュチェック
  const cached = textCache.get(rfcNumber);
  if (cached) {
    return cached;
  }

  // ソースリストを作成
  const sources = Object.entries(RFC_TEXT_SOURCES).map(([name, urlFn]) => ({
    name,
    url: urlFn(rfcNumber),
  }));

  try {
    // 並列フェッチ（最初に成功したものを返す）
    const { text, source } = await fetchFromMultipleSources(sources, {
      headers: { Accept: 'text/plain' },
      validate: (t) => t.includes('Request for Comments') || t.includes('RFC '),
    });

    textCache.set(rfcNumber, text);
    console.error(`[RFC ${rfcNumber}] Text fetched from ${source}`);
    return text;
  } catch (error) {
    // すべて失敗
    throw new Error(
      `Failed to fetch RFC ${rfcNumber} text from all sources. ` +
        `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * RFC が XML 形式で利用可能か確認
 * 注: RFC 8650 (2019年12月) 以降は公式に RFCXML v3
 */
export function isRFCXMLAvailable(rfcNumber: number): boolean {
  return rfcNumber >= RFC_CONFIG.xmlAvailableFrom;
}

/**
 * RFC XML 取得エラー
 */
export class RFCXMLNotAvailableError extends Error {
  public readonly rfcNumber: number;
  public readonly isOldRFC: boolean;
  public readonly suggestion: string;

  constructor(rfcNumber: number, originalErrors: string[] = []) {
    const threshold = RFC_CONFIG.xmlAvailableFrom;
    const isOldRFC = rfcNumber < threshold;
    const suggestion = isOldRFC
      ? `RFC ${rfcNumber} は RFCXML v3 より前の形式で公開されているため、XML が利用できない可能性があります。` +
        `テキスト形式での取得を検討してください（ietf MCP の get_ietf_doc を使用）。`
      : `RFC ${rfcNumber} の XML 取得に失敗しました。ネットワーク接続を確認してください。`;

    super(
      `RFC ${rfcNumber} XML を取得できませんでした。\n` +
        `理由: ${isOldRFC ? `古い RFC (< ${threshold}) のため XML が利用できない可能性があります` : 'ネットワークエラー'}\n` +
        `提案: ${suggestion}` +
        (originalErrors.length > 0 ? `\n詳細: ${originalErrors.join(', ')}` : '')
    );

    this.name = 'RFCXMLNotAvailableError';
    this.rfcNumber = rfcNumber;
    this.isOldRFC = isOldRFC;
    this.suggestion = suggestion;
  }
}

/**
 * キャッシュクリア
 */
export function clearCache(): void {
  xmlCache.clear();
  textCache.clear();
  metadataCache.clear();
}

// ヘルパー関数

function mapCategory(stdLevel: string | null): RFCMetadata['category'] {
  switch (stdLevel?.toLowerCase()) {
    case 'proposed standard':
    case 'draft standard':
    case 'internet standard':
      return 'std';
    case 'best current practice':
      return 'bcp';
    case 'experimental':
      return 'exp';
    case 'historic':
      return 'historic';
    default:
      return 'info';
  }
}

function mapStream(stream: string | null): RFCMetadata['stream'] {
  switch (stream?.toLowerCase()) {
    case 'ietf':
      return 'IETF';
    case 'iab':
      return 'IAB';
    case 'irtf':
      return 'IRTF';
    case 'ise':
      return 'independent';
    default:
      return 'IETF';
  }
}
