# rfcxml-mcp

LLM が RFC 文書を構造的に理解するための MCP（Model Context Protocol）サーバーです。

- npm: [`@shuji-bonji/rfcxml-mcp`](https://www.npmjs.com/package/@shuji-bonji/rfcxml-mcp)
- ソースコード: [shuji-bonji/rfcxml-mcp](https://github.com/shuji-bonji/rfcxml-mcp) ・ [変更履歴](https://github.com/shuji-bonji/rfcxml-mcp/blob/main/CHANGELOG.md)
- 動作環境: Node.js 22 以上

## できること

このサーバーは、公開済みの RFC を構造的に読み取り、LLM が扱いやすい形で返します。RFC の本文をそのまま返すのではなく、RFCXML の意味構造を解析して、次の情報を取り出します。

- 節（セクション）の階層と、題名・公開日・分類などのメタデータ
- 規範的要件（MUST / SHOULD / MAY など BCP 14 のキーワードを含む文）と、その主語・条件・例外
- 用語の定義
- 参照している RFC（normative / informative の区別付き）と、この RFC を参照している RFC
- 指定した節と関連する節
- 実装チェックリスト（Markdown）
- ある主張に関係する要件と、その主張と要件との間に見つかった矛盾

RFC 8650（2019 年 12 月）以降の RFC には公式の RFCXML v3 が用意されています。それより前の RFC には XML が無いものが多く、その場合はテキスト形式（`.txt`）を解析します。どちらの経路で解析したかは、すべての応答に付く `_source` で分かります。

| `_source` | 解析元 | 精度 |
| --------- | ------------------ | ---------------------------------------------------------- |
| `xml` | RFCXML | 高い |
| `text` | テキスト形式の RFC | 中程度。落ちるものは [精度と制約](/ja/guide/accuracy) を参照 |

::: tip 応答を読むときは `_source` を先に見てください
`_source: "text"` の応答は、節の階層や要件の切り出しの精度が下がっています。`_sourceNote` が付いている場合は、その理由が書かれています。
:::

## できないこと

::: warning 適合判定はしません
`validate_statement` は、主張に関係する要件を探して返し、明らかな矛盾があれば報告するツールです。準拠しているかどうかの判断は利用者が行います。`isValid: true` は「矛盾が見つからなかった」という意味であって、準拠の証明ではありません。値の読み方は [精度と制約](/ja/guide/accuracy#validate-statement-は判定器ではありません) を参照してください。
:::

- **公開済みの RFC しか扱いません。** Internet-Draft や任意の URL は対象外です。
- **Web 検索はしません。** 取得元は rfc-editor.org と IETF Datatracker API に固定しています。

## ツール一覧

| ツール | 説明 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| [`get_rfc_structure`](/ja/reference/tools#get-rfc-structure) | 節の階層とメタデータを返す。メタデータは IETF Datatracker API で補完する |
| [`get_requirements`](/ja/reference/tools#get-requirements) | 規範的要件（MUST / SHOULD / MAY）を構造化して返す |
| [`get_definitions`](/ja/reference/tools#get-definitions) | 用語の定義を返す |
| [`get_rfc_dependencies`](/ja/reference/tools#get-rfc-dependencies) | 参照関係（normative / informative）を返す |
| [`get_related_sections`](/ja/reference/tools#get-related-sections) | 指定した節と関連する節を返す |
| [`generate_checklist`](/ja/reference/tools#generate-checklist) | 実装チェックリストを Markdown で生成する |
| [`validate_statement`](/ja/reference/tools#validate-statement) | 主張に関係する要件を探し、矛盾があれば報告する。適合判定はしない |

各ツールのパラメータは [ツール](/ja/reference/tools)、実際の出力は [出力例](/ja/reference/examples)、サーバーが接続時にクライアントへ渡す説明文は [サーバーの instructions](/ja/reference/instructions) にあります。

## 既存の MCP との違い

RFC を扱う MCP サーバーには、RFC の本文を取得して返すものが既にあります。rfcxml-mcp は、本文の取得に加えて、本文の中から構造を取り出す点が異なります。

| 機能 | 本文を返す MCP | rfcxml-mcp |
| -------------------------- | ------------------ | -------------- |
| RFC 本文の取得 | ✅ | ✅ |
| 節の抽出 | ✅（テキスト基準） | ✅（構造基準） |
| MUST / SHOULD / MAY の抽出 | ❌ | ✅ |
| 条件・例外の構造化 | ❌ | ✅ |
| RFC の依存関係 | ❌ | ✅ |
| 用語の定義 | ❌ | ✅ |
| 実装チェックリスト | ❌ | ✅ |

## 次に読むページ

- [導入](/ja/guide/install) — Claude Desktop / Claude Code への登録、バージョンの固定、ディスクキャッシュ
- [精度と制約](/ja/guide/accuracy) — テキスト経路で落ちるもの、`isValid` の意味、公開前に通している検査
