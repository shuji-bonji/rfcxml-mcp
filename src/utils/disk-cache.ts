/**
 * Disk-backed RFCXML cache.
 *
 * Phase 3 component: provides a persistent layer in front of the in-memory
 * `xmlCache` so that pre-fetched RFCs survive across MCP server restarts.
 * The MCP runtime uses it as a read-through cache; the prefetch CLI uses it
 * as a write-only sink.
 *
 * File layout (under `dir`):
 *   ./rfc{N}.xml   — raw RFCXML body, UTF-8
 *
 * Intentionally minimal: no metadata, no eviction, no checksums. We trust the
 * filesystem and the source URL. If staleness becomes a concern, the operator
 * can `rm -rf` the directory and re-prefetch.
 *
 * Activation: opt-in. Construct via `DiskCache.fromEnv()` to honor the
 * `RFCXML_CACHE_DIR` environment variable; returns null when the variable is
 * unset/empty so callers can no-op cleanly.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

export class DiskCache {
  /**
   * @param dir Absolute or relative directory path. Created lazily on first
   * `set` — readers tolerate non-existent dirs by returning null.
   */
  constructor(public readonly dir: string) {}

  /**
   * Construct a DiskCache from the `RFCXML_CACHE_DIR` environment variable.
   * Returns null when the var is unset/empty so the caller can keep the
   * disk-cache code path optional without conditionals at every call site.
   *
   * The cache is rooted at `<RFCXML_CACHE_DIR>/xml/` to leave room for
   * sibling subdirectories (e.g., text, metadata) in the future without
   * mixing files.
   */
  static fromEnv(): DiskCache | null {
    const raw = process.env.RFCXML_CACHE_DIR?.trim();
    if (!raw) return null;
    return new DiskCache(path.join(raw, 'xml'));
  }

  /**
   * Compute the on-disk filepath for a given RFC number. Public so the CLI
   * and tests can sanity-check.
   */
  filepath(rfcNumber: number): string {
    return path.join(this.dir, `rfc${rfcNumber}.xml`);
  }

  async has(rfcNumber: number): Promise<boolean> {
    try {
      await fs.access(this.filepath(rfcNumber));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read the cached RFCXML, or return null on miss / read error.
   * Read errors are logged but never thrown — the disk cache is best-effort.
   */
  async get(rfcNumber: number): Promise<string | null> {
    try {
      return await fs.readFile(this.filepath(rfcNumber), 'utf-8');
    } catch (error) {
      // ENOENT is the common case (cache miss) — don't log.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(
          `DiskCache`,
          `read rfc${rfcNumber} failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      return null;
    }
  }

  /**
   * Write the RFCXML to disk. Creates the directory tree on first call.
   * Write errors are logged but never thrown — the disk cache is best-effort
   * and a write failure (e.g., disk full, permission denied) must not break
   * the runtime fetch path.
   */
  async set(rfcNumber: number, xml: string): Promise<void> {
    try {
      await fs.mkdir(this.dir, { recursive: true });
      await fs.writeFile(this.filepath(rfcNumber), xml, 'utf-8');
    } catch (error) {
      logger.warn(
        `DiskCache`,
        `write rfc${rfcNumber} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
