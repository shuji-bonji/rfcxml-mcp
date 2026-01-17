/**
 * RFC 取得サービス
 * RFCXML ソースの取得とキャッシュ管理
 */

import type { RFCMetadata } from '../types/index.js';

// キャッシュ（メモリ内）
const xmlCache = new Map<number, string>();
const textCache = new Map<number, string>();
const metadataCache = new Map<number, RFCMetadata>();

/**
 * RFC XML ソースの取得元
 */
const RFC_XML_SOURCES = {
  // RFC Editor 公式
  rfcEditor: (num: number) => `https://www.rfc-editor.org/rfc/rfc${num}.xml`,
  // IETF Tools
  ietfTools: (num: number) => `https://xml2rfc.ietf.org/public/rfc/rfc${num}.xml`,
  // Datatracker
  datatracker: (num: number) => `https://datatracker.ietf.org/doc/rfc${num}/xml/`,
};

/**
 * RFC テキストソースの取得元
 */
const RFC_TEXT_SOURCES = {
  // RFC Editor 公式（テキスト）
  rfcEditor: (num: number) => `https://www.rfc-editor.org/rfc/rfc${num}.txt`,
  // IETF Tools
  ietfTools: (num: number) => `https://tools.ietf.org/rfc/rfc${num}.txt`,
};

/**
 * RFCXML を取得
 */
export async function fetchRFCXML(rfcNumber: number): Promise<string> {
  // キャッシュチェック
  const cached = xmlCache.get(rfcNumber);
  if (cached) {
    return cached;
  }

  // 複数ソースを試行
  const errors: Error[] = [];

  for (const [sourceName, urlFn] of Object.entries(RFC_XML_SOURCES)) {
    try {
      const url = urlFn(rfcNumber);
      const response = await fetch(url, {
        headers: {
          Accept: 'application/xml, text/xml',
          'User-Agent': 'rfcxml-mcp/0.1.0',
        },
      });

      if (response.ok) {
        const xml = await response.text();

        // 基本的な XML 検証
        if (xml.includes('<?xml') || xml.includes('<rfc')) {
          xmlCache.set(rfcNumber, xml);
          console.error(`[RFC ${rfcNumber}] Fetched from ${sourceName}`);
          return xml;
        }
      }
    } catch (error) {
      errors.push(error as Error);
    }
  }

  // すべて失敗した場合
  throw new RFCXMLNotAvailableError(
    rfcNumber,
    errors.map((e) => e.message)
  );
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

  const url = `https://datatracker.ietf.org/api/v1/doc/document/rfc${rfcNumber}/`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'rfcxml-mcp/0.1.0',
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
 * RFC テキストを取得
 */
export async function fetchRFCText(rfcNumber: number): Promise<string> {
  // キャッシュチェック
  const cached = textCache.get(rfcNumber);
  if (cached) {
    return cached;
  }

  // 複数ソースを試行
  const errors: Error[] = [];

  for (const [sourceName, urlFn] of Object.entries(RFC_TEXT_SOURCES)) {
    try {
      const url = urlFn(rfcNumber);
      const response = await fetch(url, {
        headers: {
          Accept: 'text/plain',
          'User-Agent': 'rfcxml-mcp/0.1.0',
        },
      });

      if (response.ok) {
        const text = await response.text();

        // 基本的な検証（RFCテキストの特徴を確認）
        if (text.includes('Request for Comments') || text.includes('RFC ')) {
          textCache.set(rfcNumber, text);
          console.error(`[RFC ${rfcNumber}] Text fetched from ${sourceName}`);
          return text;
        }
      }
    } catch (error) {
      errors.push(error as Error);
    }
  }

  // すべて失敗
  throw new Error(
    `Failed to fetch RFC ${rfcNumber} text from all sources. ` +
      `Errors: ${errors.map((e) => e.message).join(', ')}`
  );
}

/**
 * RFC が XML 形式で利用可能か確認
 * 注: RFC 8650 (2019年12月) 以降は公式に RFCXML v3
 */
export function isRFCXMLAvailable(rfcNumber: number): boolean {
  // RFC 8650 以降は確実に RFCXML v3 が利用可能
  // それ以前は一部のみ利用可能
  return rfcNumber >= 8650;
}

/**
 * RFC XML 取得エラー
 */
export class RFCXMLNotAvailableError extends Error {
  public readonly rfcNumber: number;
  public readonly isOldRFC: boolean;
  public readonly suggestion: string;

  constructor(rfcNumber: number, originalErrors: string[] = []) {
    const isOldRFC = rfcNumber < 8650;
    const suggestion = isOldRFC
      ? `RFC ${rfcNumber} は RFCXML v3 より前の形式で公開されているため、XML が利用できない可能性があります。` +
        `テキスト形式での取得を検討してください（ietf MCP の get_ietf_doc を使用）。`
      : `RFC ${rfcNumber} の XML 取得に失敗しました。ネットワーク接続を確認してください。`;

    super(
      `RFC ${rfcNumber} XML を取得できませんでした。\n` +
        `理由: ${isOldRFC ? '古い RFC (< 8650) のため XML が利用できない可能性があります' : 'ネットワークエラー'}\n` +
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
