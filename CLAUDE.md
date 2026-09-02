# RFCXML MCP Server - 開発ガイド

## プロジェクト概要

RFC文書を**構造的に理解**するためのMCPサーバー。RFCXMLの意味構造を活用し、BCP 14 要件抽出、依存関係分析、実装チェックリスト生成などを提供する。

## ツール一覧

| ツール | 説明 |
|--------|------|
| `get_rfc_structure` | セクション階層とメタデータ取得 |
| `get_requirements` | 規範性要件（MUST/SHOULD/MAY）抽出 |
| `get_definitions` | 用語定義とスコープ |
| `get_rfc_dependencies` | 参照RFC（normative/informative）+ referencedBy（Datatracker API） |
| `get_related_sections` | 関連セクション（`<xref>` + テキスト両対応）|
| `generate_checklist` | 実装チェックリスト生成 |
| `validate_statement` | 主張の仕様準拠検証（重み付きマッチング + 意味的否定検出）|

古い RFC (< 8650) は XML がないためテキストフォールバックで対応。レスポンスに `_source` / `_sourceNote` を付与。

### テキストフォールバック時の機能制約

XMLXPath / 構造化情報に依存する一部機能は、テキストフォールバックでは精度が落ちるか、原理的に取得不能。下記マトリクスは known limitation として明文化しておく。

| ツール | XML 形式 | text 形式 | API 補完 | 備考 |
|---|:---:|:---:|:---:|---|
| `get_rfc_structure` | ✅ 完全 | ⚠️ 階層精度低下 | ✅ メタデータ補完 | API で category/stream/date/abstract/authors を補完 |
| `get_requirements` | ✅ 完全 | ⚠️ 抽出精度低下 | ❌ なし | 段落ベースの推測になる |
| `get_definitions` | ✅ 完全 | ⚠️ 抽出精度低下 | ❌ なし | `<dl>` がなく、見出しベースで推測 |
| `get_rfc_dependencies` | ✅ 完全 | ✅ 良 | ✅ Datatracker `relateddocument` | 本文に refs があれば text パーサで取得、無ければ API |
| `get_related_sections` | ✅ 完全 | ❌ 取得不能 | ❌ なし | Issue #5: 節レベル相互参照は body 限定で API に存在しない |
| `generate_checklist` | ✅ 完全 | ⚠️ 抽出精度低下 | ❌ なし | `get_requirements` 経由のため同じ制約 |
| `validate_statement` | ✅ 完全 | ⚠️ 抽出精度低下 | ❌ なし | 同上 |

凡例: ✅ 完全 / ⚠️ 制限あり（精度低下） / ❌ 取得不能。

`_referencesSource` の値の意味（`get_rfc_dependencies` のみ）:

- `'xml'` — RFCXML の `<references>` から抽出。完全な anchor / title 付き
- `'text'` — テキスト本文の References セクションから抽出。title/anchor はプレースホルダ（`title: "RFC N"`, `anchor: "RFCN"`）
- `'api'` — Datatracker `relateddocument` API から取得。同じくプレースホルダ。本文に refs が無いときに使う

---

## 開発コマンド

```bash
npm run build         # ビルド
npm test              # テスト（単発実行）
npm run test:watch    # テスト（ウォッチモード）
npm run test:coverage # テスト + カバレッジ
npm run test:e2e      # E2E テスト（MCP クライアント統合）
npm run lint          # リント
npm run format        # フォーマット
npm start             # MCP サーバー起動
npm run prefetch      # RFCXML をディスクキャッシュに事前充填
```

`DEBUG=1 npm start` で詳細ログ出力。

### ディスクキャッシュ（Phase 3）

`RFCXML_CACHE_DIR` 環境変数を設定すると、`fetchRFCXML` が永続キャッシュを利用する。

```bash
# 事前充填
RFCXML_CACHE_DIR=~/.cache/rfcxml-mcp \
  npx rfcxml-prefetch --range 9000-9120

# その後 MCP サーバ起動時にも同じ環境変数を渡す
RFCXML_CACHE_DIR=~/.cache/rfcxml-mcp npm start
```

未設定時はインメモリ LRU のみで従来通り動作する。CI で固定スナップショットを使いたい場合や、オフライン作業向け。

