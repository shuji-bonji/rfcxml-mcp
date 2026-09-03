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
import { fetchRFCMetadata, fetchReferencedBy, fetchReferences } from '../services/rfc-fetcher.js';
import { validateRFCNumber } from '../utils/validation.js';
import { findSection, collectCrossReferences, normalizeSectionNumber } from '../utils/section.js';
import type {
  GetRFCStructureArgs,
  GetRequirementsArgs,
  GetDefinitionsArgs,
  GetDependenciesArgs,
  GenerateChecklistArgs,
  ValidateStatementArgs,
  Requirement,
  RequirementLevel,
  ContentBlock,
  ReferencedByEntry,
} from '../types/index.js';
import {
  matchStatement,
  isSubjectTerm,
  findUndecidablePassiveProhibition,
  MATCHING_LIMITS,
} from '../utils/statement-matcher.js';

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
 * get_rfc_structure handler.
 *
 * Phase 2: enriches the metadata block by merging RFCXML body metadata with
 * Datatracker API metadata (fetched in parallel). The XML body provides
 * `title` / `docName` / `number`; the API supplies `category` / `stream` /
 * `date` / `abstract`, and optionally `authors` when `includeAuthors=true`.
 *
 * The two fetches run concurrently (`Promise.all`), so the API call adds at
 * most one round-trip of latency over the previous behavior, and is free on
 * cache hits.
 */
