/**
 * セクション関連ユーティリティ
 */

import type { Section } from '../types/index.js';

/**
 * 節の識別子を、RFC が印字する節番号にそろえる。
 *
 * RFCXML の `pn` はそのままでは外に出せない形をしている。
 *
 * | `pn`                       | 返す値   | 公開版 RFC での呼び方 |
 * |---|---|---|
 * | `section-6.2.3`            | `6.2.3`  | Section 6.2.3 |
 * | `section-appendix.a.2.5`   | `A.2.5`  | Appendix A.2.5 |
 *
 * v0.6.5 まではテキスト経路が `5.3`、XML 経路が `section-6.2.3` を返しており、
 * `get_requirements` の結果をそのまま `get_related_sections` に渡すと RFC ごとに
 * 文字列の形が変わっていた。
 *
 * 検索側（`findSection` / 要件のフィルタ）もこの関数を通すため、`6.2.3`
 * `section-6.2.3` `A.2.5` `appendix.a.2.5` はいずれも同じ節に当たる。
 */
export function normalizeSectionNumber(sectionId: string): string {
  const bare = sectionId.replace(/^section-/, '');

  // 後付録は `appendix.a.2.5` の形で入っている
  const appendix = /^appendix\.([a-z])((?:\.\d+)*)$/i.exec(bare);
  if (appendix) return `${appendix[1].toUpperCase()}${appendix[2]}`;

  return bare;
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

/**
 * 節番号を文書の並び順で比べる。
 *
 * 文字列のまま並べると "14.6" が "3.1" より前に来る。数字は数として比べ、
 * 後付録（"A.2.5"）は本文のあとに置く。
 */
export function compareSectionNumbers(a: string, b: string): number {
  const partsOf = (id: string): Array<number | string> =>
    id.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part));

  const left = partsOf(a);
  const right = partsOf(b);

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i];
    const y = right[i];

    if (x === undefined) return -1;
    if (y === undefined) return 1;

    // 数字（本文）を文字（後付録）より前に置く
    if (typeof x === 'number' && typeof y === 'string') return -1;
    if (typeof x === 'string' && typeof y === 'number') return 1;

    if (x < y) return -1;
    if (x > y) return 1;
  }

  return 0;
}
