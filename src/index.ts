#!/usr/bin/env node

/**
 * RFCXML MCP Server
 * MCP server for structural understanding of RFC documents
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
import { PACKAGE_INFO } from './config.js';

// Server instance
const server = new Server(
  {
    name: PACKAGE_INFO.name,
    version: PACKAGE_INFO.version,
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Execute tool
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

// List resources (RFC schema)
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'rfcxml://schema',
        name: 'RFCXML Schema Information',
        description: 'RFCXML v3 structure and schema information',
        mimeType: 'application/json',
      },
    ],
  };
});

// Read resource
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
                bcp14: 'Markup for RFC 2119 keywords (MUST, SHOULD, MAY, etc.)',
                xref: 'Internal and external references',
                reference: 'Bibliography references',
                section: 'Section structure',
                t: 'Text paragraph',
                dl: 'Definition list',
                sourcecode: 'Source code',
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

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('RFCXML MCP Server started');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
