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
