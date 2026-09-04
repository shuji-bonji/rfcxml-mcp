/**
 * logger のユニットテスト（Issue #19）
 *
 * stdio トランスポートでは stdout が JSON-RPC の線なので、どのレベルも
 * stdout に書いてはならない。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger } from './logger.js';
import { HTTP_CONFIG } from '../config.js';

describe('logger', () => {
  const originalDebug = process.env.DEBUG;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalDebug === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = originalDebug;
  });

  it('debug writes to stderr (console.error), never stdout', () => {
    process.env.DEBUG = '1';
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    const dbg = vi.spyOn(console, 'debug').mockImplementation(() => {});

    logger.debug('ctx', 'hello');

    expect(err).toHaveBeenCalledWith('[ctx] hello');
    expect(out).not.toHaveBeenCalled();
    expect(dbg).not.toHaveBeenCalled();
  });

  it('debug is silent without DEBUG', () => {
    delete process.env.DEBUG;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.debug('ctx', 'hello');
    expect(err).not.toHaveBeenCalled();
  });
});

describe('HTTP_CONFIG', () => {
  it('has no unused maxRetries (retry is not implemented)', () => {
    expect('maxRetries' in HTTP_CONFIG).toBe(false);
  });
});
