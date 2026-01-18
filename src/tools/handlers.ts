/**
 * MCP ツールハンドラー
 */

import { fetchRFCXML, fetchRFCText, RFCXMLNotAvailableError } from '../services/rfc-fetcher.js';
import { parseRFCXML, extractRequirements, type ParsedRFC } from '../services/rfcxml-parser.js';
import { parseRFCText } from '../services/rfc-text-parser.js';
import { LRUCache } from '../utils/cache.js';
import { CACHE_CONFIG } from '../config.js';
import type {
  GetRFCStructureArgs,
  GetRequirementsArgs,
  GetDefinitionsArgs,
  GetDependenciesArgs,
  GenerateChecklistArgs,
  ValidateStatementArgs,
  Requirement,
  ImplementationChecklist,
  RequirementLevel,
} from '../types/index.js';

/**
 * パース結果とソース情報
 */
interface ParsedRFCWithSource {
  data: ParsedRFC;
  source: 'xml' | 'text';
}

/**
 * パース済みRFCキャッシュ（メインキャッシュ）
 * パースはCPU集約的なので、パース結果をキャッシュする
 */
const parseCache = new LRUCache<number, ParsedRFCWithSource>(CACHE_CONFIG.parsed);

/**
 * パースキャッシュをクリア（テスト用）
 */
export function clearParseCache(): void {
  parseCache.clear();
}

/**
 * RFCXML を取得してパース（キャッシュ付き、フォールバック対応）
 */
async function getParsedRFC(rfcNumber: number): Promise<ParsedRFCWithSource> {
  const cached = parseCache.get(rfcNumber);
  if (cached) {
    return cached;
  }

  // まず XML を試す
  try {
    const xml = await fetchRFCXML(rfcNumber);
    const parsed = parseRFCXML(xml);
    const result: ParsedRFCWithSource = { data: parsed, source: 'xml' };
    parseCache.set(rfcNumber, result);
    return result;
  } catch (xmlError) {
    // XML 取得失敗 → テキストフォールバック
    if (xmlError instanceof RFCXMLNotAvailableError && xmlError.isOldRFC) {
      console.error(`[RFC ${rfcNumber}] XML not available, trying text fallback...`);
      try {
        const text = await fetchRFCText(rfcNumber);
        const parsed = parseRFCText(text, rfcNumber);
        const result: ParsedRFCWithSource = { data: parsed, source: 'text' };
        parseCache.set(rfcNumber, result);
        return result;
      } catch (textError) {
        // テキストも失敗
        throw new Error(
          `RFC ${rfcNumber} の取得に失敗しました。\n` +
            `XML: ${xmlError.message}\n` +
            `Text: ${textError instanceof Error ? textError.message : String(textError)}`
        );
      }
    }
    // 新しい RFC の場合はそのままエラーを伝播
    throw xmlError;
  }
}

/**
 * get_rfc_structure ハンドラー
 */
export async function handleGetRFCStructure(args: GetRFCStructureArgs) {
  const { data: parsed, source } = await getParsedRFC(args.rfc);

  // セクション構造を簡略化
  function simplifySection(section: any, includeContent: boolean): any {
    const result: any = {
      number: section.number,
      title: section.title,
      anchor: section.anchor,
    };

    if (includeContent) {
      result.content = section.content;
    }

    if (section.subsections?.length > 0) {
      result.subsections = section.subsections.map((s: any) => simplifySection(s, includeContent));
    }

    return result;
  }

  return {
    metadata: parsed.metadata,
    sections: parsed.sections.map((s) => simplifySection(s, args.includeContent ?? false)),
    referenceCount: {
      normative: parsed.references.normative.length,
      informative: parsed.references.informative.length,
    },
    _source: source,
    _sourceNote:
      source === 'text' ? '⚠️ テキストからの解析結果です。精度が低い可能性があります。' : undefined,
  };
}

/**
 * get_requirements ハンドラー
 */
