# RFCXML MCP Server

RFC 文書を **構造的に理解** するための MCP サーバー。

## 目的

既存の RFC MCP サーバー（テキストベース）と異なり、RFCXML の意味構造を活用して：

- **規範性要件（MUST/SHOULD/MAY）** の抽出・構造化
- **RFC 間依存関係グラフ** の構築
- **定義語のスコープ管理**
- **実装チェックリストの自動生成**

を可能にする。

## レイヤー構造

```
┌─────────────────────────┐
│  Markdown / PDF         │  表示・共有
├─────────────────────────┤
│  翻訳                   │  説明・検証・普及
├─────────────────────────┤
│  RFCXML MCP             │  AI と人の共通理解基盤
├─────────────────────────┤
│  RFCXML                 │  唯一の真実（Single Source of Truth）
└─────────────────────────┘
```

## 既存 MCP との違い

| 機能                 | 既存 mcp-rfc        | RFCXML MCP      |
| -------------------- | ------------------- | --------------- |
| RFC テキスト取得     | ✅                  | ✅              |
| セクション抽出       | ✅ (テキストベース) | ✅ (構造ベース) |
| MUST/SHOULD/MAY 抽出 | ❌                  | ✅              |
| 条件・例外の構造化   | ❌                  | ✅              |
| RFC 間依存グラフ     | ❌                  | ✅              |
| 定義スコープ管理     | ❌                  | ✅              |
| 実装チェックリスト   | ❌                  | ✅              |

## クイックスタート

### Claude Desktop / Claude Code で使用

MCP 設定ファイルに以下を追加：

```json
{
  "mcpServers": {
    "rfcxml": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/rfcxml-mcp"]
    }
  }
}
```

版を固定したいとき（0.6 系はパッチが頻繁に出る）は、パッケージ名に版を書く：

```json
{
  "mcpServers": {
    "rfcxml": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/rfcxml-mcp@0.6.53"]
    }
  }
}
```

取得した RFC を再起動後も使い回すには `RFCXML_CACHE_DIR` を渡す（[ディスクキャッシュと `rfcxml-prefetch`](#ディスクキャッシュと-rfcxml-prefetch) を参照）：

```json
{
  "mcpServers": {
    "rfcxml": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/rfcxml-mcp@0.6.53"],
      "env": { "RFCXML_CACHE_DIR": "/home/you/.cache/rfcxml-mcp" }
    }
  }
}
```

設定ファイルの場所：

- **Claude Desktop (macOS)**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Windows)**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Claude Code (プロジェクトスコープ)**: プロジェクトルートの `.mcp.json`
- **Claude Code (ユーザースコープ)**: `~/.claude.json`
- **Claude Code (CLI)**: `claude mcp add rfcxml -- npx -y @shuji-bonji/rfcxml-mcp`

### インストール（オプション）

グローバルインストールする場合：

```bash
npm install -g @shuji-bonji/rfcxml-mcp
```

MCP 設定：

```json
{
  "mcpServers": {
    "rfcxml": {
      "command": "rfcxml-mcp"
    }
  }
}
```

## 利用可能なツール

### Phase 1: 基本構造

- `get_rfc_structure` - セクション階層とメタデータ取得
- `get_requirements` - 規範性要件（MUST/SHOULD/MAY）の構造化抽出
- `get_definitions` - 用語定義とスコープ

### Phase 2: 関係性

- `get_rfc_dependencies` - 参照 RFC（normative/informative）
- `get_related_sections` - 関連セクション（同一 RFC 内）

### Phase 3: 検証支援

- `validate_statement` - 主張に関係する RFC の要件を探し、検出した矛盾を報告する。**適合判定ではない**。`isValid` は三値（`null` = 判断できるだけの一致が無い、`false` = 矛盾を検出した、`true` = 一致した要件の中に矛盾が無かった）。判断は利用者が下す。
- `generate_checklist` - 実装チェックリスト生成

## 古い RFC のサポート

RFC 8650 (2019年12月) 以降は公式 RFCXML v3 形式で提供されていますが、それ以前の RFC は XML が利用できない場合があります。

このサーバーは **自動フォールバック機能** を備えており、XML が取得できない場合はテキスト形式から解析を行います。

### ソース情報

すべてのレスポンスには解析ソース情報が含まれます：

```json
{
  "rfc": 6455,
  "sections": [...],
  "_source": "text",
  "_sourceNote": "Warning: Parsed from text format. Accuracy may be limited."
}
```

> **Note**: v0.4.0 以降、すべてのメッセージは英語で出力されます（国際化対応）。

| `_source` | 説明                       |
| --------- | -------------------------- |
| `xml`     | RFCXML から解析（高精度）  |
| `text`    | テキストから解析（中精度） |