export async function handleGetRFCStructure(args: GetRFCStructureArgs) {
  validateRFCNumber(args.rfc);

  const [parsedResult, apiMetadata] = await Promise.all([
    getParsedRFC(args.rfc),
    // API metadata is best-effort: failures already fall back to a minimal
    // shape inside fetchRFCMetadata, so this never rejects.
    fetchRFCMetadata(args.rfc, { includeAuthors: args.includeAuthors === true }),
  ]);
  const { data: parsed, source } = parsedResult;

  // Simplify section structure
  function simplifySection(section: Section, includeContent: boolean): SimplifiedSection {
    const result: SimplifiedSection = {
      // RFCXML の `pn`（"section-6.2.3"）ではなく、RFC が印字する節番号を返す。
      number: section.number ? normalizeSectionNumber(section.number) : section.number,
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

  // Merge: prefer XML body for title/docName/number (authoritative for the
  // RFC body), fold in API-derived fields. Authors only included when
  // includeAuthors=true (otherwise the API fetch returned [] anyway).
  const mergedMetadata: Record<string, unknown> = {
    ...parsed.metadata,
    number: parsed.metadata.number ?? args.rfc,
    title: parsed.metadata.title || apiMetadata.title,
    category: apiMetadata.category,
    stream: apiMetadata.stream,
    // 公開日は本文（RFCXML の front/date、テキストではヘッダ行）から取る。
    // Datatracker の document.time はレコードの更新時刻であって公開日ではない。
    date: parsed.metadata.date,
    abstract: apiMetadata.abstract,
  };
  if (apiMetadata.authors.length > 0) {
    mergedMetadata.authors = apiMetadata.authors;
  }

  return {
    metadata: mergedMetadata,
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
  /** Where the RFC body came from (xml or text fallback). */
  _source: 'xml' | 'text';
  /**
   * Where the references in this response actually came from.
   *  - 'xml'  : extracted from RFCXML `<references>` (full anchor/title)
   *  - 'text' : extracted from the plain-text RFC body's References section
   *             (rfcNumber + placeholder title; anchor like "RFC2119")
   *  - 'api'  : fetched from Datatracker `relateddocument` API (rfcNumber +
   *             placeholder title; used when XML is unavailable AND the API
   *             call succeeds)
   *
   * The previous v0.5.1 type was `'xml' | 'api'` which incorrectly reported
   * `'xml'` when refs were actually salvaged from the text-format parser.
   */
  _referencesSource: 'xml' | 'text' | 'api';
  _sourceNote?: string;
  referencedBy?: ReferencedByEntry[];
}

/**
 * get_rfc_dependencies handler.
 *
 * Reference resolution strategy:
 *  1. XML body with refs            → use XML refs       (`_referencesSource: 'xml'`)
 *  2. text body with refs           → use text refs      (`_referencesSource: 'text'`)
 *     (only attempts API fallback if text refs are empty, so we don't lose
 *     the more accurate body-derived data when the API is reachable but
 *     redundant)
 *  3. empty refs from body          → try Datatracker API
 *     - API hit                     → use API refs       (`_referencesSource: 'api'`)
 *     - API miss / failure          → keep empty (`_referencesSource` reflects
 *                                     body source) and emit `_sourceNote`
 *  4. The API entries don't carry titles/anchors, so we synthesize stub
 *     entries (`title: 'RFC N'`, `anchor: 'RFCN'`). Callers wanting full
 *     metadata should call `get_rfc_structure` on each target.
 *
 * `_sourceNote` is only emitted when the result is genuinely degraded (empty
 * refs after exhausting all sources). Previously v0.5.1 emitted a "not
 * available" warning even when text-parsed refs were present and accurate.
 */
export async function handleGetDependencies(args: GetDependenciesArgs): Promise<DependencyResult> {
  validateRFCNumber(args.rfc);
  const { data: parsed, source } = await getParsedRFC(args.rfc);

  const bodyNormative = parsed.references.normative.map((ref) => ({
    rfcNumber: ref.rfcNumber,
    title: ref.title,
    anchor: ref.anchor,
  }));
  const bodyInformative = parsed.references.informative.map((ref) => ({
    rfcNumber: ref.rfcNumber,
    title: ref.title,
    anchor: ref.anchor,
  }));
  const bodyHasRefs = bodyNormative.length + bodyInformative.length > 0;

  let normative = bodyNormative;
  let informative = bodyInformative;
  // Default reflects the actual origin of `normative` / `informative`:
  // they came from `parsed.references`, which is xml or text depending on
  // `source`. Only flip to 'api' when API fallback successfully replaces them.
  let referencesSource: 'xml' | 'text' | 'api' = source;
  let sourceNote: string | undefined;

  if (!bodyHasRefs) {
    // Body had no references — try the Datatracker API as a last resort.
    const apiRefs = await fetchReferences(args.rfc);
    if (apiRefs.length > 0) {
      normative = apiRefs
        .filter((r) => r.relationship === 'refnorm')
        .map((r) => ({ rfcNumber: r.rfcNumber, title: `RFC ${r.rfcNumber}`, anchor: r.name }));
      informative = apiRefs
        .filter((r) => r.relationship === 'refinfo')
        .map((r) => ({ rfcNumber: r.rfcNumber, title: `RFC ${r.rfcNumber}`, anchor: r.name }));
      referencesSource = 'api';
      sourceNote =
        'References fetched from IETF Datatracker API. Titles/anchors are placeholders; call get_rfc_structure on each target for details.';
    } else {
      // Genuinely empty: communicate the limitation honestly.
      sourceNote =
        source === 'text'
          ? 'References could not be extracted from text format and were not available via Datatracker API.'
          : 'No references extracted; the RFC may not have a References section.';
    }
  } else if (source === 'text' && normative.length === 0) {
    // v0.6.6 から、テキスト経路も参考文献の欄から題名とアンカーを取る。
    // 「題名は仮置き」という注記は事実に反するので出さない。
    //
    // 残る制約は 1 つだけである。規範的参照の欄が見つからなかったとき
    // （RFC 2616 のように参考文献の欄が 1 つしかない RFC）、テキストには
    // 規範性の印が無いため、すべて informative に入る。そのときだけ注記する。
    sourceNote =
      'This RFC has a single References section in the text, so every reference is reported as informative. The text carries no normative/informative marking.';
  }

  const result: DependencyResult = {
    rfc: args.rfc,
    normative,
    informative,
    _source: source,
    _referencesSource: referencesSource,
  };
  if (sourceNote) result._sourceNote = sourceNote;

  // Fetch RFCs that reference this RFC from IETF Datatracker API.
  if (args.includeReferencedBy) {
    result.referencedBy = await fetchReferencedBy(args.rfc);
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
  const checklist = generateChecklist(
    args.rfc,
    parsed.metadata.title ?? `RFC ${args.rfc}`,
    requirements,
    args.role
  );

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

/** 長い引用を切る。要求アクションは 1 文まるごとのことがある。 */
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/**
 * `isValid` が `null` のときに、なぜ判断しなかったかを返す。
 *
 * 理由は 2 つあり、意味が違う。一致が弱くて判断できないのか、一致はあるが
 * 受動態で書かれていて実行者を照合できないのか。前者の文言を後者にも出すと、
 * 一致している要件が `matchingRequirements` の先頭にあるのに「一致が無い」と
 * 読める。
 */
function verdictNote(isValid: boolean | null, undecidable: Requirement | null): string | undefined {
  if (isValid !== null) return undefined;
  if (undecidable) {
    return `isValid is null: requirement ${undecidable.id} forbids this in the passive voice, so who performs the act cannot be matched. Read that requirement and decide. This is not a statement of compliance.`;
  }
  return 'isValid is null: no requirement matched strongly enough to judge. This is not a statement of compliance.';
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

  // 判定を下してよいだけの根拠があるか。
  // 一致が無い、または最上位の一致が弱いときは true/false を主張しない。
  const topMatch = matches.length > 0 ? matches[0] : undefined;
  const topScore = topMatch?.score ?? 0;
  // 主語だけの一致では判定しない。何を論じているかを示す語を別に求める。
  const contentKeywords = (topMatch?.matchedKeywords ?? []).filter((k) => !isSubjectTerm(k));
  const hasVerdictEvidence =
    topScore >= MATCHING_LIMITS.MIN_SCORE_FOR_VERDICT &&
    contentKeywords.length >= MATCHING_LIMITS.MIN_CONTENT_KEYWORDS_FOR_VERDICT;
  // 受動態で書かれた禁止（"MUST NOT be used"）は、矛盾検出が行為の実行者を
  // 見つけられない。conflicts が空のまま true を返すと、違反している文に
  // 「矛盾なし」と答えることになる。該当したら判断を取り下げる。
  const undecidable =
    hasVerdictEvidence && conflicts.length === 0
      ? findUndecidablePassiveProhibition(args.statement, matches)
      : null;
  const isValid: boolean | null =
    hasVerdictEvidence && !undecidable ? conflicts.length === 0 : null;

  // Build suggestions
  const suggestions: string[] = [];
  if (matches.length === 0) {
    suggestions.push(
      "No matching requirements found. Matching is English keyword based; try the RFC's own wording."
    );
  } else if (!hasVerdictEvidence) {
    suggestions.push(
      'Matches are too weak to judge. Name the subject (e.g., "client", "server") and what it does, using the RFC\'s own nouns and verbs.'
    );
  }
  if (conflicts.length > 0) {
    suggestions.push(
      'Potential conflicts detected. Review the requirement levels (MUST/SHOULD/MAY) carefully.'
    );
  }
  if (undecidable) {
    suggestions.push(
      `Cannot judge: requirement ${undecidable.id} is written in the passive voice ("${undecidable.level} ${clip(undecidable.action ?? '', 60)}"), so the text names no actor. Read that requirement and decide.`
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
    isValid,
    _verdictNote: verdictNote(isValid, undecidable),
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
