/**
 * チェックリスト生成のテスト
 */

import { describe, it, expect } from 'vitest';
import type { Requirement } from '../types/index.js';
import {
  filterByRole,
  generateChecklist,
  generateChecklistMarkdown,
} from './checklist-generator.js';

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

describe('role の絞り込み', () => {
  const make = (id: string, text: string, subject?: string) => ({
    id,
    level: 'MUST' as const,
    text,
    section: '5.1',
    sectionTitle: 'Overview',
    fullContext: text,
    subject,
  });

  const requirements = [
    make('R1', 'A client MUST mask all frames that it sends to the server.', 'client'),
    make('R2', 'The server MUST close the connection upon receiving an unmasked frame.'),
    make('R3', 'The endpoint MUST use the minimal number of bytes to encode the length.'),
  ];

  it('主語が取れない要件も本文で振り分ける', () => {
    // 主語だけを見ていたため、R2 が client にも残っていた。
    const client = filterByRole(requirements, 'client').map((r) => r.id);
    const server = filterByRole(requirements, 'server').map((r) => r.id);

    expect(client).toEqual(['R1', 'R3']);
    expect(server).toEqual(['R2', 'R3']);
  });

  it('both は絞り込まない', () => {
    expect(filterByRole(requirements, 'both')).toHaveLength(3);
  });
});

describe('role の絞り込みは複数形も見る', () => {
  const make = (id: string, text: string, subject?: string) => ({
    id,
    level: 'MUST' as const,
    text,
    section: '8.3.1',
    sectionTitle: 'Request Pseudo-Header Fields',
    fullContext: text,
    subject,
  });

  it('複数形で書かれた役割を振り分ける', () => {
    // `\bserver\b` は "servers" に当たらない。実測で 449 件（4.6%）が
    // どちらの role にも残っていた。
    const requirements = [
      make('R1', 'Other servers MUST perform scheme-based normalization.', 'other servers'),
      make('R2', 'Clients MUST NOT generate a request with a Host header field.', 'clients'),
    ];

    expect(filterByRole(requirements, 'client').map((r) => r.id)).toEqual(['R2']);
    expect(filterByRole(requirements, 'server').map((r) => r.id)).toEqual(['R1']);
  });
});
