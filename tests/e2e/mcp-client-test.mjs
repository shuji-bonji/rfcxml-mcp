/**
 * RFCXML MCP E2E Test Suite
 *
 * MCP SDK v2 の Client を使い、stdio トランスポート経由で
 * rfcxml-mcp サーバーの全7ツール + リソース + instructions をテストする。
 *
 * Usage:
 *   npm run test:e2e
 *
 * Prerequisites:
 *   npm run build  (dist/index.js が必要)
 */
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');

// ========================================
// Test Results Management
// ========================================
const results = [];

function logResult(toolName, testCase, status, details = {}) {
  const icon = status === 'PASS' ? '✅' : status === 'PARTIAL' ? '⚠️' : '❌';
  results.push({ toolName, testCase, status, details, icon });
  console.log(`${icon} [${toolName}] ${testCase}: ${status}`);
  if (details.error) console.log(`   Error: ${details.error}`);
  if (details.note) console.log(`   Note: ${details.note}`);
}

// ========================================
// MCP Client Setup
// ========================================
async function createClient() {
  const serverPath = join(PROJECT_ROOT, 'dist/index.js');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env: { ...process.env },
  });

  const client = new Client({
    name: 'rfcxml-mcp-e2e-tester',
    version: '1.0.0',
  });

  await client.connect(transport);
  return { client, transport };
}

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const textContent = result.content?.find((c) => c.type === 'text');
  if (textContent) {
    return JSON.parse(textContent.text);
  }
  throw new Error('No text content in response');
}

// ========================================
// Tool Tests
// ========================================

// 1. get_rfc_structure
async function testGetRfcStructure(client) {
  const toolName = 'get_rfc_structure';

  // 1-a: XML format (RFC 9293)
  try {
    const res = await callTool(client, toolName, { rfc: 9293, includeContent: false });
    const hasMetadata = res.metadata?.title && res.metadata?.number === 9293;
    const hasSections = res.sections?.length > 0;
    const isXml = res._source === 'xml';

    // date は公開日（2022-08）。Datatracker の time（レコード更新時刻）ではない。
    const hasPublicationDate = res.metadata?.date === '2022-08';

    if (hasMetadata && hasSections && isXml && hasPublicationDate) {
      logResult(toolName, 'RFC 9293 (XML)', 'PASS', {
        note: `${res.sections.length} sections, source=${res._source}, date=${res.metadata?.date}`,
      });
    } else {
      logResult(toolName, 'RFC 9293 (XML)', 'FAIL', {
        note: `metadata=${hasMetadata}, sections=${hasSections}, xml=${isXml}, date=${res.metadata?.date}`,
      });
    }
  } catch (e) {
    logResult(toolName, 'RFC 9293 (XML)', 'FAIL', { error: e.message });
  }

  // 1-b: Text fallback (RFC 6455)
  try {
    const res = await callTool(client, toolName, { rfc: 6455, includeContent: false });
    const hasMetadata = !!res.metadata?.title;
    const hasSections = res.sections?.length > 0;
    const isText = res._source === 'text';
    const hasWarning = !!res._sourceNote;

    if (hasMetadata && hasSections && isText && hasWarning) {
      logResult(toolName, 'RFC 6455 (text fallback)', 'PASS', {
        note: `${res.sections.length} sections, source=${res._source}, warning present`,
      });
    } else {
      logResult(toolName, 'RFC 6455 (text fallback)', 'PARTIAL', {
        note: `metadata=${hasMetadata}, sections=${hasSections}, text=${isText}, warning=${hasWarning}`,
      });
    }
  } catch (e) {
    logResult(toolName, 'RFC 6455 (text fallback)', 'FAIL', { error: e.message });
  }
}

// 2. get_requirements
async function testGetRequirements(client) {
  const toolName = 'get_requirements';

  // 2-a: XML format MUST (RFC 9293)
  try {
    const res = await callTool(client, toolName, { rfc: 9293, level: 'MUST' });
    const hasMust = res.stats?.total > 0;
    const isXml = res._source === 'xml';
    const hasStructured = res.requirements?.[0]?.section && res.requirements?.[0]?.text;

    if (hasMust && isXml && hasStructured) {
      logResult(toolName, 'RFC 9293 MUST (XML)', 'PASS', {
        note: `${res.stats.total} MUST requirements found`,
      });
    } else {
      logResult(toolName, 'RFC 9293 MUST (XML)', 'FAIL', {
        note: `count=${res.stats?.total}, xml=${isXml}, structured=${hasStructured}`,
      });
    }
  } catch (e) {
    logResult(toolName, 'RFC 9293 MUST (XML)', 'FAIL', { error: e.message });
  }

  // 2-b: Text format section filter (RFC 6455 §5.5)
  try {
    const res = await callTool(client, toolName, { rfc: 6455, level: 'MUST', section: '5.5' });
    const hasMust = res.stats?.total > 0;
    const isText = res._source === 'text';

    if (hasMust && isText) {
      logResult(toolName, 'RFC 6455 §5.5 MUST (text)', 'PASS', {
        note: `${res.stats.total} MUST requirements found`,
      });
    } else {
      logResult(toolName, 'RFC 6455 §5.5 MUST (text)', 'FAIL', {
        note: `count=${res.stats?.total}, text=${isText}`,
      });
    }
  } catch (e) {
    logResult(toolName, 'RFC 6455 §5.5 MUST (text)', 'FAIL', { error: e.message });
  }

  // 2-c: All levels (RFC 9293)
  try {
    const res = await callTool(client, toolName, { rfc: 9293 });
    const hasMultipleLevels = Object.keys(res.stats?.byLevel || {}).length > 1;

    if (hasMultipleLevels) {
      logResult(toolName, 'RFC 9293 all levels', 'PASS', {
        note: `Levels: ${JSON.stringify(res.stats.byLevel)}, total=${res.stats.total}`,
      });
    } else {
      logResult(toolName, 'RFC 9293 all levels', 'PARTIAL', {
        note: `byLevel=${JSON.stringify(res.stats?.byLevel)}`,
      });
    }
  } catch (e) {
    logResult(toolName, 'RFC 9293 all levels', 'FAIL', { error: e.message });
  }
}

