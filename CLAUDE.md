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

### 要求 ID ラベルと重複排除

RFC 1122 の系譜を引く RFC（RFC 9293 など）は本文に `(MUST-14)` `(MAY-3)` という
要求 ID ラベルを埋め込む。`\bMUST\b` はハイフンの直前でも単語境界が成立するため、
キーワード走査はラベルにも一致する。**これは意図した挙動である**。
RFC 9293 §3.7.1 の MUST-67 のように、BCP 14 キーワードを持たずラベルだけで要求を
示す文があり、ラベルを除外するとこれを取りこぼす。

代わりに `extractRequirementsFromSections`（`src/utils/requirement-extractor.ts`）で
「セクション + レベル + 要件文」を鍵に重複を排除する。文が同一なら要件としても
同一なので、最初の 1 件だけを残す。新しい抽出経路を足すときはこの不変条件を壊さないこと。

### インライン要素はパース前に素テキストへ落とす

パーサは `preserveOrder: false` で動く。インライン要素（`<bcp14>` `<xref>` `<tt>`
`<em>` `<strong>` `<sup>` など）は本文テキストから**位置ごと**落ちるため、
`extractText` の側では直せない。`(<xref .../>)` が `()` だけになり、
"HEADERS<tt>…</tt>frame" が "HEADERSframe" になっていたのがこれである。

対処は `parseRFCXML` の入口で行う。適用順は
`normalizeBcp14Tags` → `renderXrefTags` → `renderInlineTags`。
xref を先に解くのは `<em><xref/></em>` のような入れ子を内側から組み立てるため。
新しい要素で同じ症状が出たら、`extractText` ではなくここに足すこと。

置き換えは**公開版 .txt の印字に合わせる**（推測しない）。`<em>` は `_X_`、
`<strong>` は `*X*`、`<sup>` は `^X`、`<contact fullname="N"/>` は `N`、
`<iref>` は何も出さない。`<tt>` は素のまま（引用符で囲む RFC もあるが、
公開版 10 本での一致率は囲まない方が高い）。

`renderXrefTags` は `format` / `sectionFormat` と `derivedContent` に従う。
中身がある `<xref>` は「中身 + 参照先」（"RFC 793 [16]"）。付録は `derivedLink` の
`#appendix-` を根拠に "Appendix B" と書く。

検証は「公開版 RFC の .txt に本文段落がそのまま現れるか」で行う
（`/tmp` の fidelity スクリプトと同じ考え方。折り返しのハイフンとスラッシュは
両側で正規化する）。v0.6.4 時点で RFC 9293 / 9110 / 9114 とも 100%。

### 散文の空白は畳む。図とコードは畳まない

XML 経路の散文（`<t>` / 節の題名 / リスト項目 / 定義 / 参考文献の題名）は
`extractProse()` を通す。インライン要素を素テキストへ置き換えると、要素が独立した
行に置かれていた分の字下げが残り、`"They            MAY\n also be sent"` になる。
段落内の改行と字下げは表示上のもので意味を持たない。

**`<sourcecode>` と `<artwork>` には使わない。** 空白が意味を持つ。
新しい抽出を足すときは、散文か図かで使い分けること。

テキスト経路は畳んでいない。そこでの体裁は RFC の .txt そのものであり、
かつ ASCII 図も text ブロックとして入る（RFC 6455 §5.2 の frame 図）。
一律に畳むと図が壊れる。畳むなら図の判別が先に要る。

### 自動生成の索引は定義ではない

索引の節は用語ごとに出現箇所を並べた `<dl>` を持つ。`<name>` が "Index" の節を
`extractDefinitions` から除外する（anchor は付かず `pn` も連番なので名前で見る）。
**後付録ごと除外してはならない** — RFC 9114 の Appendix A.2.5 のように本物の定義が
後付録に置かれる。

### テキスト経路の題名と節

- 題名はヘッダ塊（発行者と著者の 2 段組）を最初の空行で終端し、その次の
  非空行から取る。「コロンを含まない行」で探すと 1 行目を拾う。
- 目次の行は「リーダー + ページ番号」で終わる。ドット + 空白と連続ドットの
  2 形式があり、どちらも `isValidSectionHeader` で落とす。落とさないと同じ
  節番号が 2 回現れ、`findSection` がどちらを引くか定まらない。