export async function handleGetRequirements(args: GetRequirementsArgs) {
  const { data: parsed, source } = await getParsedRFC(args.rfc);

  const requirements = extractRequirements(parsed.sections, {
    section: args.section,
    level: args.level as RequirementLevel,
  });

  // 統計情報
  const stats = {
    total: requirements.length,
    byLevel: {} as Record<string, number>,
  };

  for (const req of requirements) {
    stats.byLevel[req.level] = (stats.byLevel[req.level] || 0) + 1;
  }

  return {
    rfc: args.rfc,
    filter: {
      section: args.section || 'all',
      level: args.level || 'all',
    },
    stats,
    requirements,
    _source: source,
    _sourceNote:
      source === 'text'
        ? '⚠️ テキストからの解析結果です。要件の抽出精度が低い可能性があります。'
        : undefined,
  };
}

/**
 * get_definitions ハンドラー
 */
export async function handleGetDefinitions(args: GetDefinitionsArgs) {
  const { data: parsed, source } = await getParsedRFC(args.rfc);

  let definitions = parsed.definitions;

  // 用語でフィルタ
  if (args.term) {
    const searchTerm = args.term.toLowerCase();
    definitions = definitions.filter(
      (d) =>
        d.term.toLowerCase().includes(searchTerm) || d.definition.toLowerCase().includes(searchTerm)
    );
  }

  return {
    rfc: args.rfc,
    searchTerm: args.term,
    count: definitions.length,
    definitions,
    _source: source,
    _sourceNote:
      source === 'text'
        ? '⚠️ テキストからの解析結果です。定義の抽出精度が低い可能性があります。'
        : undefined,
  };
}

/**
 * get_rfc_dependencies ハンドラー
 */
export async function handleGetDependencies(args: GetDependenciesArgs) {
  const { data: parsed, source } = await getParsedRFC(args.rfc);

  const result: any = {
    rfc: args.rfc,
    normative: parsed.references.normative.map((ref) => ({
      rfcNumber: ref.rfcNumber,
      title: ref.title,
      anchor: ref.anchor,
    })),
    informative: parsed.references.informative.map((ref) => ({
      rfcNumber: ref.rfcNumber,
      title: ref.title,
      anchor: ref.anchor,
    })),
    _source: source,
  };

  // テキストソースの場合は参照情報が取得できない
  if (source === 'text') {
    result._sourceNote = '⚠️ テキストからの解析のため、参照情報は取得できません。';
  }

  // TODO: referencedBy は IETF Datatracker API から取得
  if (args.includeReferencedBy) {
    result.referencedBy = [];
    result._note = 'referencedBy は未実装（IETF Datatracker API 統合が必要）';
  }

  return result;
}

/**
 * セクション番号を正規化（section-3.5 → 3.5）
 */
function normalizeSectionNumber(sectionId: string): string {
  return sectionId.replace(/^section-/, '');
}

/**
 * セクションを検索（複数の形式に対応）
 */
