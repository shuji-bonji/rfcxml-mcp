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
    /**
     * 本文から取れた題名。テキスト経路では取れないことがあるため任意。
     * 取れなかったときは Datatracker のタイトルへ落とす（`handlers.ts`）。
     */
    title?: string;
    docName?: string;
    number?: number;
    /**
     * 公開年月（`YYYY-MM`、日付まで判る場合は `YYYY-MM-DD`）。
     * RFCXML の `front/date`、テキスト経路ではヘッダ行から取る。
     * Datatracker の `document.time` はレコードの更新時刻であって公開日ではない。
     */
    date?: string;
    /**
     * 本文の著者欄に並ぶ姓を、印字されている順で並べたもの。
     *
     * Datatracker の `documentauthor.order` は、古い RFC では本文の並びと
     * 食い違う。RFC 6455 の本文は `I. Fette` / `A. Melnikov` の順に印字するが、
     * API の `order` は 0=Melnikov、1=Fette である。並べ替えにだけ使う。
     */
    authorOrder?: string[];
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
  /**
   * Datatracker のレコード最終更新時刻（`document.time`）。
   * **公開日ではない**。RFC 9293 はこの値が 2026-05-20 になるが、公開は 2022-08。
   * 公開日は本文（RFCXML の `front/date` / テキストのヘッダ）から取る。
   */
  datatrackerUpdated: string;
  /**
   * Datatracker の `std_level` / `stream` から引いた値。
   * **API に届かなかったとき、または対応表に無い値のときは付けない。**
   * v0.6.52 までは `'info'` / `'IETF'` を既定値にしていたため、RFC 1
   * （Datatracker は `unkn` / `legacy`）が info / IETF として返っていた。
   */
  category?: 'std' | 'bcp' | 'info' | 'exp' | 'historic';
  stream?: 'IETF' | 'IAB' | 'IRTF' | 'independent' | 'editorial';
  /**
   * Datatracker の document API に届かなかったときの理由（`HTTP 500` など）。
   * 付いているときは `category` / `stream` / `abstract` が無い。
   * `get_rfc_structure` はこれを `_sourceNote` に書く。
   */
  datatrackerError?: string;
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
  referencedBy?: ReferencedByEntry[];
}

export interface ReferencedByEntry {
  rfcNumber: number;
  name: string;
  relationship: 'refnorm' | 'refinfo';
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
  includeAuthors?: boolean;
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
  /**
   * 判定結果。`null` は「判断できるだけの一致が無かった」を表す。
   * `true` を準拠の証明として扱わないこと（本サーバは適合判定器ではない）。
   */
  isValid: boolean | null;
  matchingRequirements: Requirement[];
  conflicts: Requirement[];
  suggestions?: string[];
}
