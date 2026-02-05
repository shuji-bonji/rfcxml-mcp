/**
 * LRUCache Tests
 */

import { describe, it, expect } from 'vitest';
import { LRUCache, DEFAULT_CACHE_OPTIONS } from './cache.js';

describe('LRUCache', () => {
  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      const cache = new LRUCache<string, number>();

      cache.set('a', 1);
      cache.set('b', 2);

      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(2);
    });

    it('should return undefined for non-existent keys', () => {
      const cache = new LRUCache<string, number>();

      expect(cache.get('missing')).toBeUndefined();
    });

    it('should check if key exists with has()', () => {
      const cache = new LRUCache<string, number>();

      cache.set('exists', 1);

      expect(cache.has('exists')).toBe(true);
      expect(cache.has('missing')).toBe(false);
    });

    it('should delete entries', () => {
      const cache = new LRUCache<string, number>();

      cache.set('a', 1);
      expect(cache.has('a')).toBe(true);

      const deleted = cache.delete('a');
      expect(deleted).toBe(true);
      expect(cache.has('a')).toBe(false);

      // Deleting non-existent key returns false
      expect(cache.delete('missing')).toBe(false);
    });

    it('should clear all entries', () => {
      const cache = new LRUCache<string, number>();

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      expect(cache.size).toBe(3);

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.has('a')).toBe(false);
    });

    it('should report correct size', () => {
      const cache = new LRUCache<string, number>();

      expect(cache.size).toBe(0);

      cache.set('a', 1);
      expect(cache.size).toBe(1);

      cache.set('b', 2);
      expect(cache.size).toBe(2);

      cache.delete('a');
      expect(cache.size).toBe(1);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entry when maxSize exceeded', () => {
      const cache = new LRUCache<number, string>({ maxSize: 2 });

      cache.set(1, 'a');
      cache.set(2, 'b');
      cache.set(3, 'c'); // Should evict key 1

      expect(cache.has(1)).toBe(false);
      expect(cache.has(2)).toBe(true);
      expect(cache.has(3)).toBe(true);
      expect(cache.size).toBe(2);
    });

    it('should update access order on get()', () => {
      const cache = new LRUCache<number, string>({ maxSize: 2 });

      cache.set(1, 'a');
      cache.set(2, 'b');
      cache.get(1); // Access key 1, making it most recently used
      cache.set(3, 'c'); // Should evict key 2 (oldest)

      expect(cache.has(1)).toBe(true);
      expect(cache.has(2)).toBe(false);
      expect(cache.has(3)).toBe(true);
    });

    it('should update position when setting existing key', () => {
      const cache = new LRUCache<number, string>({ maxSize: 2 });

      cache.set(1, 'a');
      cache.set(2, 'b');
      cache.set(1, 'a-updated'); // Re-set key 1, making it most recently used
      cache.set(3, 'c'); // Should evict key 2 (oldest)

      expect(cache.has(1)).toBe(true);
      expect(cache.get(1)).toBe('a-updated');
      expect(cache.has(2)).toBe(false);
      expect(cache.has(3)).toBe(true);
    });

    it('should work with maxSize of 1', () => {
      const cache = new LRUCache<string, number>({ maxSize: 1 });

      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);

      cache.set('b', 2);
      expect(cache.has('a')).toBe(false);
      expect(cache.get('b')).toBe(2);
    });
  });

  describe('stats()', () => {
    it('should return correct statistics', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10 });

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      const stats = cache.stats();

      expect(stats.size).toBe(3);
      expect(stats.maxSize).toBe(10);
      expect(stats.keys).toEqual(['a', 'b', 'c']);
    });

    it('should return empty keys array for empty cache', () => {
      const cache = new LRUCache<string, number>();

      const stats = cache.stats();

      expect(stats.size).toBe(0);
      expect(stats.keys).toEqual([]);
    });
  });

  describe('constructor options', () => {
    it('should use default maxSize of 50', () => {
      const cache = new LRUCache<number, string>();

      const stats = cache.stats();
      expect(stats.maxSize).toBe(50);
    });

    it('should accept custom maxSize', () => {
      const cache = new LRUCache<number, string>({ maxSize: 100 });

      const stats = cache.stats();
      expect(stats.maxSize).toBe(100);
    });

    it('should work with different key/value types', () => {
      // Number keys
      const numCache = new LRUCache<number, string>();
      numCache.set(1, 'one');
      expect(numCache.get(1)).toBe('one');

      // Object values
      interface User {
        name: string;
      }
      const objCache = new LRUCache<string, User>();
      objCache.set('user1', { name: 'Alice' });
      expect(objCache.get('user1')).toEqual({ name: 'Alice' });
    });
  });

  describe('DEFAULT_CACHE_OPTIONS', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_CACHE_OPTIONS).toEqual({
        maxSize: 50,
        debug: false,
        name: 'RFCCache',
      });
    });
  });
});