// 3. get_definitions
async function testGetDefinitions(client) {
  const toolName = 'get_definitions';

  // 3-a: Specific term search (RFC 9293 MSS)
  try {
    const res = await callTool(client, toolName, { rfc: 9293, term: 'MSS' });
    const found = res.count > 0;
    const isXml = res._source === 'xml';
    const hasDef = res.definitions?.[0]?.definition;

    if (found && isXml && hasDef) {
      logResult(toolName, 'RFC 9293 term="MSS" (XML)', 'PASS', {
        note: `${res.count} definitions found`,
      });
    } else {
      logResult(toolName, 'RFC 9293 term="MSS" (XML)', 'FAIL', {
        note: `count=${res.count}, xml=${isXml}, hasDef=${!!hasDef}`,
      });
    }
  } catch (e) {
    logResult(toolName, 'RFC 9293 term="MSS" (XML)', 'FAIL', { error: e.message });
  }

  // 3-b: All definitions (RFC 9293)
  try {
    const res = await callTool(client, toolName, { rfc: 9293 });
    const hasMany = res.count > 10;
    const isXml = res._source === 'xml';

    if (hasMany && isXml) {
      logResult(toolName, 'RFC 9293 all definitions (XML)', 'PASS', {
        note: `${res.count} definitions found`,
      });
    } else {
      logResult(toolName, 'RFC 9293 all definitions (XML)', 'FAIL', {
        note: `count=${res.count}, xml=${isXml}`,
      });
    }
  } catch (e) {
    logResult(toolName, 'RFC 9293 all definitions (XML)', 'FAIL', { error: e.message });
  }
}

// 4. get_rfc_dependencies
async function testGetRfcDependencies(client) {
  const toolName = 'get_rfc_dependencies';

  // 4-a: XML format (RFC 9293)
  try {
    const res = await callTool(client, toolName, { rfc: 9293, includeReferencedBy: true });
    const hasNormative = res.normative?.length > 0;
    const hasInformative = res.informative?.length > 0;
    const isXml = res._source === 'xml';

    if (hasNormative && hasInformative && isXml) {
      logResult(toolName, 'RFC 9293 (XML)', 'PASS', {
        note: `normative=${res.normative.length}, informative=${res.informative.length}`,
      });
    } else {
      logResult(toolName, 'RFC 9293 (XML)', 'FAIL', {
        note: `normative=${res.normative?.length}, informative=${res.informative?.length}, xml=${isXml}`,
      });
    }
  } catch (e) {
    logResult(toolName, 'RFC 9293 (XML)', 'FAIL', { error: e.message });
  }

  // 4-b: Text format (RFC 6455)
  try {
    const res = await callTool(client, toolName, { rfc: 6455 });
    const isText = res._source === 'text';

    logResult(toolName, 'RFC 6455 (text)', isText ? 'PASS' : 'PARTIAL', {
      note: `normative=${res.normative?.length}, informative=${res.informative?.length}, source=${res._source}`,
    });
  } catch (e) {
    logResult(toolName, 'RFC 6455 (text)', 'FAIL', { error: e.message });
  }
}

// 5. get_related_sections
async function testGetRelatedSections(client) {
  const toolName = 'get_related_sections';

  // 5-a: XML format (RFC 9110 §9.3.1)
  // 返す節はすべてこの RFC に実在し、題名が解決できること。
  // 以前は xref の anchor をそのまま返していたため title=Unknown が並んでいた。
  try {
    const res = await callTool(client, toolName, { rfc: 9110, section: '9.3.1' });
    const related = res.relatedSections || [];
    const unresolved = related.filter((s) => s.title === 'Unknown');
    const ok = related.length > 0 && unresolved.length === 0;

    logResult(toolName, 'RFC 9110 §9.3.1 (XML)', ok ? 'PASS' : 'FAIL', {
      note: `${related.length} related sections, unresolved=${unresolved.length}, source=${res._source}`,
    });
  } catch (e) {
    logResult(toolName, 'RFC 9110 §9.3.1 (XML)', 'FAIL', { error: e.message });
  }

  // 5-d: 平文で書かれた別文書参照を、この RFC の節にしないこと
  // RFC 9293 §3.7.1 は "Section 3.4 of RFC 1122" と "RFC 6691, Section 3.1" を含む。
  // それぞれ RFC 1122 / RFC 6691 の節であって、RFC 9293 の §3.4 / §3.1 ではない。
  try {
    const res = await callTool(client, toolName, { rfc: 9293, section: '3.7.1' });
    const numbers = (res.relatedSections || []).map((s) => s.number);
    const ok = !numbers.includes('3.4') && !numbers.includes('3.1');

    logResult(toolName, 'RFC 9293 §3.7.1 excludes RFC 1122 / RFC 6691', ok ? 'PASS' : 'FAIL', {
      note: `sections=[${numbers.join(', ')}]`,
    });
  } catch (e) {
    logResult(toolName, 'RFC 9293 §3.7.1 excludes RFC 1122 / RFC 6691', 'FAIL', {
      error: e.message,
    });
  }

  // 5-c: 別文書の節をこの RFC の節として返さないこと
  // RFC 9110 §9.3.1 は "Section 11.2 of [HTTP/1.1]" を含む。11.2 をこの RFC の
  // §11.2 (Authentication Parameters) として返してはならない。
  try {
    const res = await callTool(client, toolName, { rfc: 9110, section: '9.3.1' });
    const numbers = (res.relatedSections || []).map((s) => s.number);
    const ok = !numbers.includes('11.2') && !numbers.includes('1.2.2');

    logResult(toolName, 'RFC 9110 §9.3.1 excludes other documents', ok ? 'PASS' : 'FAIL', {
      note: `sections=[${numbers.join(', ')}]`,
    });
  } catch (e) {
    logResult(toolName, 'RFC 9110 §9.3.1 excludes other documents', 'FAIL', { error: e.message });
  }

  // 5-b: Text format (RFC 6455 §5.5) - expected partial due to structural limitations
  try {
    const res = await callTool(client, toolName, { rfc: 6455, section: '5.5' });
    const isText = res._source === 'text';

    logResult(toolName, 'RFC 6455 §5.5 (text)', isText ? 'PASS' : 'PARTIAL', {
      note: `${res.relatedSections?.length || 0} related sections, source=${res._source}`,
    });
  } catch (e) {
    logResult(toolName, 'RFC 6455 §5.5 (text)', 'FAIL', { error: e.message });
  }
}

