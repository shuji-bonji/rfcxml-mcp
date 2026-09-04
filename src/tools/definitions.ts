/**
 * MCP Tool Definitions
 */
import type { JsonSchemaType, Tool } from '@modelcontextprotocol/server';

/**
 * ツール定義。
 *
 * `Tool['inputSchema']` は wire 上の緩い JSON 値型のため、`fromJsonSchema()` が
 * 受け取る `JsonSchemaType` にそのままは渡せない。ここで inputSchema だけを
 * 差し替えて、`server.ts` 側でのキャストを不要にする。
 */
export type ToolDefinition = Omit<Tool, 'inputSchema'> & {
  inputSchema: JsonSchemaType;
};

/**
 * すべてのツールは `additionalProperties: false` を持つ。
 *
 * 無いと、`get_requirements { rfc: 9110, sections: ["3.5"] }`（正しくは
 * `section`）のような打ち間違いが受け取られ、無視され、全件が返る。
 * クライアントは「`sections` が効いている」と読む（Issue #21）。
 * 未知のキーは SDK の入力検証で `isError: true` になる。
 */
export const tools: ToolDefinition[] = [
  // ========================================
  // Phase 1: Basic Structure
  // ========================================
  {
    name: 'get_rfc_structure',
    description:
      'Get RFC section hierarchy and metadata. Metadata is enriched from the IETF Datatracker API (category, stream, publication date, abstract). Pass includeAuthors=true to also resolve author names (incurs extra API calls).',
    inputSchema: {
      type: 'object',
      properties: {
        rfc: {
          type: 'number',
          description: 'RFC number (e.g., 6455)',
        },
        includeContent: {
          type: 'boolean',
          description: 'Include section content (default: false)',
          default: false,
        },
        includeAuthors: {
          type: 'boolean',
          description:
            'Resolve author fullnames via Datatracker `documentauthor` + `person` API (default: false). Adds 1+N extra HTTP requests but results are cached.',
          default: false,
        },
      },
      required: ['rfc'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_requirements',
    description: 'Extract normative requirements (MUST/SHOULD/MAY) from RFC in structured format.',
    inputSchema: {
      type: 'object',
      properties: {
        rfc: {
          type: 'number',
          description: 'RFC number',
        },
        section: {
          type: 'string',
          description: 'Filter by section number (e.g., "5.5.1")',
        },
        level: {
          type: 'string',
          enum: [
            'MUST',
            'MUST NOT',
            'REQUIRED',
            'SHALL',
            'SHALL NOT',
            'SHOULD',
            'SHOULD NOT',
            'RECOMMENDED',
            'NOT RECOMMENDED',
            'MAY',
            'OPTIONAL',
          ],
          description: 'Filter by requirement level',
        },
      },
      required: ['rfc'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_definitions',
    description: 'Get term definitions from RFC.',
    inputSchema: {
      type: 'object',
      properties: {
        rfc: {
          type: 'number',
          description: 'RFC number',
        },
        term: {
          type: 'string',
          description: 'Search for specific term',
        },
      },
      required: ['rfc'],
      additionalProperties: false,
    },
  },

  // ========================================
  // Phase 2: Relationships
  // ========================================
  {
    name: 'get_rfc_dependencies',
    description: 'Get RFC reference relationships (normative/informative).',
    inputSchema: {
      type: 'object',
      properties: {
        rfc: {
          type: 'number',
          description: 'RFC number',
        },
        includeReferencedBy: {
          type: 'boolean',
          description: 'Include RFCs that reference this RFC (fetched from IETF Datatracker API)',
          default: false,
        },
      },
      required: ['rfc'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_related_sections',
    description: 'Get sections related to the specified section.',
    inputSchema: {
      type: 'object',
      properties: {
        rfc: {
          type: 'number',
          description: 'RFC number',
        },
        section: {
          type: 'string',
          minLength: 1,
          description: 'Base section number (e.g., "3.5" or "A.2")',
        },
      },
      required: ['rfc', 'section'],
      additionalProperties: false,
    },
  },

  // ========================================
  // Phase 3: Validation Support
  // ========================================
  {
    name: 'generate_checklist',
    description: 'Generate RFC implementation checklist in Markdown format.',
    inputSchema: {
      type: 'object',
      properties: {
        rfc: {
          type: 'number',
          description: 'RFC number',
        },
        role: {
          type: 'string',
          enum: ['client', 'server', 'both'],
          description: 'Implementation role (client/server/both)',
          default: 'both',
        },
        sections: {
          type: 'array',
          items: { type: 'string' },
          description: 'Sections to include (all if omitted)',
        },
        includeSubsections: {
          type: 'boolean',
          description: 'Include subsections when filtering by sections (default: true)',
          default: true,
        },
      },
      required: ['rfc'],
      additionalProperties: false,
    },
  },
  {
    name: 'validate_statement',
    description:
      "Find the RFC requirements that bear on a statement, and report detected contradictions. This does NOT decide conformance: `isValid` is three-valued (`null` = nothing matched strongly enough to judge, `false` = a contradiction was detected, `true` = none was detected among the matches). Matching is English keyword based; write the statement in the RFC's own wording.",
    inputSchema: {
      type: 'object',
      properties: {
        rfc: {
          type: 'number',
          description: 'RFC number',
        },
        statement: {
          type: 'string',
          description: 'Description of implementation or behavior to validate',
        },
      },
      required: ['rfc', 'statement'],
      additionalProperties: false,
    },
  },
];
