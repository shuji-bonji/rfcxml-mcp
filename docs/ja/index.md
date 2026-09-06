# rfcxml-mcp

RFC 文書を **構造的に理解** するための MCP（Model Context Protocol）サーバ。

- npm: [`@shuji-bonji/rfcxml-mcp`](https://www.npmjs.com/package/@shuji-bonji/rfcxml-mcp)
- ソース: [shuji-bonji/rfcxml-mcp](https://github.com/shuji-bonji/rfcxml-mcp) · [CHANGELOG](https://github.com/shuji-bonji/rfcxml-mcp/blob/main/CHANGELOG.md)
- Node.js 22 以上

## 何であり、何でないか

このサーバは公開済み RFC の構造化された **読み取り器** である。RFC のテキストをそのまま返すものではない。RFCXML の意味構造を読み、次を返す。

- 節の階層とメタデータ
- 規範性要件（MUST / SHOULD / MAY）の構造化した形
- 用語の定義
- 参照関係（normative / informative）
- 関連する節
- 実装チェックリスト
- 主張に関係する要件と、検出した矛盾

適合判定器ではなく、Web 検索でもない。`validate_statement` は一致した要件を返すだけで、判断は利用者が下す（[精度と制約](/ja/guide/accuracy) を参照）。対象は公開済み RFC だけで、Internet-Draft や任意の URL は扱わない。取得元は rfc-editor.org と IETF Datatracker API に固定している。

RFC 8650（2019 年 12 月）以降は公式の RFCXML v3 がある。それより前の RFC には XML が無いことが多く、その場合はテキスト形式を解析する。すべての応答に `_source`（`xml` か `text`）が付き、必要なときは `_sourceNote` も付く。

| `_source` | 説明                       |
| --------- | -------------------------- |
| `xml`     | RFCXML から解析（高精度）  |
| `text`    | テキストから解析（中精度） |

## ツール

| ツール                                                             | 説明                                                                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| [`get_rfc_structure`](/ja/reference/tools#get-rfc-structure)         | Get RFC section hierarchy and metadata. Metadata is enriched from the IETF Datatracker API.                             |
| [`get_requirements`](/ja/reference/tools#get-requirements)           | Extract normative requirements (MUST/SHOULD/MAY) from RFC in structured format.                                         |
| [`get_definitions`](/ja/reference/tools#get-definitions)             | Get term definitions from RFC.                                                                                          |
| [`get_rfc_dependencies`](/ja/reference/tools#get-rfc-dependencies)   | Get RFC reference relationships (normative/informative).                                                                |
| [`get_related_sections`](/ja/reference/tools#get-related-sections)   | Get sections related to the specified section.                                                                          |
| [`generate_checklist`](/ja/reference/tools#generate-checklist)       | Generate RFC implementation checklist in Markdown format.                                                               |
| [`validate_statement`](/ja/reference/tools#validate-statement)       | Find the RFC requirements that bear on a statement, and report detected contradictions. This does NOT decide conformance. |

パラメータの一覧: [ツール](/ja/reference/tools)。固定した出力: [出力例](/ja/reference/examples)。サーバがクライアントに渡す文面: [サーバの instructions](/ja/reference/instructions)。

## 既存 MCP との違い

| 機能                       | 既存の mcp-rfc     | RFCXML MCP         |
| -------------------------- | ------------------ | ------------------ |
| RFC テキスト取得           | ✅                 | ✅                 |
| 節の抽出                   | ✅（テキスト基準） | ✅（構造基準）     |
| MUST/SHOULD/MAY の抽出     | ❌                 | ✅                 |
| 条件・例外の構造化         | ❌                 | ✅                 |
| RFC 依存関係グラフ         | ❌                 | ✅                 |
| 定義語のスコープ管理       | ❌                 | ✅                 |
| 実装チェックリスト         | ❌                 | ✅                 |

## 次に読むもの

- [導入](/ja/guide/install) — Claude Desktop、Claude Code、版の固定、ディスクキャッシュ
- [精度と制約](/ja/guide/accuracy) — テキスト経路で落ちるもの、`isValid` の意味、公開前に通すもの
