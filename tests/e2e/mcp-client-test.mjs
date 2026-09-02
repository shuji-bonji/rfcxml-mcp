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

  // 5-a: XML format (RFC 9293 §3.7.1)
  // 返す節はすべてこの RFC に実在し、題名が解決できること。
  // 以前は xref の anchor をそのまま返していたため title=Unknown が並んでいた。
  try {
    const res = await callTool(client, toolName, { rfc: 9293, section: '3.7.1' });
    const related = res.relatedSections || [];
    const unresolved = related.filter((s) => s.title === 'Unknown');
    const ok = related.length > 0 && unresolved.length === 0;

    logResult(toolName, 'RFC 9293 §3.7.1 (XML)', ok ? 'PASS' : 'FAIL', {
      note: `${related.length} related sections, unresolved=${unresolved.length}, source=${res._source}`,
    });
  } catch (e) {
    logResult(toolName, 'RFC 9293 §3.7.1 (XML)', 'FAIL', { error: e.message });
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
