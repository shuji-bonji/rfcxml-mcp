/**
 * MCP Tool Definitions
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tools: Tool[] = [
  // ========================================
  // Phase 1: Basic Structure
  // ========================================
  {
    name: 'get_rfc_structure',
    description: 'Get RFC section hierarchy and metadata.',
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
      },
      required: ['rfc'],
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
          description: 'Include RFCs that reference this RFC',
          default: false,
        },
      },
      required: ['rfc'],
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
          description: 'Base section number',
        },
      },
      required: ['rfc', 'section'],
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
    },
  },
  {
    name: 'validate_statement',
    description: 'Validate if a statement complies with RFC requirements.',
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
    },
  },
];
