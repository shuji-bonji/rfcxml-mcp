/**
 * MCP ツールハンドラー
 */

import { fetchRFCXML } from '../services/rfc-fetcher.js';
import { parseRFCXML, extractRequirements } from '../services/rfcxml-parser.js';
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

// パースキャッシュ
const parseCache = new Map<number, ReturnType<typeof parseRFCXML>>();

/**
 * RFCXML を取得してパース（キャッシュ付き）
 */
async function getParsedRFC(rfcNumber: number) {
  const cached = parseCache.get(rfcNumber);
  if (cached) {
    return cached;
  }

  const xml = await fetchRFCXML(rfcNumber);
  const parsed = parseRFCXML(xml);
  parseCache.set(rfcNumber, parsed);
  return parsed;
}

/**
 * get_rfc_structure ハンドラー
 */
export async function handleGetRFCStructure(args: GetRFCStructureArgs) {
  const parsed = await getParsedRFC(args.rfc);

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
      result.subsections = section.subsections.map((s: any) =>
        simplifySection(s, includeContent)
      );
    }

    return result;
  }

  return {
    metadata: parsed.metadata,
    sections: parsed.sections.map(s => simplifySection(s, args.includeContent ?? false)),
    referenceCount: {
      normative: parsed.references.normative.length,
      informative: parsed.references.informative.length,
    },
  };
}

/**
 * get_requirements ハンドラー
 */
export async function handleGetRequirements(args: GetRequirementsArgs) {
  const parsed = await getParsedRFC(args.rfc);
  
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
  };
}

/**
 * get_definitions ハンドラー
 */
export async function handleGetDefinitions(args: GetDefinitionsArgs) {
  const parsed = await getParsedRFC(args.rfc);
  
  let definitions = parsed.definitions;

  // 用語でフィルタ
  if (args.term) {
    const searchTerm = args.term.toLowerCase();
    definitions = definitions.filter(d =>
      d.term.toLowerCase().includes(searchTerm) ||
      d.definition.toLowerCase().includes(searchTerm)
    );
  }

  return {
    rfc: args.rfc,
    searchTerm: args.term,
    count: definitions.length,
    definitions,
  };
}

/**
 * get_rfc_dependencies ハンドラー
 */
export async function handleGetDependencies(args: GetDependenciesArgs) {
  const parsed = await getParsedRFC(args.rfc);

  const result: any = {
    rfc: args.rfc,
    normative: parsed.references.normative.map(ref => ({
      rfcNumber: ref.rfcNumber,
      title: ref.title,
      anchor: ref.anchor,
    })),
    informative: parsed.references.informative.map(ref => ({
      rfcNumber: ref.rfcNumber,
      title: ref.title,
      anchor: ref.anchor,
    })),
  };

  // TODO: referencedBy は IETF Datatracker API から取得
  if (args.includeReferencedBy) {
    result.referencedBy = [];
    result._note = 'referencedBy は未実装（IETF Datatracker API 統合が必要）';
  }

  return result;
}

/**
 * get_related_sections ハンドラー
 */
export async function handleGetRelatedSections(args: { rfc: number; section: string }) {
  const parsed = await getParsedRFC(args.rfc);
  
  // 指定セクションを探す
  function findSection(sections: any[], target: string): any | null {
    for (const sec of sections) {
      if (sec.number === target || sec.anchor === target) {
        return sec;
      }
      const found = findSection(sec.subsections || [], target);
      if (found) return found;
    }
    return null;
  }

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
    relatedSections: Array.from(relatedSections).map(secNum => {
      const sec = findSection(parsed.sections, secNum);
      return {
        number: secNum,
        title: sec?.title || 'Unknown',
      };
    }),
  };
}

/**
 * generate_checklist ハンドラー
 */
export async function handleGenerateChecklist(args: GenerateChecklistArgs) {
  const parsed = await getParsedRFC(args.rfc);
  const requirements = extractRequirements(parsed.sections, {
    section: args.sections?.[0],
  });

  // 役割でフィルタ（簡易実装：subject に基づく）
  const filteredReqs = args.role && args.role !== 'both'
    ? requirements.filter(r => {
        const subject = r.subject?.toLowerCase() || '';
        if (args.role === 'client') {
          return subject.includes('client') || !subject.includes('server');
        }
        return subject.includes('server') || !subject.includes('client');
      })
    : requirements;

  // レベル別に分類
  const must = filteredReqs.filter(r =>
    ['MUST', 'MUST NOT', 'REQUIRED', 'SHALL', 'SHALL NOT'].includes(r.level)
  );
  const should = filteredReqs.filter(r =>
    ['SHOULD', 'SHOULD NOT', 'RECOMMENDED', 'NOT RECOMMENDED'].includes(r.level)
  );
  const may = filteredReqs.filter(r =>
    ['MAY', 'OPTIONAL'].includes(r.level)
  );

  // Markdown 生成
  const markdown = generateChecklistMarkdown({
    rfc: args.rfc,
    title: parsed.metadata.title,
    role: args.role,
    must: must.map(r => ({ id: r.id, requirement: r, checked: false })),
    should: should.map(r => ({ id: r.id, requirement: r, checked: false })),
    may: may.map(r => ({ id: r.id, requirement: r, checked: false })),
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
  const parsed = await getParsedRFC(args.rfc);
  const requirements = extractRequirements(parsed.sections);

  // 簡易的なキーワードマッチング
  const statementLower = args.statement.toLowerCase();
  const keywords = statementLower.split(/\s+/).filter(w => w.length > 3);

  const matchingRequirements = requirements.filter(req => {
    const reqText = (req.text + ' ' + req.fullContext).toLowerCase();
    return keywords.some(kw => reqText.includes(kw));
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
    suggestions: matchingRequirements.length === 0
      ? ['該当する要件が見つかりませんでした。キーワードを変えて再検索してください。']
      : undefined,
  };
}
