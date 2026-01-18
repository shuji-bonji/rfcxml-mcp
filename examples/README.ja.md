# サンプル

このディレクトリには rfcxml-mcp の `generate_checklist` ツールで生成したサンプル出力が含まれています。

## チェックリスト一覧

| ファイル                                                           | RFC      | 説明                                | ソース                     |
| ------------------------------------------------------------------ | -------- | ----------------------------------- | -------------------------- |
| [rfc6455-websocket-checklist.md](./rfc6455-websocket-checklist.md) | RFC 6455 | WebSocket プロトコル                | テキスト（フォールバック） |
| [rfc9293-tcp-checklist.md](./rfc9293-tcp-checklist.md)             | RFC 9293 | TCP (Transmission Control Protocol) | RFCXML                     |
| [rfc7540-http2-checklist.md](./rfc7540-http2-checklist.md)         | RFC 7540 | HTTP/2                              | テキスト（フォールバック） |

## チェックリストの生成方法

### Claude Desktop / Claude Code を使用

rfcxml-mcp を設定した後、Claude にチェックリストの生成を依頼できます。

```
RFC 9293 (TCP) の実装チェックリストを生成してください。
```

```
RFC 6455 WebSocket のサーバー実装に必要な要件をチェックリストにしてください。
```

### MCP ツールの直接呼び出し

`generate_checklist` ツールは以下のパラメータを受け付けます。

| パラメータ | 型       | 説明                                                            |
| ---------- | -------- | --------------------------------------------------------------- |
| `rfc`      | number   | RFC 番号（必須）                                                |
| `role`     | string   | `"client"`、`"server"`、または `"both"`（デフォルト: `"both"`） |
| `sections` | string[] | 含めるセクション（省略時は全体）                                |

**リクエスト例：**

```json
{
  "rfc": 9293,
  "role": "server"
}
```

## ソース情報について

すべてのチェックリストにはソース情報が含まれています。

- **RFCXML（高精度）**: 公式 RFCXML v3 形式から解析
- **テキストフォールバック（中精度）**: プレーンテキスト形式から解析（RFC 8650 より前の RFC 用）

RFC 8650（2019年12月）以降に発行された RFC は RFCXML 形式で利用可能です。それ以前の RFC はテキストフォールバックを使用します。

## サンプルの再生成

サンプルを再生成するには：

```bash
cd /path/to/rfcxml-mcp
npm run build
node scripts/generate-examples.js
```

## 関連ツール

- `get_requirements` - チェックリストを生成せずに規範性要件を抽出
- `get_rfc_structure` - セクション階層とメタデータを取得
- `validate_statement` - 主張が RFC 要件に準拠しているか検証
