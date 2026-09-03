/**
 * 出力見本に固定する呼び出し。
 *
 * `assert` に落とせない不具合を目で見つけるためのものである。v0.6.6 以降で
 * 直した不具合のうち、次のものは assert では気づかなかった。
 *
 * - チェックリストの 1 項目が 2,000 文字の表になっていた（RFC 2131 §4.3.1）
 * - 箇条書きを繋いだ要件文が "…, or; …" で切れていた（RFC 9110 §9.3.5）
 * - ABNF の注釈から取った要件が "…, MUST " で終わっていた（RFC 6455 §5.2）
 *
 * どれも「型は合っているが読めない」ものだった。見本を固定して差分を見れば、
 * 同じ壊れ方をしたときに気づける。
 *
 * 世代と経路を分けてある。XML 経路と、テキスト経路の各世代を最低 1 本ずつ通す。
 */

/** @typedef {{ name: string, tool: string, args: Record<string, unknown> }} SnapshotCase */

/** @type {SnapshotCase[]} */
export const CASES = [
  // --- generate_checklist ---
  {
    name: 'checklist-9110-9.3.5',
    tool: 'generate_checklist',
    args: { rfc: 9110, sections: ['9.3.5'] },
  },
  {
    // role の絞り込み。主語が取れない要件がどちらにも残っていた。
    name: 'checklist-6455-client',
    tool: 'generate_checklist',
    args: { rfc: 6455, sections: ['5.1', '5.2', '5.3'], role: 'client' },
  },
  {
    name: 'checklist-6455-server',
    tool: 'generate_checklist',
    args: { rfc: 6455, sections: ['5.1', '5.2', '5.3'], role: 'server' },
  },
  {
    // 2 ページにわたる表がある。1 項目 2,000 文字の「要件」が出ていた節。
    name: 'checklist-2131-4.3.1',
    tool: 'generate_checklist',
    args: { rfc: 2131, sections: ['4.3.1'] },
  },
  {
    // `<dl>` の 1 項目が段落。2,150 文字が 4 件並んでいた節。
    name: 'checklist-9113-8.3.1',
    tool: 'generate_checklist',
    args: { rfc: 9113, sections: ['8.3.1'] },
  },
  {
    // BCP 14 の定型文から 11 件出ていた。21 項目のうち 11 項目がそれだった。
    name: 'checklist-8259',
    tool: 'generate_checklist',
    args: { rfc: 8259 },
  },

  // --- get_requirements ---
  {
    // ASN.1 の型定義。`OPTIONAL` は BCP 14 のキーワードではない。
    name: 'checklist-5652-5.3',
    tool: 'generate_checklist',
    args: { rfc: 5652, sections: ['5.3'] },
  },
  {
    // 引用符を付けない BCP 14 の定型文。8 件の要件が出ていた。
    name: 'requirements-5652-1.2',
    tool: 'get_requirements',
    args: { rfc: 5652, section: '1.2' },
  },
  {
    // ABNF の注釈に要件を書く。
    name: 'requirements-6455-5.2',
    tool: 'get_requirements',
    args: { rfc: 6455, section: '5.2' },
  },
  {
    // 字下げした見出し。§3.2.1〜3.2.8 が落ちていた節の親。
    name: 'requirements-1123-3.2',
    tool: 'get_requirements',
    args: { rfc: 1123, section: '3.2' },
  },
  {
    name: 'requirements-9110-9.3.5',
    tool: 'get_requirements',
    args: { rfc: 9110, section: '9.3.5' },
  },

  // --- get_definitions ---
  {
    // `<iref primary="true">` から取る。
    name: 'definitions-9110-cache',
    tool: 'get_definitions',
    args: { rfc: 9110, term: 'cache' },
  },
  {
    // `<dl>` から取る。
    name: 'definitions-9114',
    tool: 'get_definitions',
    args: { rfc: 9114 },
  },
  {
    // テキスト経路。表紙・著者欄・注記・登録票を落としたあとに何が残るか。
    name: 'definitions-5280',
    tool: 'get_definitions',
    args: { rfc: 5280 },
  },
  {
    // テキスト経路のぶら下げの用語欄（用語だけの行 + 字下げした説明）。
    name: 'definitions-7519',
    tool: 'get_definitions',
    args: { rfc: 7519 },
  },

  // --- get_rfc_structure ---
  {
    // 中央寄せの見出し（1980 年代）。
    name: 'structure-793',
    tool: 'get_rfc_structure',
    args: { rfc: 793 },
  },
  {
    // 見出しと本文が 1 行に入る（1990 年代前半）。
    name: 'structure-1035',
    tool: 'get_rfc_structure',
    args: { rfc: 1035 },
  },
  {
    // 警告コードの表に "99 Miscellaneous warning" がある。§99 として
    // 受け入れると以降の 30 節が落ちていた。
    name: 'structure-2068',
    tool: 'get_rfc_structure',
    args: { rfc: 2068 },
  },
  {
    // 付録が 46 個ある。文字の番号を見ていなかったため 0 個で、中身は
    // §12.2「Informative References」に吸い込まれていた。
    name: 'structure-8446',
    tool: 'get_rfc_structure',
    args: { rfc: 8446 },
  },
  {
    // 節に番号が無い（1980 年代）。番号を頼りにすると 1 つも取れない。
    name: 'structure-854',
    tool: 'get_rfc_structure',
    args: { rfc: 854 },
  },
  {
    // 節に番号が無く、ページ見出しが "RFC 792" の 1 行で書かれている。
    name: 'structure-792',
    tool: 'get_rfc_structure',
    args: { rfc: 792 },
  },

  // --- get_rfc_dependencies ---
  {
    // 参考文献の欄をテキストから読む。
    name: 'dependencies-6455',
    tool: 'get_rfc_dependencies',
    args: { rfc: 6455 },
  },
  {
    // 題名の読点、注釈の中の番号、題名の中の番号、閉じていない引用符。
    name: 'dependencies-1123',
    tool: 'get_rfc_dependencies',
    args: { rfc: 1123 },
  },
  {
    // 目印を 1 行に置き、引用を 1 桁目から書く。48 件が目印のままだった。
    name: 'dependencies-1305',
    tool: 'get_rfc_dependencies',
    args: { rfc: 1305 },
  },

  // --- get_related_sections ---
  {
    // `[RFC3986] Section 3.4` を外部参照として扱う節。
    name: 'related-6749-3.1',
    tool: 'get_related_sections',
    args: { rfc: 6749, section: '3.1' },
  },

  // --- validate_statement ---
  {
    name: 'validate-6455-compliant',
    tool: 'validate_statement',
    args: {
      rfc: 6455,
      statement: 'The client MUST mask all frames sent to the server.',
    },
  },
  {
    name: 'validate-6455-violation',
    tool: 'validate_statement',
    args: {
      rfc: 6455,
      statement: 'The client sends unmasked frames to the server.',
    },
  },
  {
    // 受動態で書かれた禁止。実行者が本文に無いので矛盾検出は当たらない。
    // isValid は true ではなく null（判断できない）になること。
    name: 'validate-6455-passive',
    tool: 'validate_statement',
    args: {
      rfc: 6455,
      statement:
        'The fragments of one message are interleaved between the fragments of another message.',
    },
  },
];
