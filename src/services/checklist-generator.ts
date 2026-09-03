/**
 * チェックリスト生成サービス
 * RFC要件からMarkdownチェックリストを生成
 */

import type { Requirement, ImplementationChecklist, ChecklistItem } from '../types/index.js';

/**
 * 要件をレベル別に分類
 */
export interface ClassifiedRequirements {
  must: Requirement[];
  should: Requirement[];
  may: Requirement[];
}

/**
 * 要件をMUST/SHOULD/MAYに分類
 */
export function classifyRequirements(requirements: Requirement[]): ClassifiedRequirements {
  const must = requirements.filter((r) =>
    ['MUST', 'MUST NOT', 'REQUIRED', 'SHALL', 'SHALL NOT'].includes(r.level)
  );
  const should = requirements.filter((r) =>
    ['SHOULD', 'SHOULD NOT', 'RECOMMENDED', 'NOT RECOMMENDED'].includes(r.level)
  );
  const may = requirements.filter((r) => ['MAY', 'OPTIONAL'].includes(r.level));

  return { must, should, may };
}

/**
 * ロールでフィルタリング
 */
export function filterByRole(
  requirements: Requirement[],
  role?: 'client' | 'server' | 'both'
): Requirement[] {
  if (!role || role === 'both') {
    return requirements;
  }

  return requirements.filter((r) => {
    // 主語が取れないときは要件文そのものを見る。主語だけを見ていたため
    // `role: "client"` に「サーバの話だけを書いた要件」が 865 件（8.9%）
    // 残っていた（RFC 64 本・要件 9,684 件）。
    const subject = r.subject?.toLowerCase() ?? '';
    const haystack = subject || (r.text ?? '').toLowerCase();

    // 複数形も見る。`\bserver\b` は "servers" に当たらない。実測（RFC 64 本・
    // 要件 9,684 件）で、複数形だけで役割を書く要件が 449 件（4.6%）あり、
    // どちらの role にも残っていた。
    const mentionsClient = /\bclients?\b|\buser agents?\b/.test(haystack);
    const mentionsServer = /\bservers?\b|\bproxy\b|\bproxies\b|\bgateways?\b/.test(haystack);

    // どちらにも触れないものは、どちらの実装にも関わりうるので残す
    if (!mentionsClient && !mentionsServer) return true;

    return role === 'client' ? mentionsClient : mentionsServer;
  });
}

/**
 * チェックリストアイテムを作成
 */
function createChecklistItems(requirements: Requirement[]): ChecklistItem[] {
  return requirements.map((r) => ({
    id: r.id,
    requirement: r,
    checked: false,
  }));
}

/**
 * チェックリストを生成
 */
