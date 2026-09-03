/**
 * 要件抽出の共通ユーティリティ
 * XML/テキストパーサー共通で使用
 */

import type { Section, Requirement, RequirementLevel } from '../types/index.js';
import {
  clipAtClauseEnd,
  extractSentence,
  foldWhitespace,
  requirementSource,
  stripListMarker,
} from './text.js';
import { normalizeSectionNumber } from './section.js';

/**
 * 要件抽出フィルタ
 */
export interface RequirementFilter {
  /** 単一セクション（後方互換性のため維持） */
  section?: string;
  /** 複数セクション指定 */
  sections?: string[];
  /** サブセクションを含めるか（デフォルト: true） */
  includeSubsections?: boolean;
  /** 要件レベルでフィルタ */
  level?: RequirementLevel;
}

/**
 * 要件構成要素の解析オプション
 */
export interface ParseOptions {
  /** 主語・アクション等の構成要素を解析するか */
  parseComponents?: boolean;
}

/**
 * セクション番号を正規化（`section-6.2.3` → `6.2.3`、`section-appendix.a.2.5` → `A.2.5`）
 */
function normalizeSectionId(id: string): string {
  return normalizeSectionNumber(id);
}

/**
 * セクションがフィルタに一致するかチェック
 */
function matchesSectionFilter(sectionId: string, filter?: RequirementFilter): boolean {
  // フィルタなしの場合は全て一致
  if (!filter) return true;

  const normalizedId = normalizeSectionId(sectionId);
  const includeSubsections = filter.includeSubsections !== false; // デフォルト true

  // 複数セクション指定
  const filterSections = filter.sections || (filter.section ? [filter.section] : []);
  if (filterSections.length === 0) return true;

  for (const filterSec of filterSections) {
    const normalizedFilter = normalizeSectionId(filterSec);

    // 完全一致
    if (normalizedId === normalizedFilter) return true;

    // サブセクション一致（例: "3.5.1" は "3.5" にマッチ）
    if (includeSubsections && normalizedId.startsWith(normalizedFilter + '.')) {
      return true;
    }
  }

  return false;
}

/**
 * セクションから要件を再帰的に抽出
 */