// 6. generate_checklist
async function testGenerateChecklist(client) {
  const toolName = 'generate_checklist';

  // 6-a: Client checklist (RFC 6455)
  try {
    const res = await callTool(client, toolName, {
      rfc: 6455,
      role: 'client',
      sections: ['5', '7'],
    });
    const hasMust = res.stats?.must > 0;
    const hasMarkdown = res.markdown?.includes('- [ ]');

    if (hasMust && hasMarkdown) {
      logResult(toolName, 'RFC 6455 client §5,§7', 'PASS', {
        note: `must=${res.stats.must}, should=${res.stats.should}, may=${res.stats.may}, total=${res.stats.total}`,
      });
    } else {
      logResult(toolName, 'RFC 6455 client §5,§7', 'FAIL', {
        note: `must=${res.stats?.must}, hasMarkdown=${hasMarkdown}`,
      });
    }
  } catch (e) {
    logResult(toolName, 'RFC 6455 client §5,§7', 'FAIL', { error: e.message });
  }

  // 6-b: XML format full checklist (RFC 9293)
  try {
    const res = await callTool(client, toolName, { rfc: 9293, role: 'both' });
    const hasMust = res.stats?.must > 0;
    const isXml = res._source === 'xml';

    if (hasMust && isXml) {
      logResult(toolName, 'RFC 9293 both (XML)', 'PASS', {
        note: `must=${res.stats.must}, should=${res.stats.should}, may=${res.stats.may}, total=${res.stats.total}`,
      });
    } else {
      logResult(toolName, 'RFC 9293 both (XML)', 'FAIL', {
        note: `must=${res.stats?.must}, xml=${isXml}`,
      });
    }
  } catch (e) {
    logResult(toolName, 'RFC 9293 both (XML)', 'FAIL', { error: e.message });
  }
}

// 7. validate_statement
async function testValidateStatement(client) {
  const toolName = 'validate_statement';

  // 7-a: MUST violation detection (client sends unmasked frames)
  try {
    const res = await callTool(client, toolName, {
      rfc: 6455,
      statement: 'The client sends unmasked frames to the server',
    });
    const hasMatching = res.matchingRequirements?.length > 0;
    const hasMaskReq = res.matchingRequirements?.some((r) =>
      r.text?.toLowerCase().includes('must mask')
    );
    const correctlyInvalid = res.isValid === false;
    const hasConflicts = res.conflicts?.length > 0;

    if (hasMatching && hasMaskReq && (correctlyInvalid || hasConflicts)) {
      logResult(toolName, 'MUST violation detection', 'PASS', {
        note: `isValid=${res.isValid}, conflicts=${res.conflicts?.length}, matchingReqs=${res.matchingRequirements?.length}`,
      });
    } else if (hasMatching && hasMaskReq) {
      logResult(toolName, 'MUST violation detection', 'PARTIAL', {
        note: `Matched requirement found, but isValid=${res.isValid}, conflicts=${res.conflicts?.length}`,
      });
    } else {
      logResult(toolName, 'MUST violation detection', 'FAIL', {
        note: `matching=${hasMatching}, maskReq=${hasMaskReq}, isValid=${res.isValid}`,
      });
    }
  } catch (e) {
    logResult(toolName, 'MUST violation detection', 'FAIL', { error: e.message });
  }

  // 7-b: Compliant statement test
  try {
    const res = await callTool(client, toolName, {
      rfc: 6455,
      statement: 'The client masks all frames sent to the server',
    });
    const isValid = res.isValid === true;
    const hasMatching = res.matchingRequirements?.length > 0;

    if (isValid && hasMatching) {
      logResult(toolName, 'Compliant statement', 'PASS', {
        note: `isValid=${res.isValid}, matchingReqs=${res.matchingRequirements?.length}`,
      });
    } else {
      logResult(toolName, 'Compliant statement', 'PARTIAL', {
        note: `isValid=${res.isValid}, matching=${res.matchingRequirements?.length}`,
      });
    }
  } catch (e) {
    logResult(toolName, 'Compliant statement', 'FAIL', { error: e.message });
  }

  // 7-c: 条件節の無関係な否定で矛盾を誤検出しないこと
  // RFC 6455 §5.1 は "A server MUST NOT mask any frames that it sends to the client"。
  // つまりこの文は準拠側。以前は §4.2.1 の条件節 "did not send" を拾って
  // isValid=false を返していた。
  try {
    const res = await callTool(client, toolName, {
      rfc: 6455,
      statement: 'The server sends unmasked frames to the client',
    });
    const noConflicts = (res.conflicts?.length ?? 0) === 0;

    logResult(toolName, 'No false conflict (server unmasked)', noConflicts ? 'PASS' : 'FAIL', {
      note: `isValid=${res.isValid}, conflicts=${res.conflicts?.length}, matchingReqs=${res.matchingRequirements?.length}`,
    });
  } catch (e) {
    logResult(toolName, 'No false conflict (server unmasked)', 'FAIL', { error: e.message });
  }

  // 7-d: 一致が無いときに準拠を主張しないこと
  try {
    const res = await callTool(client, toolName, {
      rfc: 6455,
      statement: 'サーバは受信したフレームをマスクせずにクライアントへ送信する',
    });
    const ok = res.isValid === null && (res.matchingRequirements?.length ?? 0) === 0;

    logResult(toolName, 'isValid is null when nothing matches', ok ? 'PASS' : 'FAIL', {
      note: `isValid=${res.isValid}, matchingReqs=${res.matchingRequirements?.length}, note=${res._verdictNote ? 'present' : 'absent'}`,
    });
  } catch (e) {
    logResult(toolName, 'isValid is null when nothing matches', 'FAIL', { error: e.message });
  }
}