export function generateChecklist(
  rfcNumber: number,
  title: string,
  requirements: Requirement[],
  role?: 'client' | 'server' | 'both'
): ImplementationChecklist {
  const filtered = filterByRole(requirements, role);
  const classified = classifyRequirements(filtered);

  return {
    rfc: rfcNumber,
    title,
    role,
    must: createChecklistItems(classified.must),
    should: createChecklistItems(classified.should),
    may: createChecklistItems(classified.may),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * チェックリストの 1 行を組み立てる。
 *
 * 要件レベルを行に出す。1 つの文が MUST と MUST NOT の両方を含むとき
 * （RFC 6455 §5.3 の "the masking key MUST be derived from a strong source of
 * entropy, and the masking key for a given frame MUST NOT make it simple …"）、
 * 要件は 2 件立つが文は同一である。v0.6.5 までは同じ行が 2 度並び、どちらの語に
 * ついての項目なのか読み取れなかった。
 */
function renderChecklistItem(item: ChecklistItem): string {
  const { level, section } = item.requirement;
  return `- [ ] **${level}** ${withAntecedent(item.requirement)} (§${section})`;
}

/**
 * 指示語で始まる要件文に、直前の文を足す。
 *
 * チェックリストはレベルごとに並べ替えるので、原文で隣にあった文が離れる。
 * RFC 6455 §4.1 の
 *
 * > The request MAY include a header field with the name |Sec-WebSocket-Protocol|.
 * > **The elements that comprise this value MUST be non-empty strings** …
 *
 * は、前の文が MAY・この文が MUST なので、チェックリストでは別の節に分かれる。
 * **「この値」が何を指すのか読めなくなる。** RFC 9110 §7.1 の
 * `These forms MUST NOT be used with other methods.` も同じで、
 * 「これらの形式」が何かは前の文にある。
 *
 * 実測（RFC 67 本・要件 9,870 件）: 指示語で始まる要件は 57 件。
 *
 * 要件文そのもの（`text`）は書き換えない。RFC が書いた通りの文であり、
 * 前の文を足すのは読み手のための編集だからである。ここは表示だけを直す。
 */
function withAntecedent(requirement: Requirement): string {
  const text = requirement.text.trim();
  if (!DEICTIC_OPENER.test(text)) return text;

  const context = requirement.fullContext ?? '';
  const at = context.indexOf(text);
  if (at <= 0) return text;

  const before = context.slice(0, at).trim();
  const previous = lastSentence(before);
  if (!previous || previous.length > ANTECEDENT_MAX_LENGTH) return text;
  // 案内の文を足しても指すものは分からない。RFC 9110 §7.1 の
  // `These forms MUST NOT be used with other methods.` の直前は
  // "See the respective method definitions for details." で、指すものは
  // さらに前の段落にある。足さずに、そのまま出す。
  if (POINTER_SENTENCE.test(previous)) return text;

  return `${previous} ${text}`;
}

/** 直前の 1 文を返す。取れなければ空文字。 */
function lastSentence(text: string): string {
  const parts = text.split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 0);
  return parts.length > 0 ? parts[parts.length - 1].trim() : '';
}

/**
 * 指示語・接続表現で始まる書き出し。これで始まる文は、単独では何を指すか読めない。
 *
 * `Otherwise, the recipient SHOULD process the Range header field as requested.`
 * は、何でなければそうするのかが前の文にある（RFC 9110 §13.1.5）。
 * 実測（RFC 67 本）: 指示語 50 件、接続表現 76 件。
 */
const DEICTIC_OPENER =
  /^(?:The (?:value|elements|contents|format|length|meaning|syntax|name|type|order|result)s?\s+(?:of\s+)?(?:that|this|these|those|it|its)\b|This\s+(?:value|field|header|parameter|option|attribute|element|version|rule|requirement)\b|These\s+(?:values|fields|elements|forms|rules)\b|Such\b|To do so\b|In (?:this|that|such) cases?\b|In this case\b|Otherwise\b|To that end\b|If so\b)/i;

/** 案内だけの文。足しても指すものが分からない。 */
const POINTER_SENTENCE = /^(?:See|Refer|For (?:more|further|details|the)|Note that)\b/i;

/** 足す前の文の長さの上限。長い文を足すと、項目が読めなくなる。 */
const ANTECEDENT_MAX_LENGTH = 200;

/**
 * 同じ行が 2 度出ないようにする。
 *
 * レベルを行に出したことで、上記の MUST / MUST NOT は別の行になる。ここで落ちるのは
 * レベルも節も文も同じ行だけで、それは同じ要件である。
 */
function renderChecklistItems(items: ChecklistItem[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const item of items) {
    const line = renderChecklistItem(item);
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }

  return lines;
}

/**
 * チェックリストをMarkdown形式で出力
 */
export function generateChecklistMarkdown(checklist: ImplementationChecklist): string {
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
    lines.push(...renderChecklistItems(checklist.must));
    lines.push('');
  }

  if (checklist.should.length > 0) {
    lines.push('## Recommended Requirements (SHOULD / RECOMMENDED)');
    lines.push('');
    lines.push(...renderChecklistItems(checklist.should));
    lines.push('');
  }

  if (checklist.may.length > 0) {
    lines.push('## Optional Requirements (MAY / OPTIONAL)');
    lines.push('');
    lines.push(...renderChecklistItems(checklist.may));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * チェックリスト統計
 */
export interface ChecklistStats {
  must: number;
  should: number;
  may: number;
  total: number;
}

/**
 * チェックリストの統計情報を取得
 */
export function getChecklistStats(checklist: ImplementationChecklist): ChecklistStats {
  return {
    must: checklist.must.length,
    should: checklist.should.length,
    may: checklist.may.length,
    total: checklist.must.length + checklist.should.length + checklist.may.length,
  };
}