- 題名が取れないときは `metadata.title` を `undefined` にして、
  Datatracker の題名へ落とす（`handlers.ts`）。

節見出しは **1 桁目から始まる**。`line.trim()` してから照合すると字下げが失われ、
本文の番号付きリスト項目（`"   1.  The components of the URI MUST be valid."`）を
節として拾う。拾うと節番号が重複し、その行の要件も抽出されなくなる
（題名として消費されるため）。

### 別文書の節と、この RFC の節を混ぜない

`<xref>` を描画すると本文に "Section 11.2 of [HTTP/1.1]" が現れる。これは
**この RFC の §11.2 ではない**。`extractCrossReferences` は別文書の節を
`type: 'external'`、この RFC の節を `type: 'section'` に分ける。
`collectCrossReferences`（`get_related_sections`）は `section` だけを見る。

混ぜると、無関係な節の題名を確信ありげに返す。RFC 9110 §9.3.1 で
"Section 11.2 of [HTTP/1.1]" を §11.2 "Authentication Parameters" として
返していたのがそれである。

### 文末の判定は `isSentenceEnd` に集約する

ピリオドを無条件に文末とみなすと、要件文が節番号や略語で切れる。RFC 本文には
"(see Section 5.3 for further details)." や "(e.g., ...)" が頻出する。

- 文末の条件は「句読点の直後が空白か文字列の終わり」かつ「直前が略語でない」。
- 節（clause）の切り出しは `clipAtClauseEnd`。括弧の中のカンマでは切らない。
  `condition` / `exception` / `action` はこれを通す（`[^,.]+` で止めない）。

Why: 切れた文と完全な文が別々の要件として並び、重複にも見えていた。
How to apply: 新しい抽出で「最初のピリオドまで」を書きたくなったら、必ずこの 2 つを使う。

### 別文書参照は角括弧の形だけではない

`sectionFormat="bare"` の `<xref>` は地の文が文書名を書くため、
"Section 3.4 of RFC 1122" や "RFC 6691, Section 3.1" という平文の形になる。
`createExternalSectionRegexes` は角括弧の形（`[HTTP/1.1]`）と RFC 番号の形の
両方を持つ。片方だけだと、もう一方が素通りしてこの RFC の節として解決される。

### 公開日は本文から取る

Datatracker の `document.time` は**レコードの最終更新時刻**であって公開日ではない
（RFC 9293 は 2026-05-20 を返す。公開は 2022-08）。公開日は RFCXML の `front/date`、
テキスト経路ではヘッダ行から取る。`RFCMetadata.datatrackerUpdated` が前者の値だが、
ツールの応答には出さない。

### `validate_statement` は判定器ではない

- `isValid` は三値（`true` / `false` / `null`）。最上位マッチが
  `MIN_SCORE_FOR_VERDICT` と `MIN_CONTENT_KEYWORDS_FOR_VERDICT`（主語以外の一致語 2 語）の
  両方を満たさなければ `null` を返す。主語だけの一致はスコア 8 に達するが、
  何を論じているかを示していないので判定しない。`true` を準拠の証明として扱わないこと。
- `STOP_WORDS` には 3 文字以上の機能語と BCP 14 キーワードを入れる。入れ忘れると
  内容の一致が無い要件でも機能語だけでスコアが積み上がり、順位が内容で決まらなくなる。
- 語形の違いは `keywordVariants` が吸収する（主張 "masks" と要件 "mask"）。
  語幹が 4 文字未満になる語尾は落とさない。
- 矛盾検出は要件文全体ではなく `requiredActionOf()`（キーワードより後ろ）だけを見る。
  条件節の否定を要求アクションと取り違えないための不変条件である。
- `NEGATION_PAIRS` に一般的な動詞（send / receive など）を足すときは `generic: true` を
  付ける。動詞以外に共通する語を 1 つ以上求めるようになり、誤検出を抑えられる。

### `<references>` の入れ子

`collectReferenceSections()` で再帰的にフラット化して normative/informative を分離する。

---

## 共通パターン

横断的な実装パターンは `shuji-mcp-patterns` skill に分離済み。新規ツール追加時は `handler-dispatch.md` のチェックリストを参照。

---

## 変更履歴

技術的背景の詳細は [CHANGELOG.md](./CHANGELOG.md) を参照。