// ========================================
// xref rendering
// ========================================

/**
 * 12. xref が本文から落ちていないこと
 *
 * RFC 9110 §9.3.1 の "request smuggling attack (Section 11.2 of [HTTP/1.1])" は、
 * 以前は "request smuggling attack ()." になっていた。
 */
async function testXrefRendering(client) {
  const toolName = 'xref';

  try {
    const res = await callTool(client, 'get_requirements', { rfc: 9110, section: '9.3.1' });
    const contexts = (res.requirements || []).map((r) => r.fullContext || '').join('\n');
    const emptyParens = /\(\s*\)/.test(contexts);
    const hasRendered = contexts.includes('Section 11.2 of [HTTP/1.1]');

    logResult(
      toolName,
      'xref is rendered into the body text',
      !emptyParens && hasRendered ? 'PASS' : 'FAIL',
      {
        note: `emptyParens=${emptyParens}, rendered=${hasRendered}`,
      }
    );
  } catch (e) {
    logResult(toolName, 'xref is rendered into the body text', 'FAIL', { error: e.message });
  }
}

// ========================================
// Sentence extraction
// ========================================

/**
 * 13. 要件文が節番号のピリオドで切れていないこと
 *
 * RFC 6455 §5.1 の "a client MUST mask all frames that it sends to the server
 * (see Section 5.3 for further details)." は、以前は
 * "… (see Section 5." で切れていた。
 */
