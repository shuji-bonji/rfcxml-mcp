/**
 * MCP Tool Handlers
 */

import { fetchRFCXML, fetchRFCText, RFCXMLNotAvailableError } from '../services/rfc-fetcher.js';
import {
  parseRFCXML,
  extractRequirements,
  type ParsedRFC,
  type Section,
} from '../services/rfcxml-parser.js';
import { parseRFCText } from '../services/rfc-text-parser.js';
import { LRUCache } from '../utils/cache.js';
import { validateRFCNumber } from '../utils/validation.js';
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
  ContentBlock,
} from '../types/index.js';

/**
 * Source note context types
 */
type SourceNoteContext =
  | 'structure'
  | 'requirements'
  | 'definitions'
  | 'sections'
  | 'checklist'
  | 'validation'
  | 'dependencies';

/**
 * Get source note for text-based parsing
 */
function getTextSourceNote(context: SourceNoteContext): string {
  const notes: Record<SourceNoteContext, string> = {
    structure: 'Parsed from text format. Accuracy may be limited.',
    requirements: 'Parsed from text format. Requirement extraction accuracy may be limited.',
    definitions: 'Parsed from text format. Definition extraction accuracy may be limited.',
    sections: 'Parsed from text format. Related section accuracy may be limited.',
    checklist: 'Parsed from text format. Checklist accuracy may be limited.',
    validation: 'Parsed from text format. Validation accuracy may be limited.',
    dependencies: 'Parsed from text format. Reference information is not available.',
  };
  return `Warning: ${notes[context]}`;
}

/**
 * Parsed RFC with source information
 */
interface ParsedRFCWithSource {
  data: ParsedRFC;
  source: 'xml' | 'text';
}

/**
 * Parsed RFC cache (main cache)
 * Parsing is CPU-intensive, so we cache the results
 */
const parseCache = new LRUCache<number, ParsedRFCWithSource>(CACHE_CONFIG.parsed);

/**
 * Clear parse cache (for testing)
 */
export function clearParseCache(): void {
  parseCache.clear();
}

/**
 * Fetch and parse RFCXML (with cache and fallback support)
 */
async function getParsedRFC(rfcNumber: number): Promise<ParsedRFCWithSource> {
  const cached = parseCache.get(rfcNumber);
  if (cached) {
    return cached;
  }

  // Try XML first
  try {
    const xml = await fetchRFCXML(rfcNumber);
    const parsed = parseRFCXML(xml);
    const result: ParsedRFCWithSource = { data: parsed, source: 'xml' };
    parseCache.set(rfcNumber, result);
    return result;
  } catch (xmlError) {
    // XML fetch failed -> text fallback
    if (xmlError instanceof RFCXMLNotAvailableError && xmlError.isOldRFC) {
      console.error(`[RFC ${rfcNumber}] XML not available, trying text fallback...`);
      try {
        const text = await fetchRFCText(rfcNumber);
        const parsed = parseRFCText(text, rfcNumber);
        const result: ParsedRFCWithSource = { data: parsed, source: 'text' };
        parseCache.set(rfcNumber, result);
        return result;
      } catch (textError) {
        // Text also failed
        throw new Error(
          `Failed to fetch RFC ${rfcNumber}.\n` +
            `XML: ${xmlError.message}\n` +
            `Text: ${textError instanceof Error ? textError.message : String(textError)}`
        );
      }
    }
    // For newer RFCs, propagate the error as-is
    throw xmlError;
  }
}

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
    _sourceNote: source === 'text' ? getTextSourceNote('structure') : undefined,
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
    _sourceNote: source === 'text' ? getTextSourceNote('requirements') : undefined,
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
    _sourceNote: source === 'text' ? getTextSourceNote('definitions') : undefined,
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
  if (source === 'text') {
    result._sourceNote = getTextSourceNote('dependencies');
  }

  // TODO: Get referencedBy from IETF Datatracker API
  if (args.includeReferencedBy) {
    result.referencedBy = [];
    result._note = 'referencedBy is not implemented (requires IETF Datatracker API integration)';
  }

  return result;
}

/**
 * Normalize section number (section-3.5 -> 3.5)
 */
function normalizeSectionNumber(sectionId: string): string {
  return sectionId.replace(/^section-/, '');
}

/**
 * Find section (supports multiple formats)
 */
function findSection(sections: Section[], target: string): Section | null {
  const normalizedTarget = normalizeSectionNumber(target);

  for (const sec of sections) {
    // Try matching each format
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

  // Collect cross-references
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
    _sourceNote: source === 'text' ? getTextSourceNote('sections') : undefined,
  };
}

/**
 * generate_checklist handler
 */
export async function handleGenerateChecklist(args: GenerateChecklistArgs) {
  validateRFCNumber(args.rfc);
  const { data: parsed, source } = await getParsedRFC(args.rfc);
  const requirements = extractRequirements(parsed.sections, {
    section: args.sections?.[0],
  });

  // Filter by role (simple implementation based on subject)
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

  // Classify by level
  const must = filteredReqs.filter((r) =>
    ['MUST', 'MUST NOT', 'REQUIRED', 'SHALL', 'SHALL NOT'].includes(r.level)
  );
  const should = filteredReqs.filter((r) =>
    ['SHOULD', 'SHOULD NOT', 'RECOMMENDED', 'NOT RECOMMENDED'].includes(r.level)
  );
  const may = filteredReqs.filter((r) => ['MAY', 'OPTIONAL'].includes(r.level));

  // Generate Markdown
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
    _sourceNote: source === 'text' ? getTextSourceNote('checklist') : undefined,
  };
}

/**
 * Generate checklist Markdown
 */
function generateChecklistMarkdown(checklist: ImplementationChecklist): string {
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
 * validate_statement handler
 */
export async function handleValidateStatement(args: ValidateStatementArgs) {
  validateRFCNumber(args.rfc);
  const { data: parsed, source } = await getParsedRFC(args.rfc);
  const requirements = extractRequirements(parsed.sections);

  // Simple keyword matching
  const statementLower = args.statement.toLowerCase();
  const keywords = statementLower.split(/\s+/).filter((w) => w.length > 3);

  const matchingRequirements = requirements.filter((req) => {
    const reqText = (req.text + ' ' + req.fullContext).toLowerCase();
    return keywords.some((kw) => reqText.includes(kw));
  });

  // Conflict detection (simple version)
  const conflicts: Requirement[] = [];
  // TODO: More advanced conflict detection logic

  return {
    rfc: args.rfc,
    statement: args.statement,
    isValid: conflicts.length === 0,
    matchingRequirements: matchingRequirements.slice(0, 10), // Top 10
    conflicts,
    suggestions:
      matchingRequirements.length === 0
        ? ['No matching requirements found. Try different keywords.']
        : undefined,
    _source: source,
    _sourceNote: source === 'text' ? getTextSourceNote('validation') : undefined,
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
