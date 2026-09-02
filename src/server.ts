/**
 * RFCXML MCP Server の組み立て
 *
 * MCP SDK v2 では stdio の起動が `serveStdio(factory)` になり、接続ごとに
 * factory から 1 インスタンスが作られる。そのためサーバ生成をこの
 * `buildServer()` に切り出し、`index.ts` は起動だけを担う。
 * テストからは `InMemoryTransport` でこの同じ関数を叩ける。
 */

import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';

import { tools } from './tools/definitions.js';
import { toolHandlers } from './tools/handlers.js';
import {
  RFCXML_SCHEMA_METADATA,
  RFCXML_SCHEMA_PAYLOAD,
  RFCXML_SCHEMA_URI,
} from './resources/definitions.js';
import { PACKAGE_INFO } from './config.js';

/**
 * `initialize` の応答としてクライアントへ返す説明。
 *
 * README やツール説明より早く、ツールを 1 つも呼ばないうちに読まれる。
 * 潰したい誤解は 2 つある。
 *
 * 1. このサーバが「適合判定器」だと読まれること。
 *    `validate_statement` は RFC 本文中の BCP 14 キーワードと文を突き合わせるだけで、
 *    実装が適合しているかどうかの判定は返さない。`isValid` が三値であること
 *    （null = 判断できるだけの一致が無い）もここで宣言する。
 * 2. 空の結果が「そのような規定は存在しない」と読まれること。
 *    RFC 8650 より前の RFC には公式 XML がなくテキストにフォールバックするため、
 *    取得できる範囲がツールごとに変わる。
 *
 * 文面を薄める前に、この 2 つが別の場所で言えているかを確認すること。
 */
const INSTRUCTIONS = `This server is a structured READER of published RFCs. It is not a conformance judge and not a web search.

It does NOT do the following:
- It does not decide whether an implementation conforms to an RFC. \`validate_statement\` matches a sentence against the BCP 14 keywords found in the RFC text and returns the matched requirements; the verdict is yours. Its \`isValid\` is three-valued: \`null\` means no requirement matched strongly enough to judge, and \`true\` means only that no contradiction was detected among the matches — neither is a statement of compliance.
- It does not cover Internet-Drafts or non-RFC documents. Only published RFCs are reachable.
- It does not fetch arbitrary URLs. Sources are fixed to rfc-editor.org and the IETF Datatracker API.

For keyword search across IETF documents and for Internet-Drafts, use the ietf MCP server (\`search_ietf_rfc_by_keyword\`, \`get_ietf_doc\`, \`list_ietf_docs_number\`).

An empty result means "this RFC's text did not yield a match in the requested scope", NOT "no such requirement exists". In particular:
- RFCs numbered below 8650 usually have no official RFCXML. The text parser is used instead: \`get_related_sections\` is limited, and \`get_rfc_dependencies\` may return placeholder titles/anchors. Every result carries \`_source\` and, where relevant, \`_sourceNote\` — read them before concluding.
- Requirement extraction is keyword-based (RFC 2119 / RFC 8174). A requirement written without those keywords is not reported.
- Matching is English keyword based. \`validate_statement\` will not match a statement written in another language; phrase it in the RFC's own wording.

Costly options: \`includeAuthors=true\` on \`get_rfc_structure\` adds 1+N Datatracker requests, and \`includeContent=true\` returns the full section bodies.`;

/**
 * MCP サーバを 1 つ組み立てて返す。
 *
 * ツールは `definitions.ts`（入力スキーマ）と `handlers.ts`（実装）の対応表から
 * 一括登録する。新しいツールを足すときに触るのはこの 2 ファイルだけで、
 * この関数は変更しなくてよい。
 */
export function buildServer(): McpServer {
  const server = new McpServer(
    {
      name: PACKAGE_INFO.name,
      version: PACKAGE_INFO.version,
    },
    { instructions: INSTRUCTIONS }
  );

  for (const tool of tools) {
    const handler = toolHandlers[tool.name];
    if (!handler) {
      // 定義と実装の対応漏れ。起動時に落として気づけるようにする。
      throw new Error(`No handler registered for tool: ${tool.name}`);
    }

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        // definitions.ts は JSON Schema をそのまま持つ。v2 は Standard Schema を
        // 要求するため fromJsonSchema で包む（zod への書き換えは不要）。
        inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema),
      },
      async (args) => {
        try {
          const result = await handler(args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: message }, null, 2) }],
            isError: true,
          };
        }
      }
    );
  }

  server.registerResource(
    'rfcxml-schema',
    RFCXML_SCHEMA_URI,
    RFCXML_SCHEMA_METADATA,
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: RFCXML_SCHEMA_METADATA.mimeType,
          text: JSON.stringify(RFCXML_SCHEMA_PAYLOAD, null, 2),
        },
      ],
    })
  );

  return server;
}