### 対応状況

| RFC           | 形式     | 備考               |
| ------------- | -------- | ------------------ |
| RFC 8650 以降 | XML      | RFCXML v3 公式対応 |
| RFC 8650 未満 | テキスト | 自動フォールバック |

## 出力サンプル

以下の見本はすべて、現行のビルド（`npm run build` のあと、MCP クライアントから各見出しのツール呼び出し）の実際の出力から切り出したもの。フィールド名と値はそのまま、長い配列は `...` で省いている。

### `get_rfc_structure` - RFC構造取得

`get_rfc_structure { "rfc": 9293 }`

```json
{
  "metadata": {
    "title": "Transmission Control Protocol (TCP)",
    "docName": "draft-ietf-tcpm-rfc793bis-28",
    "number": 9293,
    "date": "2022-08",
    "category": "std",
    "stream": "IETF",
    "abstract": "This document specifies the Transmission Control Protocol (TCP). ..."
  },
  "sections": [
    { "number": "1", "title": "Purpose and Scope" },
    { "number": "2", "title": "Introduction" },
    {
      "number": "3",
      "title": "Functional Specification",
      "subsections": [
        { "number": "3.1", "title": "Header Format" },
        {
          "number": "3.5",
          "title": "Establishing a Connection",
          "subsections": [
            { "number": "3.5.1", "title": "Half-Open Connections and Other Anomalies" },
            { "number": "3.5.2", "title": "Reset Generation" },
            { "number": "3.5.3", "title": "Reset Processing" }
          ]
        }
      ]
    }
  ],
  "referenceCount": { "normative": 15, "informative": 85 },
  "_source": "xml"
}
```

`number` は RFC が印字する節番号（`3.5`、`A.2`）であり、RFCXML の `pn`（`section-3.5`）ではない。`category` / `stream` / `abstract` は IETF Datatracker API から取る。API に届かなかったとき、および対応表に無い値のとき（RFC 1 は `unkn` / `legacy`）は**省略**し、`_sourceNote` にその旨を書く。

### `get_requirements` - 規範性要件抽出

`get_requirements { "rfc": 9293, "level": "MUST" }`

```json
{
  "rfc": 9293,
  "filter": { "section": "all", "level": "MUST" },
  "stats": { "total": 55, "byLevel": { "MUST": 55 } },
  "requirements": [
    {
      "id": "R-3.5-1",
      "level": "MUST",
      "text": "A TCP implementation MUST support simultaneous open attempts (MUST-10).",
      "section": "3.5",
      "sectionTitle": "Establishing a Connection",
      "fullContext": "A TCP implementation MUST support simultaneous open attempts (MUST-10).",
      "subject": "tcp implementation",
      "action": "support simultaneous open attempts (MUST-10)"
    },
    {
      "id": "R-3.7.1-1",
      "level": "MUST",
      "text": "TCP endpoints MUST implement both sending and receiving the MSS Option (MUST-14).",
      "section": "3.7.1",
      "sectionTitle": "Maximum Segment Size Option",
      "fullContext": "TCP endpoints MUST implement both sending and receiving the MSS Option (MUST-14).",
      "subject": "tcp endpoints",
      "action": "implement both sending and receiving the MSS Option (MUST-14)"
    }
  ],
  "_source": "xml"
}
```

`id` は `R-<節>-<n>` で、`n` は節ごとの連番。他の節に要件が増えても識別子が変わらない。

### `get_rfc_dependencies` - 依存関係取得

`get_rfc_dependencies { "rfc": 9293 }`

```json
{
  "rfc": 9293,
  "normative": [
    { "rfcNumber": 791, "title": "Internet Protocol", "anchor": "RFC0791" },
    { "rfcNumber": 1191, "title": "Path MTU discovery", "anchor": "RFC1191" },
    {
      "rfcNumber": 2119,
      "title": "Key words for use in RFCs to Indicate Requirement Levels",
      "anchor": "RFC2119"
    }
  ],
  "informative": [
    { "rfcNumber": 793, "title": "Transmission Control Protocol", "anchor": "RFC0793" },
    { "rfcNumber": 896, "title": "Congestion Control in IP/TCP Internetworks", "anchor": "RFC0896" }
  ],
  "_source": "xml",
  "_referencesSource": "xml"
}
```

`_referencesSource` は参照一覧の出どころ。`xml`（RFCXML の `<references>`）、`text`（テキストの References 節）、`api`（Datatracker の `relateddocument`。題名は仮置き）のいずれか。

### `generate_checklist` - 実装チェックリスト生成

`generate_checklist { "rfc": 9293, "role": "client", "sections": ["3.5", "3.7.1"] }` — `markdown` フィールド：