async function testSentenceExtraction(client) {
  const toolName = 'sentence';

  try {
    const res = await callTool(client, 'get_requirements', { rfc: 6455, section: '5.1' });
    const requirements = res.requirements || [];
    const masking = requirements.find((r) => /MUST mask all frames/.test(r.text || ''));

    const complete = !!masking && masking.text.includes('for further details');
    logResult(
      toolName,
      'requirement text is not cut at a section number',
      complete ? 'PASS' : 'FAIL',
      {
        note: masking ? JSON.stringify(masking.text.slice(-60)) : 'requirement not found',
      }
    );
  } catch (e) {
    logResult(toolName, 'requirement text is not cut at a section number', 'FAIL', {
      error: e.message,
    });
  }

  try {
    const res = await callTool(client, 'get_requirements', { rfc: 6455 });
    const requirements = res.requirements || [];

    // 以前の切り出しが作っていた形を探す。
    //   "(see Section 5."  節番号の途中で終わる
    //   "(e."              略語の途中で終わる
    // 括弧の釣り合いそのものは指標にならない。RFC 6455 §11.3.2 は原典が
    // "(which is logically the same as ... contains all values." と閉じ括弧を
    // 欠いており、忠実に取れば釣り合わない。
    const cut = requirements.filter((r) =>
      /\((?:[A-Za-z]|see Section \d+(?:\.\d+)*)\.$/.test((r.text || '').trim())
    );

    logResult(
      toolName,
      'no requirement text is cut mid-token',
      cut.length === 0 ? 'PASS' : 'FAIL',
      {
        note: `cut=${cut.length}/${requirements.length}${cut.length ? ' e.g. ' + JSON.stringify(cut[0].text.slice(-40)) : ''}`,
      }
    );
  } catch (e) {
    logResult(toolName, 'no requirement text is cut mid-token', 'FAIL', { error: e.message });
  }
}

// ========================================
// Requirement Deduplication (RFC 1122 系ラベル)
// ========================================

/**
 * 11. 要求 ID ラベルによる重複
 *
 * RFC 9293 §3.7.1 は `(MUST-14)` 等のラベルを本文に持つ。ラベル内の MUST を
 * 拾って同じ文が 2 件出ていた回帰を、実データで確認する。
 */
async function testRequirementDeduplication(client) {
  const toolName = 'dedup';

  try {
    const res = await callTool(client, 'get_requirements', { rfc: 9293, section: '3.7.1' });
    const texts = (res.requirements || []).map((r) => `${r.level}\u0000${r.text}`);
    const unique = new Set(texts);

    logResult(
      toolName,
      'get_requirements has no duplicates',
      texts.length === unique.size ? 'PASS' : 'FAIL',
      {
        note: `total=${texts.length}, unique=${unique.size}`,
      }
    );
  } catch (e) {
    logResult(toolName, 'get_requirements has no duplicates', 'FAIL', { error: e.message });
  }

  try {
    const res = await callTool(client, 'generate_checklist', {
      rfc: 9293,
      role: 'server',
      sections: ['3.7.1'],
    });
    // 見出し（MUST / SHOULD / MAY）ごとに重複を見る。
    // 1 つの文が SHLD-5 と MAY-3 の両方を含む場合、SHOULD 節と MAY 節の
    // 双方に出るのは正しい挙動なので、節をまたいだ重複は数えない。
    const groups = new Map();
    let heading = '(none)';
    for (const line of (res.markdown || '').split('\n')) {
      if (line.startsWith('## ')) {
        heading = line.slice(3).trim();
        groups.set(heading, []);
      } else if (line.startsWith('- [ ] ')) {
        if (!groups.has(heading)) groups.set(heading, []);
        groups.get(heading).push(line);
      }
    }

    const duplicated = [];
    let total = 0;
    for (const [name, items] of groups) {
      total += items.length;
      if (new Set(items).size !== items.length) duplicated.push(name);
    }

    logResult(
      toolName,
      'generate_checklist has no duplicates',
      duplicated.length === 0 ? 'PASS' : 'FAIL',
      {
        note: `items=${total}, duplicatedIn=[${duplicated.join(' / ')}], stats=${JSON.stringify(res.stats)}`,
      }
    );
  } catch (e) {
    logResult(toolName, 'generate_checklist has no duplicates', 'FAIL', { error: e.message });
  }
}

// ========================================
// Server Surface Tests (v2)
// ========================================

/**
 * 8. instructions
 *
 * SDK v2 では `initialize` の応答に含まれる instructions を
 * `client.getInstructions()` で読める。射程宣言が実際にクライアントへ
 * 届いているかをここで確認する。
 */
async function testInstructions(client) {
  const toolName = 'instructions';
  try {
    const instructions = client.getInstructions();
    const present = typeof instructions === 'string' && instructions.length > 0;
    const declaresScope = present && instructions.includes('It does NOT do the following');

    if (present && declaresScope) {
      logResult(toolName, 'initialize returns instructions', 'PASS', {
        note: `${instructions.length} chars`,
      });
    } else {
      logResult(toolName, 'initialize returns instructions', 'FAIL', {
        note: `present=${present}, declaresScope=${declaresScope}`,
      });
    }
  } catch (e) {
    logResult(toolName, 'initialize returns instructions', 'FAIL', { error: e.message });
  }
}

/**
 * 9. resources
 */
async function testResources(client) {
  const toolName = 'resources';
  try {
    const { resources } = await client.listResources();
    const schema = resources.find((r) => r.uri === 'rfcxml://schema');

    if (!schema) {
      logResult(toolName, 'rfcxml://schema is listed', 'FAIL', {
        note: `listed: ${resources.map((r) => r.uri).join(', ')}`,
      });
      return;
    }
    logResult(toolName, 'rfcxml://schema is listed', 'PASS', { note: schema.name });

    const read = await client.readResource({ uri: 'rfcxml://schema' });
    const body = JSON.parse(read.contents[0].text);
    const ok = body.version === 'v3' && !!body.keyElements?.bcp14;

    logResult(toolName, 'rfcxml://schema is readable', ok ? 'PASS' : 'FAIL', {
      note: `version=${body.version}, keyElements=${Object.keys(body.keyElements || {}).length}`,
    });
  } catch (e) {
    logResult(toolName, 'rfcxml://schema', 'FAIL', { error: e.message });
  }
}

/**
 * 10. 入力スキーマ違反
 *
 * v2 は registerTool に渡した JSON Schema でサーバ側入力検証を行う。
 * 必須項目を欠いた呼び出しが弾かれることを確認する。
 */
async function testInputValidation(client) {
  const toolName = 'input validation';
  try {
    const result = await client.callTool({ name: 'get_requirements', arguments: {} });
    logResult(toolName, 'missing required "rfc" is rejected', result.isError ? 'PASS' : 'FAIL', {
      note: `isError=${result.isError}`,
    });
  } catch (e) {
    // JSON-RPC エラーとして返る実装でも「弾いた」ことに変わりはない
    logResult(toolName, 'missing required "rfc" is rejected', 'PASS', { note: e.message });
  }
}

// ========================================
// Text path (RFC < 8650)
// ========================================

/**
 * 14. テキスト経路の題名と節
 *
 * RFC 8174 は題名が "Internet Engineering Task Force (IETF)   B. Leiba"
 * （ヘッダ塊の 1 行目）になり、目次の 5 行が節として混ざって 10 節に見えていた。
 */
async function testTextPathStructure(client) {
  const toolName = 'text path';

  try {
    const res = await callTool(client, 'get_rfc_structure', { rfc: 8174 });
    const title = res.metadata?.title || '';
    const ok = title === 'Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words';

    logResult(toolName, 'title is the document title, not the header line', ok ? 'PASS' : 'FAIL', {
      note: JSON.stringify(title.slice(0, 70)),
    });
  } catch (e) {
    logResult(toolName, 'title is the document title, not the header line', 'FAIL', {
      error: e.message,
    });
  }

  // RFC 6455 は本文の番号付きリスト項目を節として拾い、節番号が重複していた
  try {
    const res = await callTool(client, 'get_rfc_structure', { rfc: 6455 });
    const flat = [];
    const walk = (sections) => {
      for (const section of sections) {
        flat.push(section);
        walk(section.subsections || []);
      }
    };
    walk(res.sections || []);
    const numbers = flat.map((s) => s.number);
    const duplicates = numbers.length - new Set(numbers).size;

    logResult(
      toolName,
      'list items are not treated as sections',
      duplicates === 0 ? 'PASS' : 'FAIL',
      {
        note: `sections=${flat.length}, duplicateNumbers=${duplicates}`,
      }
    );
  } catch (e) {
    logResult(toolName, 'list items are not treated as sections', 'FAIL', { error: e.message });
  }

  try {
    const res = await callTool(client, 'get_rfc_structure', { rfc: 8174 });
    const flat = [];
    const walk = (sections) => {
      for (const section of sections) {
        flat.push(section);
        walk(section.subsections || []);
      }
    };
    walk(res.sections || []);

    const toc = flat.filter((s) => /(?:\.\s?){3,}\s*\d+\s*$/.test((s.title || '').trim()));
    const numbers = flat.map((s) => s.number);
    const duplicates = numbers.length - new Set(numbers).size;
    const ok = toc.length === 0 && duplicates === 0 && flat.length === 5;

    logResult(toolName, 'table of contents is not listed as sections', ok ? 'PASS' : 'FAIL', {
      note: `sections=${flat.length}, tocEntries=${toc.length}, duplicateNumbers=${duplicates}`,
    });
  } catch (e) {
    logResult(toolName, 'table of contents is not listed as sections', 'FAIL', {
      error: e.message,
    });
  }
}

// ========================================
// Definitions
// ========================================

/**
 * 16. 索引が定義として出ないこと
 *
 * RFC 9114 は 112 件の「定義」のうち 32 件が Appendix C の索引項目だった。
 */
async function testDefinitions(client) {
  const toolName = 'definitions';

  try {
    const res = await callTool(client, 'get_definitions', { rfc: 9114 });
    const indexLike = (res.definitions || []).filter((d) =>
      /Paragraph \d/.test(d.definition || '')
    );

    logResult(
      toolName,
      'index entries are not definitions',
      indexLike.length === 0 ? 'PASS' : 'FAIL',
      {
        note: `definitions=${res.count}, indexLike=${indexLike.length}`,
      }
    );
  } catch (e) {
    logResult(toolName, 'index entries are not definitions', 'FAIL', { error: e.message });
  }

  try {
    // 後付録の本物の定義（RFC 9114 Appendix A.2.5）は残っていること
    const res = await callTool(client, 'get_definitions', { rfc: 9114, term: 'RST_STREAM' });
    const found = (res.definitions || []).some((d) => /RST_STREAM/.test(d.term || ''));

    logResult(toolName, 'real definitions in the back matter are kept', found ? 'PASS' : 'FAIL', {
      note: `count=${res.count}`,
    });
  } catch (e) {
    logResult(toolName, 'real definitions in the back matter are kept', 'FAIL', {
      error: e.message,
    });
  }
}

/**
 * 16. iref から取った定義（v0.6.6）
 *
 * `<dl>` で用語を並べない RFC では定義が 1 件も取れていなかった。RFC 9110 の
 * `get_definitions` は §14.6 と §16.3.1 の登録票の項目名しか返さず、
 * `resource` `cache` といった同文書の用語は入っていなかった。
 */
async function testIrefDefinitions(client) {
  const toolName = 'definitions';

  try {
    const res = await callTool(client, 'get_definitions', { rfc: 9110, term: 'cache' });
    const cache = (res.definitions || []).find((d) => d.term === 'cache');

    logResult(
      toolName,
      'terms defined in prose are returned',
      cache && /local store of previous response messages/.test(cache.definition) ? 'PASS' : 'FAIL',
      { note: `count=${res.count}, section=${cache?.section}` }
    );
  } catch (e) {
    logResult(toolName, 'terms defined in prose are returned', 'FAIL', { error: e.message });
  }

  try {
    const res = await callTool(client, 'get_definitions', { rfc: 9110 });
    const definitions = res.definitions || [];
    const withColon = definitions.filter((d) => /:$/.test(d.term || ''));
    const rawSection = definitions.filter((d) => /^section-/.test(d.section || ''));

    logResult(
      toolName,
      'terms and sections are printed in the published form',
      withColon.length === 0 && rawSection.length === 0 ? 'PASS' : 'FAIL',
      { note: `count=${definitions.length}, colon=${withColon.length}, pn=${rawSection.length}` }
    );
  } catch (e) {
    logResult(toolName, 'terms and sections are printed in the published form', 'FAIL', {
      error: e.message,
    });
  }

  try {
    // 定義は節番号の順に並ぶ。§14.6 の登録票が §3.1 の resource より前に出ない。
    const res = await callTool(client, 'get_definitions', { rfc: 9110 });
    const first = (res.definitions || [])[0];

    logResult(
      toolName,
      'definitions are ordered by section',
      first?.term === 'resource' ? 'PASS' : 'FAIL',
      {
        note: `first=${first?.term} (${first?.section})`,
      }
    );
  } catch (e) {
    logResult(toolName, 'definitions are ordered by section', 'FAIL', { error: e.message });
  }
}

// ========================================
// References (text path)
// ========================================

/**
 * 17. テキスト経路の参照（v0.6.6）
 *
 * v0.6.5 までは本文全体を `RFC\s*(\d+)` で走査していたため、規範的参照と
 * 参考的参照が区別できず、参考文献に載っていない言及まで参照に入っていた。
 */
async function testTextReferences(client) {
  const toolName = 'dependencies';

  try {
    const res = await callTool(client, 'get_rfc_dependencies', { rfc: 6455 });
    const normative = res.normative || [];
    const informative = res.informative || [];

    logResult(
      toolName,
      'normative and informative are separated on the text path',
      normative.length === 18 && informative.length === 9 ? 'PASS' : 'FAIL',
      { note: `normative=${normative.length}, informative=${informative.length}` }
    );

    const stubs = [...normative, ...informative].filter((r) => /^RFC \d+$/.test(r.title || ''));
    logResult(
      toolName,
      'titles come from the reference entries',
      stubs.length === 0 ? 'PASS' : 'FAIL',
      {
        note: `stubTitles=${stubs.length}`,
      }
    );

    // "RFC 5741" は Status of This Memo の定型文、"RFC 6202" は §1.1 の地の文。
    // 6202 は参考文献にも載っているので、載っていない 5741 で見る。
    const mention = [...normative, ...informative].some((r) => r.rfcNumber === 5741);
    logResult(
      toolName,
      'mentions outside the reference list are not references',
      !mention ? 'PASS' : 'FAIL',
      {
        note: `RFC5741 present=${mention}`,
      }
    );
  } catch (e) {
    logResult(toolName, 'normative and informative are separated on the text path', 'FAIL', {
      error: e.message,
    });
  }
}

// ========================================
// Requirement text (text path)
// ========================================

/**
 * 18. テキスト経路の要件文（v0.6.6）
 */
async function testTextRequirementShape(client) {
  const toolName = 'requirements';

  try {
    const res = await callTool(client, 'get_requirements', { rfc: 6455 });
    const requirements = res.requirements || [];
    const wrapped = requirements.filter((r) => /\n| {4,}/.test(r.text || ''));
    const bullets = requirements.filter((r) => /^o\s/.test(r.text || ''));

    logResult(
      toolName,
      'requirement text is one folded line',
      wrapped.length === 0 && bullets.length === 0 ? 'PASS' : 'FAIL',
      { note: `total=${requirements.length}, wrapped=${wrapped.length}, bullets=${bullets.length}` }
    );

    // ABNF の注釈は散文として組み直され、"…, MUST " で切れない
    const abnf = requirements.find((r) => /1 bit in length/.test(r.text || ''));
    logResult(toolName, 'ABNF comments are rebuilt as prose', abnf ? 'PASS' : 'FAIL', {
      note: abnf ? abnf.text : 'not found',
    });
  } catch (e) {
    logResult(toolName, 'requirement text is one folded line', 'FAIL', { error: e.message });
  }
}

// ========================================
// Checklist
// ========================================

/**
 * 19. チェックリストの体裁（v0.6.6）
 */
async function testChecklistShape(client) {
  const toolName = 'checklist';

  try {
    const res = await callTool(client, 'generate_checklist', {
      rfc: 6455,
      sections: ['5.3'],
      role: 'client',
    });
    const lines = (res.markdown || '').split('\n');
    const items = lines.filter((l) => l.startsWith('- [ ]'));
    const stray = lines.filter((l) => /^\s+\S/.test(l));
    const unique = new Set(items);

    logResult(
      toolName,
      'each item is one Markdown line and carries its level',
      stray.length === 0 &&
        items.length === unique.size &&
        items.every((l) => /^- \[ \] \*\*/.test(l))
        ? 'PASS'
        : 'FAIL',
      { note: `items=${items.length}, unique=${unique.size}, continuationLines=${stray.length}` }
    );
  } catch (e) {
    logResult(toolName, 'each item is one Markdown line and carries its level', 'FAIL', {
      error: e.message,
    });
  }
}

// ========================================
// Inline elements (XML)
// ========================================

/**
 * 15. インライン要素が本文に残っていること（空白の畳み込みを含む）
 *
 * `<tt>` `<sup>` は xref と同じ理由で落ちており、RFC 9114 の
 * "HEADERS<tt>…</tt>frame" が語ごと繋がり、RFC 9293 の "2<sup>32</sup> - 1" が
 * "2- 1" になっていた。
 */
async function testInlineElements(client) {
  const toolName = 'inline';

  try {
    const res = await callTool(client, 'get_requirements', { rfc: 9114, section: '4.1' });
    const contexts = (res.requirements || []).map((r) => r.fullContext || '').join('\n');
    const runOn = contexts.includes('HEADERSframe');
    const spaced = contexts.includes('HEADERS frame');

    logResult(toolName, 'words are not run together', !runOn && spaced ? 'PASS' : 'FAIL', {
      note: `"HEADERS frame"=${spaced}, "HEADERSframe"=${runOn}`,
    });
  } catch (e) {
    logResult(toolName, 'words are not run together', 'FAIL', { error: e.message });
  }

  try {
    const res = await callTool(client, 'get_requirements', { rfc: 9114, section: '6.2.3' });
    const contexts = (res.requirements || []).map((r) => r.fullContext || '').join('\n');
    const ok = contexts.includes('0x1f * N + 0x21');

    logResult(toolName, 'tt is rendered', ok ? 'PASS' : 'FAIL', {
      note: `has the code fragment=${ok}`,
    });
  } catch (e) {
    logResult(toolName, 'tt is rendered', 'FAIL', { error: e.message });
  }

  // タグを外した跡の字下げが残らないこと
  try {
    const res = await callTool(client, 'get_requirements', { rfc: 9114 });
    const requirements = res.requirements || [];
    const runs = requirements.filter((r) => / {4,}/.test(r.text || ''));

    logResult(
      toolName,
      'no whitespace runs are left in the text',
      runs.length === 0 ? 'PASS' : 'FAIL',
      {
        note: `withRuns=${runs.length}/${requirements.length}`,
      }
    );
  } catch (e) {
    logResult(toolName, 'no whitespace runs are left in the text', 'FAIL', { error: e.message });
  }
}

/**
 * 21. 否定の要件に反する主張（v0.6.7）
 *
 * v0.6.6 では RFC 9114 §6.2.3 の `MUST NOT` に正面から反する主張が
 * `isValid: true` になり、その要件は順位 8 位に落ちていた（主語が複数形のため）。
 */
async function testProhibitionViolation(client) {
  const toolName = 'validate_statement';

  try {
    const res = await callTool(client, 'validate_statement', {
      rfc: 9114,
      statement:
        'An endpoint treats a reserved stream type as having a defined meaning upon receipt.',
    });
    const top = (res.matchingRequirements || [])[0];

    logResult(
      toolName,
      'a statement that does what MUST NOT forbids is a conflict',
      res.isValid === false && (res.conflicts || []).length > 0 ? 'PASS' : 'FAIL',
      { note: `isValid=${res.isValid}, conflicts=${(res.conflicts || []).length}` }
    );

    logResult(
      toolName,
      'the requirement on point ranks first despite a plural subject',
      top?.section === '6.2.3' ? 'PASS' : 'FAIL',
      { note: `top=${top?.id} (${top?.section}), subjectMatch=${top?._subjectMatch}` }
    );
  } catch (e) {
    logResult(toolName, 'a statement that does what MUST NOT forbids is a conflict', 'FAIL', {
      error: e.message,
    });
  }

  try {
    const res = await callTool(client, 'validate_statement', {
      rfc: 9114,
      statement: 'An endpoint ignores reserved stream types upon receipt.',
    });

    logResult(
      toolName,
      'a compliant statement is not reported as a conflict',
      (res.conflicts || []).length === 0 ? 'PASS' : 'FAIL',
      { note: `isValid=${res.isValid}, conflicts=${(res.conflicts || []).length}` }
    );
  } catch (e) {
    logResult(toolName, 'a compliant statement is not reported as a conflict', 'FAIL', {
      error: e.message,
    });
  }

  try {
    // RFC 6455 §6.2 が求めるのは masking を remove することで、mask することではない。
    const res = await callTool(client, 'validate_statement', {
      rfc: 6455,
      statement: 'The server sends unmasked frames to the client.',
    });
    const wrong = (res.conflicts || []).filter((c) => /remove masking/.test(c.reason || ''));

    logResult(
      toolName,
      'a verb inside the object is not taken as the required action',
      wrong.length === 0 ? 'PASS' : 'FAIL',
      { note: `conflicts=${(res.conflicts || []).length}, removeMasking=${wrong.length}` }
    );
  } catch (e) {
    logResult(toolName, 'a verb inside the object is not taken as the required action', 'FAIL', {
      error: e.message,
    });
  }
}

// ========================================
// Source notes and shapes
// ========================================

/**
 * 22. 注記と体裁（v0.6.7）
 */
async function testNotesAndShapes(client) {
  try {
    const res = await callTool(client, 'get_rfc_dependencies', { rfc: 6455 });

    logResult(
      'dependencies',
      'no placeholder note when the titles are real',
      !/placeholders/.test(res._sourceNote || '') ? 'PASS' : 'FAIL',
      { note: res._sourceNote ?? '(no note)' }
    );
  } catch (e) {
    logResult('dependencies', 'no placeholder note when the titles are real', 'FAIL', {
      error: e.message,
    });
  }

  try {
    // RFC 2616 は参考文献の欄が 1 つしかない。そこだけ注記が出る。
    const res = await callTool(client, 'get_rfc_dependencies', { rfc: 2616 });

    logResult(
      'dependencies',
      'a single References section is called out',
      res.normative.length === 0 && /single References section/.test(res._sourceNote || '')
        ? 'PASS'
        : 'FAIL',
      { note: `normative=${res.normative.length}, note=${res._sourceNote ?? '(none)'}` }
    );
  } catch (e) {
    logResult('dependencies', 'a single References section is called out', 'FAIL', {
      error: e.message,
    });
  }

  try {
    const res = await callTool(client, 'get_definitions', {
      rfc: 9110,
      term: 'transforming proxy',
    });
    const found = (res.definitions || []).find((d) => d.term === 'transforming proxy');

    logResult(
      'definitions',
      'the paragraph that defines the term is returned',
      /is called a "transforming proxy"/.test(found?.definition || '') ? 'PASS' : 'FAIL',
      { note: (found?.definition || '(not found)').slice(0, 90) }
    );
  } catch (e) {
    logResult('definitions', 'the paragraph that defines the term is returned', 'FAIL', {
      error: e.message,
    });
  }

  try {
    const res = await callTool(client, 'get_requirements', { rfc: 6455 });
    const bullets = (res.requirements || []).filter((r) => /^o\s/.test(r.fullContext || ''));

    logResult(
      'requirements',
      'fullContext carries no list marker',
      bullets.length === 0 ? 'PASS' : 'FAIL',
      {
        note: `bullets=${bullets.length}/${(res.requirements || []).length}`,
      }
    );
  } catch (e) {
    logResult('requirements', 'fullContext carries no list marker', 'FAIL', { error: e.message });
  }

  try {
    const res = await callTool(client, 'get_requirements', { rfc: 6455, section: '5.4' });
    const series = (res.requirements || []).find((r) => /either text, binary/.test(r.text || ''));

    logResult(
      'requirements',
      'a series is not clipped at the first comma',
      series?.action === 'be either text, binary, or one of the reserved opcodes' ? 'PASS' : 'FAIL',
      { note: `action="${series?.action ?? '(not found)'}"` }
    );
  } catch (e) {
    logResult('requirements', 'a series is not clipped at the first comma', 'FAIL', {
      error: e.message,
    });
  }
}

// ========================================
// Main Execution
// ========================================
async function main() {
  console.log('='.repeat(60));
  console.log('RFCXML MCP E2E Test Suite');
  console.log('='.repeat(60));
  console.log('');

  let client, transport;
  try {
    console.log('Connecting to MCP server...');
    ({ client, transport } = await createClient());

    const tools = await client.listTools();
    console.log(`Available tools: ${tools.tools.map((t) => t.name).join(', ')}`);
    console.log('');

    console.log('--- 1. get_rfc_structure ---');
    await testGetRfcStructure(client);
    console.log('');

    console.log('--- 2. get_requirements ---');
    await testGetRequirements(client);
    console.log('');

    console.log('--- 3. get_definitions ---');
    await testGetDefinitions(client);
    console.log('');

    console.log('--- 4. get_rfc_dependencies ---');
    await testGetRfcDependencies(client);
    console.log('');

    console.log('--- 5. get_related_sections ---');
    await testGetRelatedSections(client);
    console.log('');

    console.log('--- 6. generate_checklist ---');
    await testGenerateChecklist(client);
    console.log('');

    console.log('--- 7. validate_statement ---');
    await testValidateStatement(client);
    console.log('');

    console.log('--- 8. instructions ---');
    await testInstructions(client);
    console.log('');

    console.log('--- 9. resources ---');
    await testResources(client);
    console.log('');

    console.log('--- 10. input validation ---');
    await testInputValidation(client);
    console.log('');

    console.log('--- 11. requirement deduplication ---');
    await testRequirementDeduplication(client);
    console.log('');

    console.log('--- 12. xref rendering ---');
    await testXrefRendering(client);
    console.log('');

    console.log('--- 13. sentence extraction ---');
    await testSentenceExtraction(client);
    console.log('');

    console.log('--- 14. text path structure ---');
    await testTextPathStructure(client);
    console.log('');

    console.log('--- 15. inline elements ---');
    await testInlineElements(client);
    console.log('');

    console.log('--- 16. definitions ---');
    await testDefinitions(client);
    console.log('');

    console.log('--- 17. definitions from iref ---');
    await testIrefDefinitions(client);
    console.log('');

    console.log('--- 18. references (text path) ---');
    await testTextReferences(client);
    console.log('');

    console.log('--- 19. requirement text (text path) ---');
    await testTextRequirementShape(client);
    console.log('');

    console.log('--- 20. checklist shape ---');
    await testChecklistShape(client);
    console.log('');

    console.log('--- 21. prohibition violation ---');
    await testProhibitionViolation(client);
    console.log('');

    console.log('--- 22. notes and shapes ---');
    await testNotesAndShapes(client);
    console.log('');
  } catch (e) {
    console.error('Fatal error:', e.message);
    process.exit(1);
  } finally {
    if (transport) {
      await transport.close();
    }
  }

  // Summary
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const pass = results.filter((r) => r.status === 'PASS').length;
  const partial = results.filter((r) => r.status === 'PARTIAL').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;

  console.log(
    `Total: ${results.length} tests | PASS: ${pass} | PARTIAL: ${partial} | FAIL: ${fail}`
  );
  console.log('');

  // Per-tool summary
  const toolNames = [...new Set(results.map((r) => r.toolName))];
  for (const tool of toolNames) {
    const toolResults = results.filter((r) => r.toolName === tool);
    const allPass = toolResults.every((r) => r.status === 'PASS');
    const anyFail = toolResults.some((r) => r.status === 'FAIL');
    const status = allPass ? 'PASS' : anyFail ? 'FAIL' : 'PARTIAL';
    const icon = status === 'PASS' ? '✅' : status === 'PARTIAL' ? '⚠️' : '❌';
    console.log(`${icon} ${tool}: ${toolResults.map((r) => r.icon).join(' ')}`);
  }

  // Exit with appropriate code
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(console.error);
