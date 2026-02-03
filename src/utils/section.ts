/**
 * セクション関連ユーティリティ
 */

import type { Section } from '../types/index.js';

/**
 * セクション番号を正規化（section-3.5 → 3.5）
 */
export function normalizeSectionNumber(sectionId: string): string {
  return sectionId.replace(/^section-/, '');
}

/**
 * セクションを検索（複数フォーマット対応）
 */
export function findSection(sections: Section[], target: string): Section | null {
  const normalizedTarget = normalizeSectionNumber(target);

  for (const sec of sections) {
    // 各フォーマットでマッチを試行
    const secNumber = sec.number ? normalizeSectionNumber(sec.number) : '';
    const secAnchor = sec.anchor ? normalizeSectionNumber(sec.anchor) : '';

    if (
      secNumber === normalizedTarget ||
      secAnchor === normalizedTarget ||
      sec.number === target ||
      sec.anchor === target
    ) {
      return sec;
    }

    const found = findSection(sec.subsections || [], target);
    if (found) return found;
  }
  return null;
}

/**
 * セクションのフルパスを取得
 */
export function getSectionPath(section: Section): string {
  return section.number || section.anchor || '';
}

/**
 * セクションからクロスリファレンスを収集
 */
export function collectCrossReferences(section: Section): Set<string> {
  const refs = new Set<string>();

  for (const block of section.content || []) {
    if (block.type === 'text' && block.crossReferences) {
      for (const ref of block.crossReferences) {
        if (ref.type === 'section' && ref.section) {
          refs.add(ref.section);
        }
      }
    }
  }

  return refs;
}
