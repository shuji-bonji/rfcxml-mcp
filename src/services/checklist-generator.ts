/**
 * チェックリスト生成サービス
 * RFC要件からMarkdownチェックリストを生成
 */

import type { Requirement, ImplementationChecklist, ChecklistItem } from '../types/index.js';

/**
 * 要件をレベル別に分類
 */
export interface ClassifiedRequirements {
  must: Requirement[];
  should: Requirement[];
  may: Requirement[];
}

/**
 * 要件をMUST/SHOULD/MAYに分類
 */
export function classifyRequirements(requirements: Requirement[]): ClassifiedRequirements {
  const must = requirements.filter((r) =>
    ['MUST', 'MUST NOT', 'REQUIRED', 'SHALL', 'SHALL NOT'].includes(r.level)
  );
  const should = requirements.filter((r) =>
    ['SHOULD', 'SHOULD NOT', 'RECOMMENDED', 'NOT RECOMMENDED'].includes(r.level)
  );
  const may = requirements.filter((r) => ['MAY', 'OPTIONAL'].includes(r.level));

  return { must, should, may };
}

/**
 * ロールでフィルタリング
 */
export function filterByRole(
  requirements: Requirement[],
  role?: 'client' | 'server' | 'both'
): Requirement[] {
  if (!role || role === 'both') {
    return requirements;
  }

  return requirements.filter((r) => {
    const subject = r.subject?.toLowerCase() || '';
    if (role === 'client') {
      return subject.includes('client') || !subject.includes('server');
    }
    return subject.includes('server') || !subject.includes('client');
  });
}

/**
 * チェックリストアイテムを作成
 */
function createChecklistItems(requirements: Requirement[]): ChecklistItem[] {
  return requirements.map((r) => ({
    id: r.id,
    requirement: r,
    checked: false,
  }));
}

/**
 * チェックリストを生成
 */
export function generateChecklist(
  rfcNumber: number,
  title: string,
  requirements: Requirement[],
  role?: 'client' | 'server' | 'both'
): ImplementationChecklist {
  const filtered = filterByRole(requirements, role);
  const classified = classifyRequirements(filtered);

  return {
    rfc: rfcNumber,
    title,
    role,
    must: createChecklistItems(classified.must),
    should: createChecklistItems(classified.should),
    may: createChecklistItems(classified.may),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * チェックリストをMarkdown形式で出力
 */
export function generateChecklistMarkdown(checklist: ImplementationChecklist): string {
  const lines: string[] = [];

  lines.push(`# RFC ${checklist.rfc} Implementation Checklist`);
  lines.push('');
  lines.push(`**${checklist.title}**`);
  lines.push('');
  if (checklist.role && checklist.role !== 'both') {
    lines.push(`Role: ${checklist.role}`);
    lines.push('');
  }
  lines.push(`Generated: ${checklist.generatedAt}`);
  lines.push('');

  if (checklist.must.length > 0) {
    lines.push('## Mandatory Requirements (MUST / REQUIRED / SHALL)');
    lines.push('');
    for (const item of checklist.must) {
      lines.push(`- [ ] ${item.requirement.text} (${item.requirement.section})`);
    }
    lines.push('');
  }

  if (checklist.should.length > 0) {
    lines.push('## Recommended Requirements (SHOULD / RECOMMENDED)');
    lines.push('');
    for (const item of checklist.should) {
      lines.push(`- [ ] ${item.requirement.text} (${item.requirement.section})`);
    }
    lines.push('');
  }

  if (checklist.may.length > 0) {
    lines.push('## Optional Requirements (MAY / OPTIONAL)');
    lines.push('');
    for (const item of checklist.may) {
      lines.push(`- [ ] ${item.requirement.text} (${item.requirement.section})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * チェックリスト統計
 */
export interface ChecklistStats {
  must: number;
  should: number;
  may: number;
  total: number;
}

/**
 * チェックリストの統計情報を取得
 */
export function getChecklistStats(checklist: ImplementationChecklist): ChecklistStats {
  return {
    must: checklist.must.length,
    should: checklist.should.length,
    may: checklist.may.length,
    total: checklist.must.length + checklist.should.length + checklist.may.length,
  };
}
