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

## インストール

```bash
npm install @shuji-bonji/rfcxml-mcp
```

## MCP 設定

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

## 使用例

### 規範性要件の抽出

```typescript
// ツール呼び出し
{
  "tool": "get_requirements",
  "arguments": {
    "rfc": 6455,
    "section": "5.5.1"
  }
}

// 結果
{
  "section": "5.5.1",
  "title": "Close",
  "requirements": [
    {
      "id": "R-5.5.1-1",
      "level": "MUST",
      "text": "endpoint MUST send a Close frame",
      "subject": "endpoint",
      "action": "send Close frame",
      "condition": "when closing connection",
      "fullContext": "After sending a control frame indicating..."
    }
  ]
}
```

### 実装チェックリスト生成

```typescript
// ツール呼び出し
{
  "tool": "generate_checklist",
  "arguments": {
    "rfc": 6455,
    "role": "client"
  }
}

// 結果（Markdown）
## RFC 6455 WebSocket Client 実装チェックリスト

### 必須要件 (MUST)
- [ ] Opening Handshake で Sec-WebSocket-Key を含める (Section 4.1)
- [ ] Close フレーム受信後、TCP 接続を閉じる (Section 5.5.1)
- [ ] マスクキーは予測不可能である必要がある (Section 5.3)

### 推奨要件 (SHOULD)
- [ ] Close フレームには理由を含める (Section 7.1.6)
```

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
```

## ライセンス

MIT

## 関連プロジェクト

- [mjpitz/mcp-rfc](https://github.com/mjpitz/mcp-rfc) - テキストベースの RFC MCP
- [ietf-tools/RFCXML](https://github.com/ietf-tools/RFCXML) - RFCXML スキーマ
- [xml2rfc](https://xml2rfc.ietf.org/) - IETF 公式ツール
