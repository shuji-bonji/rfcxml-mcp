#!/usr/bin/env node

/**
 * RFCXML MCP Server — エントリポイント
 *
 * MCP SDK v2 の `serveStdio` は接続の開始時にプロトコル era を確定し、
 * factory から作った 1 インスタンスをその接続に固定する。
 * サーバの組み立ては `server.ts` の `buildServer()` にある。
 */

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { buildServer } from './server.js';
import { logger } from './utils/logger.js';

serveStdio(() => buildServer(), {
  onerror: (error) => {
    logger.error('Server', error.message, error);
  },
});

logger.info('Server', 'RFCXML MCP Server started');
