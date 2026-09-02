/**
 * チェックリスト生成のテスト
 */

import { describe, it, expect } from 'vitest';
import type { Requirement } from '../types/index.js';
import { generateChecklist, generateChecklistMarkdown } from './checklist-generator.js';

const requirement = (level: Requirement['level'], text: string, section = '5.3'): Requirement => ({
  id: `R-${section}-${level}`,
  level,
  text,
  section,
  sectionTitle: 'Client-to-Server Masking',
  fullContext: text,
});

describe('generateChecklistMarkdown', () => {
  // 1 つの文が MUST と MUST NOT の両方を含む。要件は 2 件立つが文は同じ。
  const bothLevels =
    'The masking key MUST be derived from a strong source of entropy, and the masking key MUST NOT be predictable.';

  it('要件レベルを行に出す', () => {
    const checklist = generateChecklist(6455, 'The WebSocket Protocol', [
      requirement('MUST', bothLevels),
      requirement('MUST NOT', bothLevels),
    ]);

    const lines = generateChecklistMarkdown(checklist)
      .split('\n')
      .filter((l) => l.startsWith('- [ ]'));

    expect(lines).toEqual([
      `- [ ] **MUST** ${bothLevels} (§5.3)`,
      `- [ ] **MUST NOT** ${bothLevels} (§5.3)`,
    ]);
  });

  it('レベルも節も文も同じ行は 1 度だけ出す', () => {
    const checklist = generateChecklist(6455, 'The WebSocket Protocol', [
      requirement('MUST', 'A client MUST mask all frames.'),
      requirement('MUST', 'A client MUST mask all frames.'),
    ]);

    const lines = generateChecklistMarkdown(checklist)
      .split('\n')
      .filter((l) => l.startsWith('- [ ]'));

    expect(lines).toHaveLength(1);
  });

  it('1 つの項目が 1 行に収まる', () => {
    // 要件文に改行が残っていると、2 行目以降が箇条書きの外へ出て Markdown が崩れる。
    const checklist = generateChecklist(6455, 'The WebSocket Protocol', [
      requirement('MUST', 'A client MUST mask all frames that it sends to the server.'),
    ]);

    const markdown = generateChecklistMarkdown(checklist);
    const items = markdown.split('\n').filter((l) => l.trim() && !l.startsWith('#'));

    expect(items.every((l) => l.startsWith('- [ ]') || !l.startsWith(' '))).toBe(true);
  });
});