export function extractRequirementsFromSections(
  sections: Section[],
  filter?: RequirementFilter,
  options: ParseOptions = { parseComponents: true }
): Requirement[] {
  const requirements: Requirement[] = [];
  let idCounter = 1;

  /**
   * 出力済みの要件を記録する。キーは「セクション + レベル + 要件文」。
   *
   * 1 つの文に同じレベルのキーワードが 2 回現れると（例: 要求 ID ラベルや
   * "MUST X and MUST Y"）、マーカーが 2 個立って同じ文が 2 件出力される。
   * 文が同一なら要件としても同一なので、最初の 1 件だけを残す。
   */
  const seen = new Set<string>();

  function isDuplicate(sectionId: string, level: string, text: string): boolean {
    const key = `${sectionId}\u0000${level}\u0000${text}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  }

  function processSection(section: Section, path: string) {
    // 内部の識別子（RFCXML の `pn`）はそのままでは外に出せない。出力する
    // `id` と `section` は節番号にそろえる。
    const sectionId = normalizeSectionId(section.number || section.anchor || path);

    // セクションフィルタリング
    const shouldProcess = matchesSectionFilter(sectionId, filter);

    if (shouldProcess) {
      // テキストブロックから要件抽出
      for (const block of section.content) {
        if (block.type === 'text' && block.requirements.length > 0) {
          for (const marker of block.requirements) {
            if (filter?.level && marker.level !== filter.level) {
              continue;
            }

            // 図・ABNF は空白を畳まない。ABNF の注釈は散文として組み直す。
            const source = requirementSource(block.content, marker.position, marker.level);
            const raw = extractSentence(source.text, source.position);
            // `text` は必ず 1 行にする。要件文は文として読まれ、`generate_checklist` は
            // 1 項目 1 行の Markdown にする。図の桁を残すのは `fullContext` の役目である。
            const sentence = foldWhitespace(stripListMarker(raw));

            if (isDuplicate(sectionId, marker.level, sentence)) {
              continue;
            }

            // キーワードのほかに語が無いものは要件文ではない。
            // RFC 5280 §11.2 の ASN.1 の切れ端 `"OPTIONAL,"` `"} OPTIONAL,"` が
            // 要件として出ていた（RFC 90 本・要件 9,584 件のうち 4 件）。
            if (!hasSubstance(sentence)) {
              continue;
            }

            // 図・表の行から取った要件には主語も条件もアクションも無い。
            // RFC 2131 §4.3.1 の表の行 "Message SHOULD SHOULD SHOULD" に
            // `subject: "message should"` `action: "SHOULD SHOULD"` が付いていた。
            const components =
              options.parseComponents && source.prose
                ? parseRequirementComponents(sentence, marker.level)
                : {};

            requirements.push({
              id: `R-${sectionId}-${idCounter++}`,
              level: marker.level,
              text: sentence,
              section: sectionId,
              sectionTitle: section.title,
              // `text` と同じく行頭の箇条書き記号を落とす。同じ段落の同じ書き出しで
              // 片方だけ "o " が残っていた。
              fullContext: source.prose
                ? foldWhitespace(stripListMarker(block.content))
                : block.content,
              ...components,
            });
          }
        }

        // リストアイテムからも抽出
        if (block.type === 'list') {
          for (const item of block.items) {
            for (const marker of item.requirements) {
              if (filter?.level && marker.level !== filter.level) {
                continue;
              }

              // 箇条書きの項目も、文の単位で切り出す。
              //
              // 箇条書きの項目は 1 文であることが多く、v0.6.14 まではその前提で
              // 項目の全文を要件文にしていた。RFCXML の `<dl>` は 1 項目が段落に
              // なる。RFC 9113 §8.3.1 の `":authority"` の項目は 2,150 文字の
              // 段落で、その中に MUST・MUST NOT・SHOULD・MAY が入っているため、
              // 同じ 2,150 文字が 4 件の要件として並んでいた。
              const itemContext = foldWhitespace(stripListMarker(item.content));
              const itemText = foldWhitespace(
                stripListMarker(extractSentence(item.content, marker.position))
              );
              if (isDuplicate(sectionId, marker.level, itemText)) {
                continue;
              }

              if (!hasSubstance(itemText)) {
                continue;
              }

              const components = options.parseComponents
                ? parseRequirementComponents(itemText, marker.level)
                : {};

              requirements.push({
                id: `R-${sectionId}-${idCounter++}`,
                level: marker.level,
                text: itemText,
                section: sectionId,
                sectionTitle: section.title,
                fullContext: itemContext,
                ...components,
              });
            }
          }
        }
      }
    }

    // サブセクションを再帰処理
    for (const subsection of section.subsections) {
      processSection(subsection, `${sectionId}.${subsection.number || ''}`);
    }
  }

  for (const section of sections) {
    processSection(section, section.number || '');
  }

  return requirements;
}

/**
 * 要件文に、キーワード以外の語があるか。
 *
 * ASN.1 の切れ端が要件として出ることがある。RFC 5280 §11.2 の
 * `OPTIONAL,` や `} OPTIONAL,` は、キーワードを外すと何も残らない。
 * 要件は「誰が何をするか」を書いた文であって、キーワード単体ではない。
 */
function hasSubstance(text: string): boolean {
  const withoutKeywords = text.replace(
    /\b(?:MUST|SHALL|SHOULD|MAY|REQUIRED|OPTIONAL|RECOMMENDED|NOT)\b/g,
    ' '
  );
  return /[A-Za-z0-9]/.test(withoutKeywords);
}

/**
 * 要件文から構成要素を解析
 */
function parseRequirementComponents(text: string, level: RequirementLevel): Partial<Requirement> {
  const result: Partial<Requirement> = {};

  // 主語の抽出（"The client MUST" → "client"）
  const subjectMatch = text.match(/^(?:The\s+)?(\w+(?:\s+\w+)?)\s+(?:MUST|SHALL|SHOULD|MAY)/i);
  if (subjectMatch) {
    result.subject = subjectMatch[1].toLowerCase();
  }

  // 条件の抽出（"if", "when", "where", "in case"）
  //
  // `unless` はここに入れない。例外の側と重なり、`condition` と `exception` に
  // 同じ文字列が入る。実測（RFC 49 本・要件 7,797 件）で 247 件（3.2%）あった。
  // 「X でない限り」は条件ではなく例外である。
  //
  // 切り出しは clipAtClauseEnd に任せる。`[^,.]+` で止めると、括弧内のカンマや
  // 節番号のピリオドで切れて "this fails (e" のようになる。
  const conditionMatch = text.match(/\b(if|when|where|in case)\s+(.+)/is);
  if (conditionMatch) {
    const condition = clipAtClauseEnd(conditionMatch[2]);
    if (condition) result.condition = condition;
  }

  // 例外の抽出
  const exceptionMatch = text.match(/\b(unless|except|excluding)\s+(.+)/is);
  if (exceptionMatch) {
    const exception = clipAtClauseEnd(exceptionMatch[2]);
    if (exception) result.exception = exception;
  }

  // アクションの抽出（キーワードの後）
  const actionMatch = text.match(new RegExp(`${level}\\s+(.+)`, 'is'));
  if (actionMatch) {
    const action = clipAtClauseEnd(actionMatch[1]);
    if (action) result.action = action;
  }

  return result;
}