```markdown
# RFC 9293 Implementation Checklist

**Transmission Control Protocol (TCP)**

Role: client

Generated: 2026-09-04T17:09:37.833Z

## Mandatory Requirements (MUST / REQUIRED / SHALL)

- [ ] **MUST** A TCP implementation MUST support simultaneous open attempts (MUST-10). (§3.5)
- [ ] **MUST** TCP endpoints MUST implement both sending and receiving the MSS Option (MUST-14). (§3.7.1)
- [ ] **MUST** If an MSS Option is not received at connection setup, TCP implementations MUST assume a default send MSS of 536 (576 - 40) for IPv4 or 1220 (1280 - 60) for IPv6 (MUST-15). (§3.7.1)

## Recommended Requirements (SHOULD / RECOMMENDED)

- [ ] **SHOULD** TCP implementations SHOULD allow a received RST segment to include data (SHLD-2). (§3.5.3)
```

同じ呼び出しは `"stats": { "must": 6, "should": 2, "may": 1, "total": 9 }` も返す。

### `validate_statement` - 関係する要件の検索

`validate_statement { "rfc": 6455, "statement": "The client MUST mask all frames sent to the server." }`

```json
{
  "rfc": 6455,
  "statement": "The client MUST mask all frames sent to the server.",
  "analysis": { "detectedLevel": "MUST", "detectedSubject": "client" },
  "isValid": true,
  "matchingRequirements": [
    {
      "id": "R-5.3-2",
      "level": "MUST",
      "text": "When preparing a masked frame, the client MUST pick a fresh masking key from the set of allowed 32-bit values.",
      "section": "5.3",
      "sectionTitle": "Client-to-Server Masking",
      "_matchScore": 17,
      "_matchedKeywords": ["client", "mask", "frames"],
      "_subjectMatch": true,
      "_levelMatch": true
    }
  ],
  "conflicts": [],
  "_source": "text",
  "_sourceNote": "Warning: Parsed from text format. Validation accuracy may be limited."
}
```

`isValid: true` は「一致した要件の中に矛盾が無かった」以上の意味を持たない。十分に強い一致が無ければ `isValid` は `null` になり、`_verdictNote` に理由が入る。

### テキストフォールバック時の出力（古いRFC）

`get_rfc_structure { "rfc": 6455 }` — RFC 6455 は RFCXML v3 より前なので、テキストを解析する：

```json
{
  "metadata": {
    "title": "The WebSocket Protocol",
    "number": 6455,
    "date": "2011-12",
    "category": "std",
    "stream": "IETF",
    "abstract": "The WebSocket Protocol enables two-way communication ..."
  },
  "sections": [
    { "number": "1", "title": "Introduction" },
    { "number": "2", "title": "Conformance Requirements" },
    { "number": "5", "title": "Data Framing" }
  ],
  "referenceCount": { "normative": 18, "informative": 9 },
  "_source": "text",
  "_sourceNote": "Warning: Parsed from text format. Accuracy may be limited."
}
```

RFC 8650 以上はまず XML を試す。すべての取得元が 404 なら失敗する（"No RFC with that number is published"）。404 以外（5xx・タイムアウト）で XML が取れなかったときはテキストを使い、`_sourceNote` に「XML の取得に失敗した（一時的な失敗の可能性）」と書く。

## ディスクキャッシュと `rfcxml-prefetch`

既定では、取得した RFC はメモリの LRU にしか入らず、再起動のたびに取り直す。`RFCXML_CACHE_DIR` を設定するとディスクに残る：

```
$RFCXML_CACHE_DIR/
├── xml/rfc9293.xml     # RFCXML（RFC 8650 以上）
└── text/rfc6455.txt    # テキスト（それより前の RFC、または XML の取得に失敗したとき）
```

同じ配置をあらかじめ埋める CLI `rfcxml-prefetch` も同梱している（オフライン・CI 向け）：

```bash
# 範囲を $RFCXML_CACHE_DIR（未設定なら ~/.cache/rfcxml-mcp）へ取得
npx -y -p @shuji-bonji/rfcxml-mcp rfcxml-prefetch --range 9110-9114

# 個別の RFC、ディレクトリ指定、キャッシュ済みでも取り直す
npx -y -p @shuji-bonji/rfcxml-mcp rfcxml-prefetch --rfc 6455 --rfc 9293 --cache-dir ./rfc-cache --force
```

オプション: `--range A-B`、`--rfc N`（繰り返し可）、`--cache-dir DIR`、`--concurrency N`（既定 3）、`--force`。ディスクにある RFC（XML でもテキストでも）は `--force` が無ければ飛ばす。RFC 番号は数字のみ。`--rfc 9110abc` は終了コード 1。

