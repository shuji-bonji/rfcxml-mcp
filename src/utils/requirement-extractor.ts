/**
 * 要件抽出の共通ユーティリティ
 * XML/テキストパーサー共通で使用
 */

import type { Section, Requirement, RequirementLevel } from '../types/index.js';
import { extractSentence } from './text.js';

/**
 * 要件抽出フィルタ
 */
export interface RequirementFilter {
  section?: string;
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
 * セクションから要件を再帰的に抽出
 */
export function extractRequirementsFromSections(
  sections: Section[],
  filter?: RequirementFilter,
  options: ParseOptions = { parseComponents: true }
): Requirement[] {
  const requirements: Requirement[] = [];
  let idCounter = 1;

  function processSection(section: Section, path: string) {
    const sectionId = section.number || section.anchor || path;

    // セクションフィルタリング（サブセクションも処理続行）
    const shouldProcess = !filter?.section || sectionId.startsWith(filter.section);

    if (shouldProcess) {
      // テキストブロックから要件抽出
      for (const block of section.content) {
        if (block.type === 'text' && block.requirements.length > 0) {
          for (const marker of block.requirements) {
            if (filter?.level && marker.level !== filter.level) {
              continue;
            }

            const sentence = extractSentence(block.content, marker.position);
            const components = options.parseComponents
              ? parseRequirementComponents(sentence, marker.level)
              : {};

            requirements.push({
              id: `R-${sectionId}-${idCounter++}`,
              level: marker.level,
              text: sentence.trim(),
              section: sectionId,
              sectionTitle: section.title,
              fullContext: block.content,
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

              const components = options.parseComponents
                ? parseRequirementComponents(item.content, marker.level)
                : {};

              requirements.push({
                id: `R-${sectionId}-${idCounter++}`,
                level: marker.level,
                text: item.content.trim(),
                section: sectionId,
                sectionTitle: section.title,
                fullContext: item.content,
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
 * 要件文から構成要素を解析
 */
function parseRequirementComponents(text: string, level: RequirementLevel): Partial<Requirement> {
  const result: Partial<Requirement> = {};

  // 主語の抽出（"The client MUST" → "client"）
  const subjectMatch = text.match(/^(?:The\s+)?(\w+(?:\s+\w+)?)\s+(?:MUST|SHALL|SHOULD|MAY)/i);
  if (subjectMatch) {
    result.subject = subjectMatch[1].toLowerCase();
  }

  // 条件の抽出（"if", "when", "unless"）
  const conditionMatch = text.match(/\b(if|when|unless|where|in case)\s+([^,.]+)/i);
  if (conditionMatch) {
    result.condition = conditionMatch[2].trim();
  }

  // 例外の抽出
  const exceptionMatch = text.match(/\b(unless|except|excluding)\s+([^,.]+)/i);
  if (exceptionMatch) {
    result.exception = exceptionMatch[2].trim();
  }

  // アクションの抽出（キーワードの後）
  const actionMatch = text.match(new RegExp(`${level}\\s+(.+?)(?:\\.|,|$)`, 'i'));
  if (actionMatch) {
    result.action = actionMatch[1].trim();
  }

  return result;
}
