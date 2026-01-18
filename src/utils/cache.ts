/**
 * LRUキャッシュ
 * サイズ制限付きのLeast Recently Used キャッシュ実装
 */

export interface CacheOptions {
  /** 最大エントリ数（デフォルト: 50） */
  maxSize?: number;
  /** デバッグログ出力（デフォルト: false） */
  debug?: boolean;
  /** キャッシュ名（デバッグ用） */
  name?: string;
}

/**
 * LRUキャッシュクラス
 * 最も古くアクセスされたエントリから削除される
 */
export class LRUCache<K, V> {
  private cache: Map<K, V>;
  private readonly maxSize: number;
  private readonly debug: boolean;
  private readonly name: string;

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize ?? 50;
    this.debug = options.debug ?? false;
    this.name = options.name ?? 'LRUCache';
    this.cache = new Map();
  }

  /**
   * キャッシュから値を取得
   * アクセスされたエントリは最新としてマーク
   */
  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined;
    }

    // アクセスされたエントリを最新に移動（Map の順序を利用）
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);

    if (this.debug) {
      console.error(`[${this.name}] Cache hit: ${String(key)}`);
    }

    return value;
  }

  /**
   * キャッシュに値を設定
   * maxSize を超える場合は最も古いエントリを削除
   */
  set(key: K, value: V): void {
    // 既存エントリがあれば削除（順序を更新するため）
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // maxSize を超える場合、最も古いエントリを削除
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        if (this.debug) {
          console.error(`[${this.name}] Evicted: ${String(oldestKey)}`);
        }
      }
    }

    this.cache.set(key, value);

    if (this.debug) {
      console.error(`[${this.name}] Set: ${String(key)} (size: ${this.cache.size})`);
    }
  }

  /**
   * キーが存在するか確認
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * 特定のエントリを削除
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * キャッシュをクリア
   */
  clear(): void {
    this.cache.clear();
    if (this.debug) {
      console.error(`[${this.name}] Cleared`);
    }
  }

  /**
   * 現在のキャッシュサイズ
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * キャッシュの統計情報
   */
  stats(): { size: number; maxSize: number; keys: K[] } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      keys: Array.from(this.cache.keys()),
    };
  }
}

/**
 * デフォルトのキャッシュ設定
 */
export const DEFAULT_CACHE_OPTIONS: Required<CacheOptions> = {
  maxSize: 50,
  debug: false,
  name: 'RFCCache',
};
