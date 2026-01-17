/**
 * MCP ツール定義
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tools: Tool[] = [
  // ========================================
  // Phase 1: 基本構造
  // ========================================
  {
    name: 'get_rfc_structure',
    description: 'RFC のセクション階層とメタデータを取得します。',
    inputSchema: {
      type: 'object',
      properties: {
        rfc: {
          type: 'number',
          description: 'RFC 番号（例: 6455）',
        },
        includeContent: {
          type: 'boolean',
          description: 'セクションの内容も含めるか（デフォルト: false）',
          default: false,
        },
      },
      required: ['rfc'],
    },
  },
  {
    name: 'get_requirements',
    description: 'RFC から規範性要件（MUST/SHOULD/MAY等）を構造化して抽出します。',
    inputSchema: {
      type: 'object',
      properties: {
        rfc: {
          type: 'number',
          description: 'RFC 番号',
        },
        section: {
          type: 'string',
          description: 'セクション番号でフィルタ（例: "5.5.1"）',
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
          description: '要件レベルでフィルタ',
        },
      },
      required: ['rfc'],
    },
  },
  {
    name: 'get_definitions',
    description: 'RFC 内の用語定義を取得します。',
    inputSchema: {
      type: 'object',
      properties: {
        rfc: {
          type: 'number',
          description: 'RFC 番号',
        },
        term: {
          type: 'string',
          description: '特定の用語で検索',
        },
      },
      required: ['rfc'],
    },
  },

  // ========================================
  // Phase 2: 関係性
  // ========================================
  {
    name: 'get_rfc_dependencies',
    description: 'RFC の参照関係（normative/informative）を取得します。',
    inputSchema: {
      type: 'object',
      properties: {
        rfc: {
          type: 'number',
          description: 'RFC 番号',
        },
        includeReferencedBy: {
          type: 'boolean',
          description: 'この RFC を参照している RFC も含めるか',
          default: false,
        },
      },
      required: ['rfc'],
    },
  },
  {
    name: 'get_related_sections',
    description: '指定セクションに関連する他のセクションを取得します。',
    inputSchema: {
      type: 'object',
      properties: {
        rfc: {
          type: 'number',
          description: 'RFC 番号',
        },
        section: {
          type: 'string',
          description: '基準となるセクション番号',
        },
      },
      required: ['rfc', 'section'],
    },
  },

  // ========================================
  // Phase 3: 検証支援
  // ========================================
  {
    name: 'generate_checklist',
    description: 'RFC の実装チェックリストを Markdown 形式で生成します。',
    inputSchema: {
      type: 'object',
      properties: {
        rfc: {
          type: 'number',
          description: 'RFC 番号',
        },
        role: {
          type: 'string',
          enum: ['client', 'server', 'both'],
          description: '実装の役割（クライアント/サーバー/両方）',
          default: 'both',
        },
        sections: {
          type: 'array',
          items: { type: 'string' },
          description: '含めるセクション（省略時は全体）',
        },
      },
      required: ['rfc'],
    },
  },
  {
    name: 'validate_statement',
    description: '指定した主張が RFC の要件に準拠しているか検証します。',
    inputSchema: {
      type: 'object',
      properties: {
        rfc: {
          type: 'number',
          description: 'RFC 番号',
        },
        statement: {
          type: 'string',
          description: '検証したい実装や動作の説明',
        },
      },
      required: ['rfc', 'statement'],
    },
  },
];
