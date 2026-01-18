/**
 * アプリケーション設定
 * すべての設定値を一箇所で管理
 */

/**
 * パッケージ情報
 */
export const PACKAGE_INFO = {
  name: 'rfcxml-mcp',
  version: '0.1.2',
} as const;

/**
 * HTTP リクエスト設定
 */
export const HTTP_CONFIG = {
  /** User-Agent ヘッダー */
  userAgent: `${PACKAGE_INFO.name}/${PACKAGE_INFO.version}`,
  /** タイムアウト（ミリ秒） */
  timeout: 30000,
  /** リトライ回数 */
  maxRetries: 3,
} as const;

/**
 * キャッシュ設定
 */
export const CACHE_CONFIG = {
  /** XML 生データキャッシュ（小さめ：パース済みがメイン） */
  xml: {
    maxSize: 20,
    name: 'XMLCache',
  },
  /** テキスト生データキャッシュ */
  text: {
    maxSize: 20,
    name: 'TextCache',
  },
  /** メタデータキャッシュ（軽量なので多め） */
  metadata: {
    maxSize: 100,
    name: 'MetadataCache',
  },
  /** パース済み RFC キャッシュ（メインキャッシュ） */
  parsed: {
    maxSize: 50,
    name: 'ParseCache',
  },
} as const;

/**
 * RFC 関連の設定
 */
export const RFC_CONFIG = {
  /**
   * RFCXML v3 が確実に利用可能な最小 RFC 番号
   * RFC 8650 (2019年12月) 以降は公式に RFCXML v3 形式
   */
  xmlAvailableFrom: 8650,
} as const;

/**
 * RFC XML ソースの取得元
 * 優先順位順に定義
 */
export const RFC_XML_SOURCES = {
  /** RFC Editor 公式 */
  rfcEditor: (num: number) => `https://www.rfc-editor.org/rfc/rfc${num}.xml`,
  /** IETF Tools */
  ietfTools: (num: number) => `https://xml2rfc.ietf.org/public/rfc/rfc${num}.xml`,
  /** Datatracker */
  datatracker: (num: number) => `https://datatracker.ietf.org/doc/rfc${num}/xml/`,
} as const;

/**
 * RFC テキストソースの取得元
 * 優先順位順に定義
 */
export const RFC_TEXT_SOURCES = {
  /** RFC Editor 公式（テキスト） */
  rfcEditor: (num: number) => `https://www.rfc-editor.org/rfc/rfc${num}.txt`,
  /** IETF Tools */
  ietfTools: (num: number) => `https://tools.ietf.org/rfc/rfc${num}.txt`,
} as const;

/**
 * IETF Datatracker API
 */
export const DATATRACKER_API = {
  /** RFC ドキュメント情報 */
  document: (num: number) => `https://datatracker.ietf.org/api/v1/doc/document/rfc${num}/`,
} as const;

/**
 * RFC が XML 形式で利用可能か確認
 */
export function isRFCXMLLikelyAvailable(rfcNumber: number): boolean {
  return rfcNumber >= RFC_CONFIG.xmlAvailableFrom;
}