### IETF Datatracker API カバレッジ

discussion #6 を踏まえ、IETF が提供する三層（API / bulk DL / rsync）のうち
**API 層を厚く、bulk は別 CLI、rsync は対応しない**方針。
`src/services/rfc-fetcher.ts` で扱う API エンドポイントは `src/config.ts` の
`DATATRACKER_API` に集約してある。新たに API を呼ぶときはここに追加する。

---

## サーバ構成（MCP SDK v2）

v0.6.0 で `@modelcontextprotocol/sdk` (v1) から v2 のパッケージ群へ移行した。

| ファイル | 役割 |
|---|---|
| `src/index.ts` | 起動のみ。`serveStdio(() => buildServer())` を呼ぶ |
| `src/server.ts` | `buildServer()`。`instructions` の文面、ツール一括登録、リソース登録 |
| `src/tools/definitions.ts` | ツールの JSON Schema（`ToolDefinition[]`） |
| `src/tools/handlers.ts` | `toolHandlers` 対応表と各ハンドラ |
| `src/resources/definitions.ts` | `rfcxml://schema` の表示情報と本体 |

押さえておく点は 4 つ。

1. **`serveStdio(factory)`** — v2 は接続開始時にプロトコル era（2025 系 / 2026-07-28 系）を確定し、
   factory から作った 1 インスタンスをその接続に固定する。そのため `new McpServer(...)` を
   module top-level に置かず `buildServer()` に閉じ込める。
2. **`registerTool` + `fromJsonSchema`** — v2 の `registerTool` は Standard Schema を要求する。
   `definitions.ts` は JSON Schema のままにし、`server.ts` で `fromJsonSchema()` に通す。
   zod への書き換えは不要で、zod を直接依存に持つ必要もない。
3. **入力検証がサーバ側で走る** — v1 は `inputSchema` を宣言するだけでスキーマ検証をしていなかった。
   v2 は登録したスキーマで `tools/call` の引数を検証し、必須項目を欠く呼び出しは
   ハンドラに届かず `isError` で返る。ハンドラ側の `validate*` は範囲検査として引き続き必要。
4. **`instructions`** — `buildServer()` の第 2 引数で渡す。文面の意図は `server.ts` の JSDoc にある。
   E2E テストの `testInstructions` が `client.getInstructions()` で到達を確認する。

### TypeScript 7 について

TypeScript 7.0.2（ネイティブ移植版）でのビルド自体は通る（`tsconfig.json` の
`"types": ["node"]` はそのための準備でもある）。ただし `typescript-eslint` の peer 範囲が
`>=4.8.4 <6.1.0` のままで TS 7 を受け付けないため、型情報付き lint を維持する限り採用できない。
現状は TypeScript 6.0.x を使い、`typescript-eslint` が TS 7 に対応した時点で再検討する。

---

## 実装上の注意点

### BCP 14 キーワードの順序

`MUST NOT` を `MUST` より先にマッチさせる（`src/constants.ts` の `REQUIREMENT_KEYWORDS`）。長いキーワードを優先しないと部分マッチが起きる。

### `<bcp14>` タグの正規化

`<bcp14>MUST</bcp14>` を XML パース前に `normalizeBcp14Tags()` で素テキストに変換する。これを怠ると要件テキストからキーワードが脱落する。

### セクション番号の正規化

XML の `anchor`（`section-3.5`）と `number`（`3.5`）が混在する。`src/utils/section.ts` の `normalizeSectionNumber` で吸収。ツールはどちらの形式でも受け付ける。

### RFC 番号と XML 可用性

RFC 8650 (2019年12月) 以降は RFCXML v3 が確実に利用可能。それ以前はテキストフォールバック（`src/config.ts` の `RFC_CONFIG.xmlAvailableFrom`）。

### `<references>` の入れ子

`collectReferenceSections()` で再帰的にフラット化して normative/informative を分離する。

---

## 共通パターン

横断的な実装パターンは `shuji-mcp-patterns` skill に分離済み。新規ツール追加時は `handler-dispatch.md` のチェックリストを参照。

---

## 変更履歴

技術的背景の詳細は [CHANGELOG.md](./CHANGELOG.md) を参照。
