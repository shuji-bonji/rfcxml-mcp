/**
 * MCP Tool Handlers
 */

import { extractRequirements, type Section } from '../services/rfcxml-parser.js';
import {
  generateChecklist,
  generateChecklistMarkdown,
  getChecklistStats,
} from '../services/checklist-generator.js';
import { getParsedRFC, clearParseCache, getSourceNoteIfText } from '../services/rfc-service.js';
import { validateRFCNumber } from '../utils/validation.js';
import { findSection, collectCrossReferences } from '../utils/section.js';
import type {
  GetRFCStructureArgs,
  GetRequirementsArgs,
  GetDefinitionsArgs,
  GetDependenciesArgs,
  GenerateChecklistArgs,
  ValidateStatementArgs,
  RequirementLevel,
  ContentBlock,
} from '../types/index.js';
import { matchStatement } from '../utils/statement-matcher.js';

// Re-export clearParseCache for testing
export { clearParseCache };

/**
 * Simplified section structure
 */
interface SimplifiedSection {
  number?: string;
  title: string;
  anchor?: string;
  content?: ContentBlock[];
  subsections?: SimplifiedSection[];
}

/**
 * get_rfc_structure handler
 */
export async function handleGetRFCStructure(args: GetRFCStructureArgs) {
  validateRFCNumber(args.rfc);
  const { data: parsed, source } = await getParsedRFC(args.rfc);

  // Simplify section structure
  function simplifySection(section: Section, includeContent: boolean): SimplifiedSection {
    const result: SimplifiedSection = {
      number: section.number,
      title: section.title,
      anchor: section.anchor,
    };

    if (includeContent) {
      result.content = section.content;
    }

    if (section.subsections?.length > 0) {
      result.subsections = section.subsections.map((s: Section) =>
        simplifySection(s, includeContent)
      );
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
    _sourceNote: getSourceNoteIfText(source, 'structure'),
  };
}

/**
 * get_requirements handler
 */
export async function handleGetRequirements(args: GetRequirementsArgs) {
  validateRFCNumber(args.rfc);
  const { data: parsed, source } = await getParsedRFC(args.rfc);

  const requirements = extractRequirements(parsed.sections, {
    section: args.section,
    level: args.level as RequirementLevel,
  });

  // Statistics
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
    _sourceNote: getSourceNoteIfText(source, 'requirements'),
  };
}

/**
 * get_definitions handler
 */
export async function handleGetDefinitions(args: GetDefinitionsArgs) {
  validateRFCNumber(args.rfc);
  const { data: parsed, source } = await getParsedRFC(args.rfc);

  let definitions = parsed.definitions;

  // Filter by term
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
    _sourceNote: getSourceNoteIfText(source, 'definitions'),
  };
}

/**
 * Dependencies result type
 */
interface DependencyResult {
  rfc: number;
  normative: Array<{ rfcNumber?: number; title: string; anchor: string }>;
  informative: Array<{ rfcNumber?: number; title: string; anchor: string }>;
  _source: 'xml' | 'text';
  _sourceNote?: string;
  referencedBy?: never[];
  _note?: string;
}

/**
 * get_rfc_dependencies handler
 */
export async function handleGetDependencies(args: GetDependenciesArgs): Promise<DependencyResult> {
  validateRFCNumber(args.rfc);
  const { data: parsed, source } = await getParsedRFC(args.rfc);

  const result: DependencyResult = {
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

  // Text source cannot extract reference information
  result._sourceNote = getSourceNoteIfText(source, 'dependencies');

  // TODO: Get referencedBy from IETF Datatracker API
  if (args.includeReferencedBy) {
    result.referencedBy = [];
    result._note = 'referencedBy is not implemented (requires IETF Datatracker API integration)';
  }

  return result;
}

/**
 * get_related_sections handler
 */
export async function handleGetRelatedSections(args: { rfc: number; section: string }) {
  validateRFCNumber(args.rfc);
  const { data: parsed, source } = await getParsedRFC(args.rfc);

  const targetSection = findSection(parsed.sections, args.section);
  if (!targetSection) {
    return {
      error: `Section ${args.section} not found`,
    };
  }

  // Collect cross-references using utility
  const relatedSections = collectCrossReferences(targetSection);

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
    _sourceNote: getSourceNoteIfText(source, 'sections'),
  };
}

/**
 * generate_checklist handler
 */
export async function handleGenerateChecklist(args: GenerateChecklistArgs) {
  validateRFCNumber(args.rfc);
  const { data: parsed, source } = await getParsedRFC(args.rfc);
  const requirements = extractRequirements(parsed.sections, {
    sections: args.sections,
    includeSubsections: args.includeSubsections !== false, // デフォルト true
  });

  // Generate checklist using service
  const checklist = generateChecklist(args.rfc, parsed.metadata.title, requirements, args.role);

  // Generate Markdown
  const markdown = generateChecklistMarkdown(checklist);
  const stats = getChecklistStats(checklist);

  return {
    rfc: args.rfc,
    role: args.role || 'both',
    stats,
    markdown,
    _source: source,
    _sourceNote: getSourceNoteIfText(source, 'checklist'),
  };
}

/**
 * validate_statement handler
 * Uses weighted keyword matching for better precision
 */
export async function handleValidateStatement(args: ValidateStatementArgs) {
  validateRFCNumber(args.rfc);
  const { data: parsed, source } = await getParsedRFC(args.rfc);
  const requirements = extractRequirements(parsed.sections);

  // Use weighted matching
  const { matches, conflicts, statementLevel, statementSubject } = matchStatement(
    args.statement,
    requirements,
    { maxResults: 10 }
  );

  // Build suggestions
  const suggestions: string[] = [];
  if (matches.length === 0) {
    suggestions.push('No matching requirements found. Try different keywords.');
  }
  if (conflicts.length > 0) {
    suggestions.push(
      'Potential conflicts detected. Review the requirement levels (MUST/SHOULD/MAY) carefully.'
    );
  }
  if (statementLevel && !statementSubject) {
    suggestions.push(
      'Consider specifying the subject (e.g., "client", "server") for better matching.'
    );
  }

  return {
    rfc: args.rfc,
    statement: args.statement,
    analysis: {
      detectedLevel: statementLevel,
      detectedSubject: statementSubject,
    },
    isValid: conflicts.length === 0,
    matchingRequirements: matches.map((m) => ({
      ...m.requirement,
      _matchScore: m.score,
      _matchedKeywords: m.matchedKeywords,
      _subjectMatch: m.subjectMatch,
      _levelMatch: m.levelMatch,
    })),
    conflicts: conflicts.map((c) => ({
      requirement: c.requirement,
      reason: c.reason,
    })),
    suggestions: suggestions.length > 0 ? suggestions : undefined,
    _source: source,
    _sourceNote: getSourceNoteIfText(source, 'validation'),
  };
}

/**
 * Tool handlers map
 * Note: Using 'unknown' for args type as each handler has specific type requirements
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toolHandlers: Record<string, (args: any) => Promise<unknown>> = {
  get_rfc_structure: handleGetRFCStructure,
  get_requirements: handleGetRequirements,
  get_definitions: handleGetDefinitions,
  get_rfc_dependencies: handleGetDependencies,
  get_related_sections: handleGetRelatedSections,
  generate_checklist: handleGenerateChecklist,
  validate_statement: handleValidateStatement,
};
