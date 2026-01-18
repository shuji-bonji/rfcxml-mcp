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

| 機能 | 既存 mcp-rfc | RFCXML MCP |
|------|-------------|------------|
| RFC テキスト取得 | ✅ | ✅ |
| セクション抽出 | ✅ (テキストベース) | ✅ (構造ベース) |
| MUST/SHOULD/MAY 抽出 | ❌ | ✅ |
| 条件・例外の構造化 | ❌ | ✅ |
| RFC 間依存グラフ | ❌ | ✅ |
| 定義スコープ管理 | ❌ | ✅ |
| 実装チェックリスト | ❌ | ✅ |

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

設定ファイルの場所：
- **Claude Desktop (macOS)**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Windows)**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Claude Code**: `.claude/settings.json` または `claude settings` コマンド

### インストール（オプション）

グローバルインストールする場合：

```bash
npm install -g @shuji-bonji/rfcxml-mcp

# MCP 設定
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

- `validate_statement` - 主張が RFC に準拠しているか検証
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
  "_sourceNote": "⚠️ テキストからの解析結果です。精度が低い可能性があります。"
}
```

| `_source` | 説明 |
|-----------|------|
| `xml` | RFCXML から解析（高精度） |
| `text` | テキストから解析（中精度） |

### 対応状況

| RFC | 形式 | 備考 |
|-----|------|------|
| RFC 8650 以降 | XML | RFCXML v3 公式対応 |
| RFC 8650 未満 | テキスト | 自動フォールバック |

## 出力サンプル

### `get_rfc_structure` - RFC構造取得

```json
{
  "metadata": {
    "title": "Transmission Control Protocol (TCP)",
    "docName": "draft-ietf-tcpm-rfc793bis-28",
    "number": 9293
  },
  "sections": [
    {
      "number": "section-1",
      "title": "Purpose and Scope"
    },
    {
      "number": "section-3",
      "title": "Functional Specification",
      "subsections": [
        { "number": "section-3.1", "title": "Header Format" },
        {
          "number": "section-3.5",
          "title": "Establishing a Connection",
          "subsections": [
            { "number": "section-3.5.1", "title": "Half-Open Connections and Other Anomalies" },
            { "number": "section-3.5.2", "title": "Reset Generation" }
          ]
        }
      ]
    }
  ],
  "referenceCount": { "normative": 15, "informative": 85 },
  "_source": "xml"
}
```

### `get_requirements` - 規範性要件抽出

```json
{
  "rfc": 9293,
  "filter": { "level": "MUST" },
  "stats": { "total": 53, "byLevel": { "MUST": 53 } },
  "requirements": [
    {
      "id": "R-section-3.5-5",
      "level": "MUST",
      "text": "A TCP implementation support simultaneous open attempts (MUST-10).",
      "section": "section-3.5",
      "sectionTitle": "Establishing a Connection"
    },
    {
      "id": "R-section-3.7.1-9",
      "level": "MUST",
      "text": "TCP endpoints implement both sending and receiving the MSS Option (MUST-14).",
      "section": "section-3.7.1",
      "sectionTitle": "Maximum Segment Size Option"
    }
  ],
  "_source": "xml"
}
```

### `get_rfc_dependencies` - 依存関係取得

```json
{
  "rfc": 9293,
  "normative": [
    { "rfcNumber": 791, "title": "Internet Protocol", "anchor": "RFC0791" },
    { "rfcNumber": 2119, "title": "Key words for use in RFCs to Indicate Requirement Levels" },
    { "rfcNumber": 5681, "title": "TCP Congestion Control" }
  ],
  "informative": [
    { "rfcNumber": 793, "title": "Transmission Control Protocol" },
    { "rfcNumber": 1122, "title": "Requirements for Internet Hosts - Communication Layers" }
  ],
  "_source": "xml"
}
```

### `generate_checklist` - 実装チェックリスト生成

```markdown
# RFC 9293 実装チェックリスト

**Transmission Control Protocol (TCP)**

役割: クライアント

## 必須要件 (MUST / REQUIRED / SHALL)

- [ ] A TCP implementation support simultaneous open attempts (MUST-10). (section-3.5)
- [ ] TCP endpoints implement both sending and receiving the MSS Option (MUST-14). (section-3.7.1)
- [ ] The RTO be computed according to the algorithm in, including Karn's algorithm (MUST-18). (section-3.8.1)

## 任意要件 (MAY / OPTIONAL)

- [ ] Implementers include "keep-alives" in their TCP implementations (MAY-5). (section-3.8.4)
```

### テキストフォールバック時の出力（古いRFC）

```json
{
  "metadata": {
    "title": "The WebSocket Protocol",
    "number": 6455
  },
  "sections": [
    { "number": "1", "title": "Introduction" },
    { "number": "5", "title": "Data Framing" }
  ],
  "_source": "text",
  "_sourceNote": "⚠️ テキストからの解析結果です。精度が低い可能性があります。"
}
```

## 内部アーキテクチャ

### モジュール構成

```
src/
├── index.ts                    # MCP サーバーエントリポイント
├── config.ts                   # 設定の一元管理
├── constants.ts                # BCP 14 キーワード定義
├── services/
│   ├── rfc-fetcher.ts          # RFC 取得（並列フェッチ）
│   ├── rfcxml-parser.ts        # RFCXML パーサー
│   └── rfc-text-parser.ts      # テキストフォールバック
├── tools/
│   ├── definitions.ts          # MCP ツール定義
│   └── handlers.ts             # ツールハンドラー
├── types/
│   └── index.ts                # 型定義
└── utils/
    ├── cache.ts                # LRU キャッシュ
    ├── fetch.ts                # 並列フェッチユーティリティ
    └── text.ts                 # テキスト処理ユーティリティ
```

### RFC 取得の最適化

複数ソース（RFC Editor、IETF Tools、Datatracker）に並列リクエストを送信し、最初に成功したレスポンスを採用：

```
┌─────────────────┐
│  fetchRFCXML()  │
└────────┬────────┘
         │ 並列リクエスト
    ┌────┴────┬────────────┐
    ▼         ▼            ▼
┌────────┐ ┌────────┐ ┌────────┐
│RFC     │ │IETF    │ │Data-   │
│Editor  │ │Tools   │ │tracker │
└────┬───┘ └────┬───┘ └────┬───┘
     │          │          │
     └────┬─────┴──────────┘
          │ Promise.any（最初の成功）
          ▼
    ┌───────────┐
    │ 成功した  │ → 他のリクエストを AbortController でキャンセル
    │ レスポンス│
    └───────────┘
```

### キャッシュ戦略

LRU（Least Recently Used）キャッシュでメモリ使用量を制限：

| キャッシュ | 最大エントリ数 | 内容 |
|-----------|---------------|------|
| XML キャッシュ | 20 | 生の RFCXML |
| Text キャッシュ | 20 | 生のテキスト |
| Metadata キャッシュ | 100 | RFC メタデータ |
| Parse キャッシュ | 50 | パース済み構造 |

## 開発

```bash
# 依存関係インストール
npm install

# 開発モード
npm run dev

# ビルド
npm run build

# テスト
npm test

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