## サンプル

[examples/](./examples/) ディレクトリに `generate_checklist` ツールで生成したチェックリストのサンプルがあります：

| RFC                                                   | プロトコル | ソース                     |
| ----------------------------------------------------- | ---------- | -------------------------- |
| [RFC 6455](./examples/rfc6455-websocket-checklist.md) | WebSocket  | テキスト（フォールバック） |
| [RFC 9293](./examples/rfc9293-tcp-checklist.md)       | TCP        | RFCXML                     |
| [RFC 7540](./examples/rfc7540-http2-checklist.md)     | HTTP/2     | テキスト（フォールバック） |

**Claude への依頼例：**

```
RFC 9293 (TCP) の実装チェックリストを生成してください。
```

## 内部アーキテクチャ

### モジュール構成

```
src/
├── index.ts                    # MCP サーバーエントリポイント
├── config.ts                   # 設定の一元管理
├── constants.ts                # BCP 14 キーワード定義 + RFC 番号制限
├── services/
│   ├── rfc-fetcher.ts          # RFC 取得（並列フェッチ）
│   ├── rfc-service.ts          # RFC パース・キャッシュ管理
│   ├── rfcxml-parser.ts        # RFCXML パーサー
│   ├── rfc-text-parser.ts      # テキストフォールバックパーサー
│   └── checklist-generator.ts  # チェックリスト生成サービス
├── tools/
│   ├── definitions.ts          # MCP ツール定義
│   └── handlers.ts             # ツールハンドラー（toolHandlers マップ）
├── types/
│   └── index.ts                # 型定義
└── utils/
    ├── cache.ts                # LRU キャッシュ
    ├── fetch.ts                # 並列フェッチユーティリティ
    ├── logger.ts               # ログ抽象化
    ├── requirement-extractor.ts # 共通要件抽出
    ├── section.ts              # セクション検索ユーティリティ
    ├── statement-matcher.ts    # 重み付きマッチング
    ├── text.ts                 # テキスト処理ユーティリティ
    └── validation.ts           # 入力バリデーション
```

### RFC 取得の最適化

XML の取得元 2 つ（RFC Editor、Datatracker）に並列リクエストを送信し、最初に成功したレスポンスを採用する。`tools.ietf.org` は 2021 年に廃止され、使っていない。リトライは無く、並列取得が唯一の冗長化である。

```
┌─────────────────┐
│  fetchRFCXML()  │
└────────┬────────┘
         │ 並列リクエスト
    ┌────┴─────────┐
    ▼              ▼
┌────────┐    ┌────────┐
│RFC     │    │Data-   │
│Editor  │    │tracker │
└────┬───┘    └────┬───┘
     │             │
     └──────┬──────┘
            │ Promise.any（最初の成功）
            ▼
    ┌───────────┐
    │ 成功した  │ → 他のリクエストを AbortController でキャンセル
    │ レスポンス│
    └───────────┘
```

同じ RFC への同時呼び出し（`get_rfc_structure` と `get_requirements` を並列に出すなど）は、取得と解析を 1 本にまとめる。

### キャッシュ戦略

LRU（Least Recently Used）キャッシュでメモリ使用量を制限する。XML / Text キャッシュの下に、任意のディスクキャッシュ（`RFCXML_CACHE_DIR`）がある：

| キャッシュ          | 最大エントリ数 | 内容           |
| ------------------- | -------------- | -------------- |
| XML キャッシュ      | 20             | 生の RFCXML    |
| Text キャッシュ     | 20             | 生のテキスト   |
| Metadata キャッシュ | 100            | RFC メタデータ |
| Parse キャッシュ    | 50             | パース済み構造 |

## 開発

```bash
# 依存関係インストール
npm install

# 開発モード
npm run dev

# ビルド
npm run build

# 単体テスト（単発実行）／ウォッチモード
npm test
npm run test:watch

# E2E テスト（MCP クライアント統合。実物の RFC を数本取りに行く）
npm run test:e2e

# 実物の RFC への監査・ツール間の突き合わせ・出力見本
#（tests/audit/README.md を参照。.github/workflows/audit.yml が週次で回す）
npm run audit
npm run crosscheck
npm run snapshot

# リント
npm run lint

# フォーマット
npm run format
```

## ライセンス

MIT

## 関連プロジェクト

- [mjpitz/mcp-rfc](https://github.com/mjpitz/mcp-rfc) - テキストベースの RFC MCP
- [ietf-tools/RFCXML](https://github.com/ietf-tools/RFCXML) - RFCXML スキーマ
- [xml2rfc](https://xml2rfc.ietf.org/) - IETF 公式ツール
