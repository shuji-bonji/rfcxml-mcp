/**
 * RFCXML MCP 型定義
 */

// ========================================
// パース済みRFC構造
// ========================================

/**
 * パース済みRFCドキュメント構造
 * XMLとテキストパーサー共通のインターフェース
 */
export interface ParsedRFC {
  metadata: {
    title: string;
    docName?: string;
    number?: number;
  };
  sections: Section[];
  references: {
    normative: RFCReference[];
    informative: RFCReference[];
  };
  definitions: Definition[];
}

// ========================================
// RFC メタデータ
// ========================================

export interface RFCMetadata {
  number: number;
  title: string;
  authors: Author[];
  date: string;
  category: 'std' | 'bcp' | 'info' | 'exp' | 'historic';
  stream: 'IETF' | 'IAB' | 'IRTF' | 'independent' | 'editorial';
  abstract?: string;
  keywords?: string[];
  obsoletes?: number[];
  updates?: number[];
  updatedBy?: number[];
  obsoletedBy?: number[];
}

export interface Author {
  fullname: string;
  initials?: string;
  surname?: string;
  organization?: string;
  email?: string;
}

// ========================================
// セクション構造
// ========================================

export interface Section {
  anchor?: string;
  number?: string;
  title: string;
  content: ContentBlock[];
  subsections: Section[];
}

export type ContentBlock = TextBlock | ListBlock | SourceCodeBlock | ArtworkBlock | TableBlock;

export interface TextBlock {
  type: 'text';
  content: string;
  requirements: RequirementMarker[];
  crossReferences: CrossReference[];
}

export interface ListBlock {
  type: 'list';
  style: 'symbols' | 'numbers' | 'letters' | 'hanging';
  items: ListItem[];
}

export interface ListItem {
  content: string;
  requirements: RequirementMarker[];
}

export interface SourceCodeBlock {
  type: 'sourcecode';
  language?: string;
  content: string;
}

export interface ArtworkBlock {
  type: 'artwork';
  content: string;
}

export interface TableBlock {
  type: 'table';
  headers: string[];
  rows: string[][];
}

// ========================================
// 規範性要件（BCP 14 / RFC 2119）
// ========================================

export type RequirementLevel =
  | 'MUST'
  | 'MUST NOT'
  | 'REQUIRED'
  | 'SHALL'
  | 'SHALL NOT'
  | 'SHOULD'
  | 'SHOULD NOT'
  | 'RECOMMENDED'
  | 'NOT RECOMMENDED'
  | 'MAY'
  | 'OPTIONAL';

export interface RequirementMarker {
  level: RequirementLevel;
  position: number; // 文字位置
}

export interface Requirement {
  id: string;
  level: RequirementLevel;
  text: string;
  subject?: string;
  action?: string;
  condition?: string;
  exception?: string;
  section: string;
  sectionTitle: string;
  fullContext: string;
}

// ========================================
// 参照・依存関係
// ========================================

export interface CrossReference {
  target: string;
  type: 'rfc' | 'section' | 'figure' | 'table' | 'external';
  section?: string;
  displayText?: string;
}

export interface RFCReference {
  anchor: string;
  type: 'normative' | 'informative';
  rfcNumber?: number;
  draftName?: string;
  title: string;
  authors?: string[];
  date?: string;
  target?: string;
}

export interface DependencyGraph {
  rfc: number;
  normative: RFCDependency[];
  informative: RFCDependency[];
  referencedBy?: RFCDependency[];
}

export interface RFCDependency {
  number: number;
  title: string;
  relationship: 'references' | 'obsoletes' | 'updates';
}

// ========================================
// 定義
// ========================================

export interface Definition {
  term: string;
  definition: string;
  section: string;
  aliases?: string[];
}

// ========================================
// チェックリスト
// ========================================

export interface ChecklistItem {
  id: string;
  requirement: Requirement;
  checked: boolean;
  notes?: string;
}

export interface ImplementationChecklist {
  rfc: number;
  title: string;
  role?: 'client' | 'server' | 'both';
  must: ChecklistItem[];
  should: ChecklistItem[];
  may: ChecklistItem[];
  generatedAt: string;
}

// ========================================
// ツール引数・結果
// ========================================

export interface GetRFCStructureArgs {
  rfc: number;
  includeContent?: boolean;
}

export interface GetRequirementsArgs {
  rfc: number;
  section?: string;
  level?: RequirementLevel;
}

export interface GetDefinitionsArgs {
  rfc: number;
  term?: string;
}

export interface GetDependenciesArgs {
  rfc: number;
  includeReferencedBy?: boolean;
}

export interface GenerateChecklistArgs {
  rfc: number;
  role?: 'client' | 'server' | 'both';
  sections?: string[];
  includeSubsections?: boolean;
}

export interface ValidateStatementArgs {
  rfc: number;
  statement: string;
}

export interface ValidationResult {
  isValid: boolean;
  matchingRequirements: Requirement[];
  conflicts: Requirement[];
  suggestions?: string[];
}
