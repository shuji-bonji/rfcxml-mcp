/**
 * 並列フェッチユーティリティ
 * 複数ソースから最速で成功したレスポンスを返す
 */

import { HTTP_CONFIG } from '../config.js';

export interface FetchSource {
  name: string;
  url: string;
}

export interface ParallelFetchOptions {
  /** リクエストヘッダー */
  headers?: Record<string, string>;
  /** タイムアウト（ミリ秒） */
  timeout?: number;
  /** レスポンス検証関数 */
  validate?: (text: string) => boolean;
}

export interface ParallelFetchResult {
  /** 取得したテキスト */
  text: string;
  /** 成功したソース名 */
  source: string;
}

/**
 * 複数ソースから並列でフェッチし、最初に成功したものを返す
 * 成功後は他のリクエストをキャンセル
 */
export async function fetchFromMultipleSources(
  sources: FetchSource[],
  options: ParallelFetchOptions = {}
): Promise<ParallelFetchResult> {
  const { headers = {}, timeout = HTTP_CONFIG.timeout, validate = () => true } = options;

  // 全リクエストをキャンセルするための AbortController
  const controller = new AbortController();
  const { signal } = controller;

  // 各ソースのフェッチを Promise に変換
  const fetchPromises = sources.map(async ({ name, url }) => {
    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': HTTP_CONFIG.userAgent,
          ...headers,
        },
        signal,
        timeout,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();

      // バリデーション
      if (!validate(text)) {
        throw new Error('Validation failed');
      }

      return { text, source: name };
    } catch (error) {
      // AbortError は無視（他のソースが成功したため）
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      // それ以外のエラーは詳細を付けて再スロー
      throw new Error(`[${name}] ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  try {
    // Promise.any: 最初に成功したものを返す
    const result = await Promise.any(fetchPromises);

    // 成功したら他のリクエストをキャンセル
    controller.abort();

    return result;
  } catch (error) {
    // すべて失敗した場合
    controller.abort();

    if (error instanceof AggregateError) {
      const messages = error.errors.map((e: Error) => e.message).join('; ');
      throw new Error(`All sources failed: ${messages}`);
    }
    throw error;
  }
}

/**
 * タイムアウト付きフェッチ
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number }
): Promise<Response> {
  const { timeout = HTTP_CONFIG.timeout, ...fetchOptions } = options;

  // タイムアウト用の AbortController
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeout);

  // 外部からの signal と タイムアウト signal を組み合わせる
  const combinedSignal = options.signal
    ? combineAbortSignals(options.signal, timeoutController.signal)
    : timeoutController.signal;

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: combinedSignal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 複数の AbortSignal を組み合わせる
 * どちらかが abort されたら結合シグナルも abort
 */
function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }

  return controller.signal;
}
