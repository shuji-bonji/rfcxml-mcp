/**
 * ツール定義（inputSchema）のテスト
 *
 * `server.ts` は `fromJsonSchema` で包んだスキーマで入力を検証する。ここでは
 * 同じ関数を通して、未知のキーと空の section が弾かれることを見る。
 */
import { describe, it, expect } from 'vitest';
import { fromJsonSchema } from '@modelcontextprotocol/server';
import { tools } from './definitions.js';

async function validate(toolName: string, args: Record<string, unknown>) {
  const tool = tools.find((t) => t.name === toolName);
  if (!tool) throw new Error(`no such tool: ${toolName}`);
  return fromJsonSchema<Record<string, unknown>>(tool.inputSchema)['~standard'].validate(args);
}

describe('tool inputSchema', () => {
  it('every tool declares additionalProperties: false (Issue #21)', () => {
    for (const tool of tools) {
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }
  });

  it('rejects an unknown key (sections instead of section)', async () => {
    const result = await validate('get_requirements', { rfc: 9110, sections: ['3.5'] });
    expect(result.issues?.length).toBeGreaterThan(0);
  });

  it('accepts the documented keys', async () => {
    const result = await validate('get_requirements', { rfc: 9110, section: '3.5', level: 'MUST' });
    expect(result.issues).toBeUndefined();
  });

  it('rejects an empty section on get_related_sections (Issue #16)', async () => {
    const result = await validate('get_related_sections', { rfc: 9110, section: '' });
    expect(result.issues?.length).toBeGreaterThan(0);
  });
});
