#!/usr/bin/env node

/**
 * RFCXML MCP Server
 * RFC 文書を構造的に理解するための MCP サーバー
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { tools } from './tools/definitions.js';
import { toolHandlers } from './tools/handlers.js';

// サーバーインスタンス
const server = new Server(
  {
    name: 'rfcxml-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// ツール一覧
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// ツール実行
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const handler = toolHandlers[name];
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }

    const result = await handler(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
});

// リソース一覧（RFC スキーマ）
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'rfcxml://schema',
        name: 'RFCXML Schema Information',
        description: 'RFCXML v3 の構造とスキーマ情報',
        mimeType: 'application/json',
      },
    ],
  };
});

// リソース読み取り
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'rfcxml://schema') {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              version: 'v3',
              spec: 'RFC 7991 (superseded by rfc7991bis)',
              documentation: 'https://authors.ietf.org/rfcxml-vocabulary',
              keyElements: {
                bcp14: 'RFC 2119 キーワード（MUST, SHOULD, MAY 等）をマークアップ',
                xref: '内部・外部参照',
                reference: '参考文献',
                section: 'セクション構造',
                t: 'テキストパラグラフ',
                dl: '定義リスト',
                sourcecode: 'ソースコード',
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

// サーバー起動
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('RFCXML MCP Server started');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