function findSection(sections: any[], target: string): any | null {
  const normalizedTarget = normalizeSectionNumber(target);

  for (const sec of sections) {
    // 各形式でマッチを試みる
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
 * get_related_sections ハンドラー
 */
export async function handleGetRelatedSections(args: { rfc: number; section: string }) {
  const { data: parsed, source } = await getParsedRFC(args.rfc);

  const targetSection = findSection(parsed.sections, args.section);
  if (!targetSection) {
    return {
      error: `Section ${args.section} not found`,
    };
  }

  // クロスリファレンスを収集
  const relatedSections = new Set<string>();

  for (const block of targetSection.content || []) {
    if (block.type === 'text' && block.crossReferences) {
      for (const ref of block.crossReferences) {
        if (ref.type === 'section' && ref.section) {
          relatedSections.add(ref.section);
        }
      }
    }
  }

  return {
    rfc: args.rfc,
    section: args.section,
    title: targetSection.title,
    relatedSections: Array.from(relatedSections).map((secNum) => {
      const sec = findSection(parsed.sections, secNum);
      return {
        number: secNum,
        title: sec?.title || 'Unknown',
      };
    }),
    _source: source,
    _sourceNote:
      source === 'text'
        ? '⚠️ テキストからの解析結果です。関連セクションの精度が低い可能性があります。'
        : undefined,
  };
}

/**
 * generate_checklist ハンドラー
 */
export async function handleGenerateChecklist(args: GenerateChecklistArgs) {
  const { data: parsed, source } = await getParsedRFC(args.rfc);
  const requirements = extractRequirements(parsed.sections, {
    section: args.sections?.[0],
  });

  // 役割でフィルタ（簡易実装：subject に基づく）
  const filteredReqs =
    args.role && args.role !== 'both'
      ? requirements.filter((r) => {
          const subject = r.subject?.toLowerCase() || '';
          if (args.role === 'client') {
            return subject.includes('client') || !subject.includes('server');
          }
          return subject.includes('server') || !subject.includes('client');
        })
      : requirements;

  // レベル別に分類
  const must = filteredReqs.filter((r) =>
    ['MUST', 'MUST NOT', 'REQUIRED', 'SHALL', 'SHALL NOT'].includes(r.level)
  );
  const should = filteredReqs.filter((r) =>
    ['SHOULD', 'SHOULD NOT', 'RECOMMENDED', 'NOT RECOMMENDED'].includes(r.level)
  );
  const may = filteredReqs.filter((r) => ['MAY', 'OPTIONAL'].includes(r.level));

  // Markdown 生成
  const markdown = generateChecklistMarkdown({
    rfc: args.rfc,
    title: parsed.metadata.title,
    role: args.role,
    must: must.map((r) => ({ id: r.id, requirement: r, checked: false })),
    should: should.map((r) => ({ id: r.id, requirement: r, checked: false })),
    may: may.map((r) => ({ id: r.id, requirement: r, checked: false })),
    generatedAt: new Date().toISOString(),
  });

  return {
    rfc: args.rfc,
    role: args.role || 'both',
    stats: {
      must: must.length,
      should: should.length,
      may: may.length,
      total: filteredReqs.length,
    },
    markdown,
    _source: source,
    _sourceNote:
      source === 'text'
        ? '⚠️ テキストからの解析結果です。チェックリストの精度が低い可能性があります。'
        : undefined,
  };
}

/**
 * チェックリスト Markdown 生成
 */
function generateChecklistMarkdown(checklist: ImplementationChecklist): string {
  const lines: string[] = [];

  lines.push(`# RFC ${checklist.rfc} 実装チェックリスト`);
  lines.push('');
  lines.push(`**${checklist.title}**`);
  lines.push('');
  if (checklist.role && checklist.role !== 'both') {
    lines.push(`役割: ${checklist.role === 'client' ? 'クライアント' : 'サーバー'}`);
    lines.push('');
  }
  lines.push(`生成日時: ${checklist.generatedAt}`);
  lines.push('');

  if (checklist.must.length > 0) {
    lines.push('## 必須要件 (MUST / REQUIRED / SHALL)');
    lines.push('');
    for (const item of checklist.must) {
      lines.push(`- [ ] ${item.requirement.text} (${item.requirement.section})`);
    }
    lines.push('');
  }

  if (checklist.should.length > 0) {
    lines.push('## 推奨要件 (SHOULD / RECOMMENDED)');
    lines.push('');
    for (const item of checklist.should) {
      lines.push(`- [ ] ${item.requirement.text} (${item.requirement.section})`);
    }
    lines.push('');
  }

  if (checklist.may.length > 0) {
    lines.push('## 任意要件 (MAY / OPTIONAL)');
    lines.push('');
    for (const item of checklist.may) {
      lines.push(`- [ ] ${item.requirement.text} (${item.requirement.section})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * validate_statement ハンドラー
 */
export async function handleValidateStatement(args: ValidateStatementArgs) {
  const { data: parsed, source } = await getParsedRFC(args.rfc);
  const requirements = extractRequirements(parsed.sections);

  // 簡易的なキーワードマッチング
  const statementLower = args.statement.toLowerCase();
  const keywords = statementLower.split(/\s+/).filter((w) => w.length > 3);

  const matchingRequirements = requirements.filter((req) => {
    const reqText = (req.text + ' ' + req.fullContext).toLowerCase();
    return keywords.some((kw) => reqText.includes(kw));
  });

  // 矛盾検出（簡易版）
  const conflicts: Requirement[] = [];
  // TODO: より高度な矛盾検出ロジック

  return {
    rfc: args.rfc,
    statement: args.statement,
    isValid: conflicts.length === 0,
    matchingRequirements: matchingRequirements.slice(0, 10), // 上位10件
    conflicts,
    suggestions:
      matchingRequirements.length === 0
        ? ['該当する要件が見つかりませんでした。キーワードを変えて再検索してください。']
        : undefined,
    _source: source,
    _sourceNote:
      source === 'text'
        ? '⚠️ テキストからの解析結果です。検証精度が低い可能性があります。'
        : undefined,
  };
}
