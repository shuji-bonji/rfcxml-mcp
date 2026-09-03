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
npm run audit         # 実物の RFC 67 本に不変条件 44 種を当てる
npm run snapshot      # 代表的な出力 30 本を固定し、差分を見る
npm run lint          # リント
npm run format        # フォーマット
npm start             # MCP サーバー起動
npm run prefetch      # RFC 本文をディスクキャッシュに事前充填
```

`DEBUG=1 npm start` で詳細ログ出力。

### 公開前に通すもの

v0.6.0 から v0.6.13 まで、13 件の不具合はすべて**公開したあとの試用**で見つかった。
どれも公開は必要なかった。手元で同じ操作をすれば同じものが出た。

publish の前に、次を順に通す。

| 手順 | 見るもの |
|---|---|
| `npm test` | 書いた条件の取りこぼし（462 件） |
| `npm run test:e2e` | MCP クライアントから見た振る舞い（72 件） |
| `npm run audit` | 想定していない書式で破れる場所（RFC 67 本 × 44 種） |
| `npm run snapshot` | 条件に落とせない見た目の崩れ（出力見本 30 本） |
| `rfcxml-mcp-dev` で試用 | 実際の使い方で気づくもの |

`audit` と `snapshot` の詳細は `tests/audit/README.md` に書いた。
`rfcxml-mcp-dev` は `dist/index.js` を直接指すローカルの MCP 登録である。
`npm run build` のあと Claude Desktop を再起動すると、その版が試用できる。

### ディスクキャッシュ（Phase 3）

`RFCXML_CACHE_DIR` 環境変数を設定すると、`fetchRFCXML` と `fetchRFCText` が
永続キャッシュを利用する。RFCXML は `<dir>/xml/rfc{N}.xml`、テキストは
`<dir>/text/rfc{N}.txt` に置く。

RFCXML が公開されているのは RFC 8650 以降だけで、それより前はテキストで読む。
v0.6.14 まではテキストがメモリの LRU にしか入らず、MCP サーバを再起動するたびに
取り直していた（RFC 1122 の本文は 200 KB ある）。`rfcxml-prefetch` も
RFCXML が無い RFC を「失敗」として飛ばしていた。

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

**外に出す `section` と `id` は必ずこの関数を通すこと。** v0.6.5 まではテキスト経路が
`5.3`、XML 経路が `section-6.2.3` を返しており、`get_requirements` の結果をそのまま
`get_related_sections` に渡すと RFC ごとに文字列の形が変わっていた。後付録は
`section-appendix.a.2.5` → `A.2.5`（公開版 RFC の "Appendix A.2.5"）にする。
並べるときは `compareSectionNumbers`（数字は数として比べ、後付録は本文のあと）。

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

### 1 つの文が複数の要素に分かれて書かれる

RFC は「文 + 箇条書き」「文 + 表示例 + 文」で 1 つの文を書く。`<t>` だけを要件文に
すると "the origin server SHOULD send" で終わる。`pn` の連番で節の中の要素を
並べ直し（`orderedElements()`）、文末記号が無いあいだ次の要素を 3 つまで取り込む
（`mergeContinuations()`）。テキスト経路では段落単位で同じことをする
（`joinUnterminatedParagraphs()`）。

**取り込んだ要素は消すこと。** 残すと、その中の要件が「単独の段落」と「繋いだ段落」の
2 か所から出て、ほとんど同じ文が 2 件並ぶ。

**BCP 14 キーワードを含む段落だけを繋ぐこと。** `<t>An example is</t>` のような
表示例の見出しは文末記号が無いのが普通で、繋ぐと要件文の頭に日付の例が付く。

**箇条書きは RFC 自身の区切りを使うこと**（`joinListItems()`）。RFC の項目は
"…enacted," "…supplied, or" "…status." と自分で区切りを持っていることが多い。
一律に "; " で繋ぎ末尾に "." を足すと `enacted,; a 204` `status..` になる。

### 散文の空白は畳む。図とコードは畳まない

XML 経路の散文（`<t>` / 節の題名 / リスト項目 / 定義 / 参考文献の題名）は
`extractProse()` を通す。インライン要素を素テキストへ置き換えると、要素が独立した
行に置かれていた分の字下げが残り、`"They            MAY\n also be sent"` になる。
段落内の改行と字下げは表示上のもので意味を持たない。

**`<sourcecode>` と `<artwork>` には使わない。** 空白が意味を持つ。
新しい抽出を足すときは、散文か図かで使い分けること。

**図・表の行に当たった要件は、その 1 行だけを切り出す。** 段落全体を対象にすると、
表の全行が 1 件の要件になる（RFC 2131 §4.3.1 の Table 3 は 2 ページある）。
表の中のキーワードは、その行の話である。

**`Requirement.text` は必ず 1 行にする。** 要件文は文として読まれ、
`generate_checklist` は 1 項目 1 行の Markdown にする。図の桁を保つのは
`fullContext` の役目である。表や擬似コードから取った要件文を畳まずに返すと、
チェックリストが崩れる（RFC 2131 で 235 行）。

テキスト経路（v0.6.6 以降）は、段落が図・ABNF でなければ `fullContext` を畳む。図の判別は `looksLikeDiagram()`（`src/utils/text.ts`）が体裁で行う。

- 目印にするもの: 行頭から始まる ABNF の規則（`frame-rsv1 = %x0 / %x1`）、
  2 個以上の空白のあとのセミコロン、4 文字以上続く罫線、同じ行で空白が続く縦罫、
  `|` で始まり `|` で終わる行、**1 行に 3 個以上の空白の連なりが 2 回以上ある行**
  （RFC 2131 の空白で桁を揃えた表）。RFC の散文は 72 桁で折り返され、行の途中に
  3 個以上の空白は入らない。
- **目印にしないもの**: `%x0A`（RFC 7230 §3 は散文で "the octet LF (%x0A)" と書く）、
  `|` のあとの改行（RFC 6455 は本文でヘッダ名を `|Origin|` と括る）。
  どちらも散文を図と誤判定させていた。

ABNF の注釈（`; 1 bit in length, MUST be 0 unless`）は規範的な文が書かれる場所で、
続く注釈行をまとめて `;` を外し、1 行の散文として要件にする（`requirementSource()`）。

### 自動生成の索引は定義ではない

索引の節は用語ごとに出現箇所を並べた `<dl>` を持つ。`<name>` が "Index" の節を
`extractDefinitions` から除外する（anchor は付かず `pn` も連番なので名前で見る）。
**後付録ごと除外してはならない** — RFC 9114 の Appendix A.2.5 のように本物の定義が
後付録に置かれる。

### 並列の読点では切らない

`clipAtClauseEnd()` は読点で切るが、"A, B, or C" の読点では切らない。切ると RFC 6455 §5.4 の
"MUST be either text, binary, or one of the reserved opcodes" の `action` が
`"be either text"` になる。判定は 2 通りで、読点のあとにもう 1 項目あり、そのあとに接続詞が
来る形（3 項目以上）はそれだけで並列とみなす。読点の直後がいきなり接続詞の場合は、節の連結
（"…sent by the sender, and the receiver checks it."）と区別がつかないため、直前に `either`
などの目印があるか、すでに並列の読点を通っていることを求める。

### 定義は `<dl>` だけにあるとは限らない

用語を `<dl>` で並べる RFC（RFC 9114 §2.2）と、地の文で定義して定義箇所に
`<iref primary="true">` を置く RFC（RFC 9110）がある。後者を読まないと、
RFC 9110 の `get_definitions` は §14.6 と §16.3.1 の登録票の項目名しか返さない。

`extractIrefDefinitions()` は `<iref primary="true">`（`subitem` の無いもの）を探し、
それを含む段落、無ければ直後の段落を定義とする。`primary="false"` は言及であって
定義ではない。属性の並び順は RFC ごとに違う（`item` が先の RFC もある）ので、
順序に依存して読まないこと。

この関数だけはパース前の文字列を見る。`preserveOrder: false` では木から
`<iref>` と `<t>` の並び順が失われるためである。`stripNonPrinting()` が
`<iref>` を落とすのはそのあと。

**起点の段落に用語が出てこないときは、同じ節の中を 4 段落先まで見る。** 節の直下に
`<iref>` を置き、導入の段落を挟んでから定義を書く RFC がある（RFC 9110 §7.7）。
節をまたいで探してはならない。見つからなければ起点の段落に戻す。

同じ用語が両方にあるときは `<dl>` を採る（用語と定義の対として書かれているため）。
並びは節番号順（`mergeDefinitions`）。

### テキスト経路の参照は参考文献の欄から取る

本文全体を `RFC\s*(\d+)` で走査してはならない。v0.6.5 まではそうしていたため、

- 規範的参照と参考的参照が区別できず、すべて `informative` に入っていた
- 参考文献に載っていない言及まで参照になっていた（RFC 6455 の "RFC 5741" は
  Status of This Memo の定型文）
- 題名が取れず `title: "RFC 2119"` という仮置きしか返せなかった

`_sourceNote` は本当に劣化しているときだけ出す。題名は参考文献の欄から取っているので
「仮置き」ではない。テキスト経路で残る制約は、参考文献の欄が 1 つしかない RFC
（RFC 2616）ですべて `informative` に入ることだけで、そのときだけ注記する。

`extractTextReferences()` は "14.1 Normative References" / "14.2 Informative References"
の見出しで欄を切り替え、`   [RFC2119]` で始まる行から項目を取る。ページの区切り
（`[Page 68]` の行と次ページ冒頭の `RFC 6455 … December 2011`）は字下げが無いので、
見出しとして通らなかった非字下げ行を読み飛ばすことで一緒に落ちる。
参考文献の欄が 1 つしかない RFC（RFC 2616）では、すべて `informative` に入る。

### ページの区切りは本文ではない

RFC の .txt は 1 ページ 58 行で組まれ、段落の途中でもページが変わる。フッタ
（`… [Page 29]`）・改ページ（`\f`）・ヘッダ（`RFC 7230 … June 2014`）とその前後の
空行を `stripPageFurniture()` で落としてから解析する。落とさないと、空行で切る
`createTextBlocks()` が段落を割り、要件文が "…unless it knows the" で終わる。

**直前の行が文末で終わっていなければ空行を入れずに続ける。** ページの変わり目が
段落の切れ目でもあるかどうかはテキストからは判らないので、文が途中かどうかで決める。

### 節見出しの判定に題名の中身を使わない

`isValidSectionHeader()` が見るのは、目次の行かどうかと、節番号として不自然な数
（0 や 100 以上、6 段以上）だけである。題名の長さ・大文字小文字・語彙で判定しては
ならない。v0.6.8 まではそれをしていて、RFC 2616 §14.39 `TE`、RFC 7230 §2.7.1
`http URI Scheme`、RFC 8446 §8 `0-RTT and Anti-Replay` が落ちていた。落ちた節は
`get_rfc_structure` に出ないだけでなく、その節の要件が手前の節に付く。

構造的な signal は v0.6.5 の「節見出しは 1 桁目から始まる」で足りている——
ただし **1980 年代の RFC は本文も 1 桁目から組む**。RFC 1035 の
"25 (SMTP).  If this bit is set, …" は折り返した本文であって節ではない。
題名に句点のあとの語（`. ` + 語）があれば本文とみなす。先頭の文字では判定しない
（RFC 8446 §7.4 `(EC)DHE Shared Secret Calculation`）。

見出しと本文が 1 行に入っている RFC もある（RFC 1035 §6.4.1）。4 個以上の空白で切る。

古い RFC は書式が違う。RFC 793 は上位の見出しを中央に寄せ（`centeredSectionHeader()`、
字下げ 8 桁以上・全部大文字・1 段・前後が空行）、RFC 1122 は下位の見出しを深さに応じて
字下げする（`indentedSectionHeader()`）。

字下げした見出しを本文の番号付きリストと区別する要は
**`isSuccessorSectionNumber()`（直前の節の次に来る番号か）** である。RFC 6455 §4.1 の
`   1.  The handshake MUST be …` は、直前の節が §4.1 なので "1" は次に来ない。
字下げ幅（1 段 3 桁）と「1 段目は 1 桁目から」も併せて課すこと。どれか 1 つでも
外すと本文のリストが節になる。

参考文献の書式も古い RFC では違う。項目が 1 桁目から始まり（RFC 1122）、RFC 番号を
`RFC-817` とハイフンでつなぎ、見出しが中央寄せの `REFERENCES`（RFC 793）である。

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

読点の有無も同じである。RFC 6749 は `([RFC3986] Section 3.4)` と読点なしで書く。
読点を必須にしていたため、この形が「RFC 6749 の §3.4」になり、
`get_related_sections` が実在しない節を返していた（RFC 6749 に §3.4 は無い）。

### 切り詰めは `clipAtWord` に集約する

上限で切るときは**語の境目で切り、末尾に三点リーダを置く**。切ったことが
分からないと、読み手はそれが全部だと読む。

| どこ | 上限 | 以前の見え方 |
|---|---:|---|
| ぶら下げの定義 | 500 | RFC 2616 の no-store が `This directive applies to both non` で終わる |
| 引用符の無い参照の題名 | 120 | RFC 2822 の `[ASCII]` が `… Code for Informatio` で終わる |
| `validate_statement` の助言 | 60 | 要求アクションが語の途中で切れる |

実測（RFC 67 本）: 参照の題名で 18 件。

**「題名が黙って切られていない」という不変条件は入れられない。** 引用符のある
項目とない項目を、出力側から見分けられないためである。引用符のある項目には
上限が無く、RFC 6125 の題名は 199 文字、RFC 9440 の `[ITU.X690]` は 161 文字ある。
どちらも正しい題名なので、長さだけで判定すると毎回挙がる。単体テストで見る。

### 参考文献の欄の見出しは `References` だけではない

| RFC | 見出し |
|---|---|
| 1034 / 1035 / 1058 | `REFERENCES and BIBLIOGRAPHY` |
| 2822 | `6. Bibliography` |

`References` だけを見ていたため、これらの参考文献が 1 件も取れていなかった。
`get_rfc_dependencies` が空を返し、`referenceCount` も 0 になる。実測で 63 件。

参考文献の欄が**本当に無い** RFC もある（RFC 854・896・2045 は本文の中で引く）。
見出しの語を増やしても、そちらは 0 件のままである。不変条件 E7 は
「欄があるのに 0 件」だけを見る。

### 段落を繋ぐかどうかは 3 つで決める

文末記号を持たない段落は、次の段落と繋ぐ（`joinUnterminatedParagraphs`）。
ページの変わり目で切れた文を戻すための規則だが、繋いではいけない形が 3 つある。

1. **箇条書きの項目のあとに地の文**。RFC 6455 §3 の `o  the query component` は
   文末記号を持たないので次の段落と繋がれ、要件文が
   `the query component Fragment identifiers are meaningless …` になっていた。
   ただし**項目のあとに項目なら繋ぐ** — RFC 2616 §8.2.4 は箇条書きで 1 つの文を作る。
2. **値の並び**（`looksLikeDisplayBlock`）。2 行以上を求めていたため、RFC 7159 §3 の
   `false null true` が落ちて `false null true The literal names MUST be lowercase.`
   になっていた。1 行の塊は、記号を含むか、機能語（the / of / is …）を 1 つも
   含まない語の並びなら値とみなす。`the query component` は `the` があるので地の文。
3. **ページの終わりに置かれた値の並び**。RFC 6749 §4.3.2 の
   `grant_type=password&username=johndoe&password=A3ddj3w` はページの最終行にあり、
   `stripPageFurniture` が次のページの地の文と同じ段落にしていた。装飾を外す側にも
   同じ判定を置く。

### コロンで終わる文は、続く箇条書きで完結する

`the UA MUST either:` `An ICMP error message MUST NOT be sent as the result of
receiving:` — コロンで終わる要件文は、続く項目を取らないと**何を指しているかが
読めない**。`generate_checklist` の項目がそのまま使えない形になる。

コロンで終わる段落のあとに箇条書きが来たら取り込む。ただし 2 つ外す。

1. **項目自身がキーワードを持つなら取り込まない。** その項目は独立した要件で
   あり、取り込むと元の要件文が失われる（RFC 1122 §3.2.1.8）。
2. **番号付きの項目（`1.` `2.`）は取り込まない。** `isSentenceEnd` が番号の句点を
   文の終わりと読み、要件文が `as follows: 1.` で切れる（RFC 6455 §4.1）。

実測（RFC 67 本）: 長くなった要件文 51 件、短くなったもの 0 件、総数は変わらず。

**1 行の値の並びは取り込まない。** 同じ考えで `false null true`（RFC 7159 §3）も
繋げてみたが、要件文が 339 件変わり、例示が要件文の先頭に付く崩れが数件出て、
要件の総数が 2 件減った。改善 2 件では引き合わない。

**XML 経路にも同じ規則を置いた**（v0.6.29）。`mergeContinuations` は文末記号で
止まるが、コロンで終わるときに限り続く `<ul>` / `<ol>` / `<sourcecode>` /
`<artwork>` を取り込む。項目自身がキーワードを持つなら取り込まないのは同じ。
実測: 長くなった要件文 33 件、コロンで終わる要件文は 161 件 → 128 件。

残る 128 件は、続くものが `<dl>`（RFC 9114 §11.2.x の登録票）か、長い ABNF の欄
（RFC 9110 §5.6.1.2）である。

取り込んだ結果 1,282 文字になる要件がある（RFC 9111 §3 の
`A cache MUST NOT store a response to a request unless:` と 8 つの条件）。
**これは本物の要件文である。** F3 の上限（900 文字）は暴走した取り込みを見る
ためのものなので動かさず、この 1 件を基準に入れた。

### 表の行を要件として出すかは、まだ決めていない

図・表の行にキーワードが当たったときは、**その 1 行だけ**を要件文にする。
RFC 2131 §4.3.1 の Table 3 は 2 ページにわたるので、段落全体を返すと
`generate_checklist` に 2,000 文字の「要件」がレベルごとに 4 回並ぶ。

その規則の結果として、ASN.1 の型定義の欄と値を並べた表から `OPTIONAL` の要件が出る。

```
   AuthorityKeyIdentifier ::= SEQUENCE {
      keyIdentifier             [0] KeyIdentifier           OPTIONAL,
```

要件文は `keyIdentifier [0] KeyIdentifier OPTIONAL,` になる。RFC 4253 §6.3 の
暗号方式の表も同じ。実測（RFC 67 本）: 86 件、うち RFC 5280 が 46 件、
RFC 4253 が 12 件、RFC 5652 が 12 件。**判断待ちである。**

### 折り返した節の題名は、開始桁で継ぐ

題名は右余白で折り返す。RFC 7519 §10.2 は

```
10.2.  Sub-Namespace Registration of
       urn:ietf:params:oauth:token-type:jwt
```

の 2 行になる。1 行目だけを取ると**何の登録かが消える**。RFC 6797 §11.3 は
`Using HSTS in Conjunction with Self-Signed Public-Key` で終わり、
何の証明書かが消えていた。

続きの行は**題名の開始桁にそろう**。これが本文と見分ける手掛かりである。
RFC 1035 §6.4.1 は見出しの直後に本文が 1 桁目から続くので当たらない。
そのうえで、次の行が空行であること（3 行に折り返す題名は無い）、
60 文字以内、句点で終わらないことを求める。

実測（RFC 66 本）: 題名を継いだ節 6 件、節の総数は変わらず、
誤って本文を継いだものは 0 件。

### 付録の見出しは、順番で見分ける

テキスト経路は `1.` `2.1` のような数字の節しか拾っていなかった。RFC 8446 の
Appendix A〜E、RFC 6455 の Appendix A のように、**付録は文字で番号を振る**。
実測: 64 本のうち **20 本で付録が丸ごと落ちていた**。落ちた分の本文は直前の節に
繰り込まれるので、参考文献の欄から 147 件の「要件」が出ていた。

`A.` の形は本文にも出る。著者名（`J. Postel`）、箇条書きの項目、表の行が同じ形になる。
**順番で見分ける。** 付録は A から始まり 1 つずつ進む。`B` の次に `D` は来ない。
`Appendix` の語が明示されていない場合、最初の 1 つは `A` でなければならない。

- 1 段目（`A.`）は字下げしない。深い段（`A.1`）は親の文字と同じであること。
- 題名は 3 文字以上で、文の切れ目（`isSentenceEnd`）を含まない。
- 番号と題名の区切りは `Appendix A - Algorithms` の形もある。`\s*[-–]+\s*` を
  `\s{1,3}` より**先**に試すこと。順を逆にすると題名が `- Algorithms` になる。
- `acceptsSectionNumber()` の「数字が単調に増える」検査は文字の番号に当てはまらない。
  先頭が大文字なら通す。

実測: 節 4,754 件 → **4,992 件**。参考文献の欄から出ていた要件 147 件 → **0 件**。
RFC 8446 は付録 46 件を拾う。

**`Appendix` と書く見出しは 1 桁目から始まる。** 字下げして `Appendix A.2` と
書いてあるのは本文からの参照である。RFC 7519 の
`   Appendix A.2 of [JWE], including the keys used.` を見出しとして拾い、
そのあとの本物の `A.2.  Example Nested JWT` が番号の重複で落ちていた。
RFC 5280 の C.1〜C.3 も題名が本文になっていた。

### 節番号は一度しか使われない

`SECTION_HEADER_PATTERN` は「数字 + 空白 + 何か」に当たるので、本文の中の
次の行も節見出しに見える。

| RFC | 行 | 実体 |
|---|---|---|
| 1123 | `1.   Unless there is private agreement between …` | 要件一覧表の脚注 |
| 1305 | `4 is used, this is the size of the clock filter …` | `Section` から折り返した本文 |
| 1305 | 注釈 `/* test` の折り返しで閉じ記号だけが残った行 | C の注釈 |

どれも、その番号の節がすでに出たあとに現れる。`acceptsSectionNumber` が
「すでに出した番号」と「1 段目が最大より小さい番号」を落とす。

Why: 受け入れると直前の節番号が戻り、`isSuccessorSectionNumber` から見て
次の見出しが「次に来る番号」でなくなる。RFC 1123 では脚注の `1.` のせいで
§6.2 以降の 8 節が丸ごと落ち、その節の要件が §6.1.5 に付いていた。

### 題名の中の略語は文の終わりではない

節見出しの判定は「題名の中に句点 + 空白 + 語があれば本文」である。ただし
RFC 1123 は出典を題名に書く（`3.2.1  Option Negotiation: RFC-854, pp. 2-3`）。
`pp.` を文の終わりと見ると §3.2.1 から §3.2.8 が丸ごと落ちる。
`containsSentenceBreak` が `TITLE_ABBREVIATION` を除いてから判定する。

### 引用符に囲まれたキーワードは要件ではない

ほぼすべての RFC が冒頭に BCP 14 の定型文を置く。

> The key words "MUST", "MUST NOT", … are to be interpreted as described in
> BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals.

この 1 文から 11 件の要件が出ていた。RFC 8259 の `generate_checklist` は
21 項目のうち 11 項目がこの文だった。同じことは RFC 9293 §2.1 の
`"MUST-X"`（要求 ID の説明）や RFC 5322 §1.2.1 の用語説明でも起きる。

`isQuotedKeyword` が、開き引用符と閉じ引用符に挟まれたキーワードを落とす。
閉じ側は `-` も許す（`"MUST-14"`）。

引用符を付けない書き方もある。RFC 5652 §1.2 と RFC 4253 §1.1 は
`the key words MUST, MUST NOT, … are to be interpreted as described in` と
裸で書く。`BCP14_BOILERPLATE` が定型文そのものを目印にする。72 桁の折り返しで
「interpreted as / described in」が改行をまたぐので、空白をまたいで照合する。
実測（RFC 49 本）: 8,164 件 → 7,797 件、うち定型文 324 件・語の説明 40 件。

### 2 語のキーワードは改行をまたぐ

RFC のテキストは 72 桁で折り返す。`SHOULD NOT` が
`SHOULD\nNOT` に分かれると、`\b(SHOULD NOT|SHOULD)\b` は `SHOULD` に当たる。

**要件のレベルが反転する。** `MUST NOT` を `MUST` として、`SHOULD NOT` を
`SHOULD` として出していた。実測で 41 件・15 本の RFC。`generate_checklist` を
読んで実装すると、RFC が禁じていることを実装することになる。

`createRequirementRegex` はキーワードの空白を `\s+` にする。
`extractRequirementMarkers` が `level` を 1 個の空白に畳んで返す。

### 節に番号が無い RFC がある

1980 年代の RFC は節に番号を振らない。

```
INTRODUCTION

   The purpose of the TELNET Protocol is to provide a fairly general,
   bi-directional, eight-bit byte oriented communications facility.
```

番号を頼りにすると 1 つも取れない。実測（1980 年代の RFC 29 本）で 14 本が
節 0〜1 だった。RFC 792（ICMP）、RFC 826（ARP）、RFC 854（Telnet）、
RFC 894（IP over Ethernet）が含まれる。どれも RFC 1122 や RFC 1123 が
繰り返し参照する文書で、`get_rfc_structure` が何も返していなかった。

番号の付いた見出しが 2 つ未満のときだけ、`extractUnnumberedSections` で
取り直す。見出しは前後が空行・3〜60 文字・8 語以下・文末記号なし・
小文字だけでない・字下げ 12 桁以内であること。

**番号は字下げの深さから作る。** 原文に番号は無いので、`§3.2` はこちらが
振った番号である。RFC 854 は `THE NETWORK VIRTUAL TERMINAL` の下に
`TRANSMISSION OF DATA` を 3 桁字下げ、その下に `Interrupt Process (IP)` を
6 桁字下げで置く。文書の見た目だけが唯一の構造である。

深さは「**そこまでに現れた**字下げを浅い順に並べた順位」で決める。文書全体の
字下げを先に集めると、上位の見出しが後ろに出る文書で番号が狂う。RFC 855 は
`Section 1 - …` を 3 桁字下げで先に並べ、そのあとに 1 桁目の
`A Note on "Subnegotiation"` を置く。先に集めると 3 桁が 2 段目になり、
親のない `1.1` から始まる。

除くもの 2 つ。ページの飾り（RFC 792 はページ見出しを `RFC 792` の 1 行で
書くため前後が空行になる）と、表の見出し（RFC 854 の
`NAME                  CODE         MEANING`）。

### 小文字で始まる題名は、番号の句点か直前の空行で見分ける

節見出しの題名は大文字で始まるとは限らない（RFC 7230 §2.7.1 `http URI Scheme`）。
一方で本文の折り返しが数字から始まると節に見える。

| RFC | 行 | 番号の句点 | 直前が空行 |
|---|---|---|---|
| 7230 §5.3.1 | `5.3.1.  origin-form` | あり | 無し（前ページの最終行が ABNF の `/ asterisk-form`） |
| 2616 §3.2.2 | `3.2.2 http URL` | 無し | あり |
| 896（本文） | `24 characters, arriving from…` | 無し | 無し |

どちらか一方では足りない。**両方を OR で見る。** RFC 896 には節が 1 つも
無いので、この 1 件だけが `get_rfc_structure` の返り値になっていた。

大文字で始まる題名には課さない。RFC 1122 §1.4 と §4.2 は図表の直後に
置かれており、空行を課すと 123 節が 64 節に減る。

### 値を並べた塊は文ではない

RFC 8259 §3 は取りうる値を字下げして並べる。

```
   A JSON value MUST be an object, array, number, or string, or one of
   the following three literal names:

      false
      null
      true

   The literal names MUST be lowercase.
```

この塊は文末記号を持たないので、`joinUnterminatedParagraphs` が次の段落と繋ぎ、
要件文が "false null true The literal names MUST be lowercase." になっていた。
`looksLikeDiagram` は当たらない。ABNF の規則でも罫線でもなく、空白で桁を
揃えてもいない、ただの短い語の並びである。`looksLikeDisplayBlock` で落とす。

### 主語は文頭ではなくキーワードの直前から取る

RFC の要件文は前置きから始まることが多い。

- `(Note that masking is done …) The server MUST close the connection …`
- `In this case, a server MAY send a Close frame …`
- `Because of the potential for trailer fields to be discarded, a server …`

文頭で探すと主語が取れない。実測（RFC 64 本・要件 9,684 件）で `subject` が
付くのは **27.9%** だけだった。キーワードの直前から取ると **94.2%**。

`subject` は `get_requirements` の出力であると同時に、`generate_checklist` の
`role` の絞り込みにも使う。取れないと絞り込みが効かず、**`role: "client"` に
サーバの話だけを書いた要件が 865 件（8.9%）残っていた。**

`filterByRole` は主語が取れないときに要件文そのものを見る。どちらにも触れない
要件は、どちらの実装にも関わりうるので両方に残す。冠詞は主語ではない。

### 代名詞の主語は前の文から引き継ぐ

RFC 6455 §5.1 は

> A client MUST close a connection if it detects a masked frame.
> **In this case, it MAY use the status code 1002** (protocol error) …

と書く。`it` は client を指す。主語が付かないと `role` の絞り込みが本文に落ち、
本文にも client / server の語が無いので**両方の一覧に出る**。

`subjectBeforeSentence()` が、同じ段落の前の文で、キーワードの直前に置かれた語を
引き継ぐ。2 つ落とし穴がある。

1. **文の全体で探す。** 頭の数十文字で探すと、同じ書き出しの文が段落に 2 つ
   あるときに手前に当たる。RFC 6455 §5.1 は "In this case, …" を 2 回書く。
2. **冠詞は大文字で始まる。** 小文字だけで書くと文頭の "A client MUST …" が
   当たらず、その手前の文の主語を引き継ぐ。

実測（RFC 67 本）: 引き継いだ要件 213 件。RFC 6455 §5.1 の client / server は
4 件ずつに分かれた。

### 主語の機能語は、落とすのではなく切り詰める

1〜2 語の取り込みなので `response and` `methods are` `it is` のようになる。

| やり方 | 主語が付く要件 | `role` で両方に残る |
|---|---:|---:|
| そのまま | 87.2% | 2 |
| **前後の機能語を切り詰める** | **85.0%** | **4** |
| 機能語を含むものを丸ごと落とす | 74.6% | 3 |

切り詰める方を採る。実測: 末尾が機能語の主語 375 件 → 0 件。

### 主語にならない語がある

主語はキーワードの直前 1〜2 語から取るので、**その位置に主語でない語が来る**ことが
ある。

| 何が来るか | 例 | 実測 |
|---|---|---:|
| 接続詞 | `… audit log (if available) and MUST provide …`（RFC 9110 §4.3.4） | 多数 |
| 代名詞 | `… it MAY add its own domain …`（RFC 9110 §7.7） | 多数 |
| 指示語 | `This MAY be implemented by doing so before storage.`（RFC 9111 §3.1） | 多数 |
| 冠詞・繋辞 1 語 | `the` / `is` が 1 語だけ残る | 28 |

括弧が 2 語の取り込みを断つと、接続詞 1 語だけが残る。代名詞が指しているものは
文の前の方にあり、ここからは辿れない。**主語でないものを主語として出さない** —
`NOT_A_SUBJECT` に当たったら `subject` を付けない。

実測（RFC 67 本・要件 9,845 件）: 機能語の主語 744 件 → 0 件。主語が付く要件は
91.8% → 85.2%。`role` の絞り込みは `subject` が無ければ本文を見るので影響しない。

残る短い主語（`ua` 35 件、`ca` 6 件、`tu` 4 件、`dn` 3 件）は本物の略語である。

### `generate_checklist` に同じ文が 2 回出るのは正しい

1 つの文が `MUST` と `MUST NOT` の両方を持つと、レベルごとの節に 1 回ずつ並ぶ。
実測（RFC 67 本）: 841 件。**完全に同じ行は 0 件**で、レベルが違う。消すと片方の
レベルの要件が落ちる。直さない。

### 冠詞の候補は空白を伴う

`\b(?:The|A|An)?\s*(…)` と書くと、`\s*` が空白ゼロを許すため、冠詞の候補が
語の頭の 1 文字を食う。`Automated clients MUST` の `A` が冠詞として消費され、
主語が `utomated clients` になっていた。実測（RFC 64 本・要件 9,684 件）で
**600 件（6.2%）**。`(?:(?:The|A|An)\s+)?` と書く。

### 役割の語は複数形も見る

`\bserver\b` は "servers" に当たらない。`role` の絞り込みが
`Other servers MUST perform …` を振り分けられず、実測で **449 件（4.6%）** が
どちらの role にも残っていた。

### 否定は動詞に付いたものだけを見る

`validate_statement` の違反検出は、主張の文全体から否定語を探していた。
要件の条件をそのまま書き写した主張が、そこで落ちていた。

```
要件: An origin server without a clock MUST NOT generate a Date header field.
主張: An origin server without a clock generates a Date header field.
```

この `without` は行為を否定していない。条件を書き写しただけで、これは違反
そのものである。動詞の直前 2 語だけを見る。

**主語と動詞のあいだの限定句は飛ばす。ただし限定句だけ。** 語なら何でも
飛ばすと、目的語の中の語を動詞と取り違える。

```
主張: The server removes masking for data frames received from a client.
```

`masking` を動詞と取ると「サーバはマスクしてはならない」に違反していると
誤って報告する。実際はマスクを外す側の話である。飛ばしてよいのは
`SUBJECT_QUALIFIER_WORDS`（with / without / that / a / the …）と、その次の 1 語だけ。

実測: 手書きの準拠 10 文・違反 5 文で誤検出 0 件・検出 5/5。
要件から機械生成した準拠 40 文・違反 40 文で誤検出 **0 件**・検出 **23 件（57.5%）**。

検出が 6 割に届かないのは、**受動態の禁止**を拾えないためである。
`MUST NOT be <過去分詞>` の形は、禁止の要件 1,639 件のうち **273 件（16.7%）**。
行為が "be fragmented" だと動詞以外の語がほとんど無く、要件の主語も
`SUBJECT_TERMS` に無いことが多い（273 件中 200 件）。主語の一致を緩めれば
拾えるが、それは誤検出の元になる。**今は拾えないものとして残している。**

### ASN.1 の型定義は散文ではない

RFC 5652 §5.3 や RFC 5280 §4.1 の `OPTIONAL` は ASN.1 の構文であって
BCP 14 のキーワードではない。

```
SignerInfo ::= SEQUENCE {
  signedAttrs [0] IMPLICIT SignedAttributes OPTIONAL,
  unsignedAttrs [1] IMPLICIT UnsignedAttributes OPTIONAL }
```

`[0] IMPLICIT` と `::=` は散文に現れないので、`DIAGRAM_PATTERNS` に足して
図・表と同じ扱いにする。実測（RFC 90 本・要件 10,196 件）で 42 件（0.41%）。
すべて型定義で、要件は 1 件も無かった。

要件文は文である。`hasSubstance` がキーワード以外の語を持たないものを落とす
（RFC 5280 §11.2 の `OPTIONAL,` `} OPTIONAL,`）。

### 1 段目の節番号は 1 ずつ増える

RFC 2068 は Warning ヘッダの警告コードを表にして `99 Miscellaneous warning` を
1 桁目に置く。これを §99 として受け入れると、`acceptsSectionNumber` の
「1 段目の番号は前に戻らない」から見て以降の節がすべて後戻りになり、
**§14.46 以降の 30 節が丸ごと落ちていた。**

自分で入れた規則が、1 件の誤検出で文書の後半を捨てる形になっていた。
最大値より `MAX_SECTION_NUMBER_GAP`（5）を超えて飛ぶ番号は節ではない。

### 小文字で始まる題名の 3 つ目の手がかり

v0.6.19 の 2 つ（番号の句点・直前の空行）ではまだ足りない。RFC 2445 §4 の
`4 iCalendar Object Specification` は、句点が無く、ページの区切りの直後なので
直前も空行ではない。

`looksLikeTitleCase` が題名らしい大文字の並びを見る。

- `iCalendar Object Specification` → 3 語中 3 語が大文字始まり
- `characters, arriving from the user at 200ms intervals, would` → 0 語

1 語だけの題名（`origin-form`）には使わない。判断できない。

### 参照の題名と番号は、引用の部分から取る

テキストの参考文献は 1 項目が「目印・題名・著者・出典・日付」と、そのあとに
注釈の段落を持つ。どこから何を取るかで 4 通り間違えていた。

| 誤り | 例 | 直し方 |
|---|---|---|
| 題名に読点が残る | `"Assigned Numbers,"` | 引用符の中の末尾の読点を落とす（859 件中 121 件） |
| 注釈の中の番号を採る | RFC 1123 [DNS:1] は本体が RFC-1034、注釈が RFC-882/883/973 | **最初**の番号を採る |
| 題名の中の番号を採る | RFC 1123 [SMTP:5b] `"Addendum to RFC-987," … RFC-???` | 題名を外してから探す |
| 出典と日付を題名にする | RFC 1305 [DAR81a] の `DARPA Network Working Group Report RFC-791, …` | RFC 番号・西暦・ページ範囲を含む部分を落としてから最長を採る |

**1 桁目から続く項目の本体を落としていた。** RFC 1305 は目印だけを 1 行に置き、
引用を次の行から 1 桁目で書く。1 桁目の行は見出しの候補として処理され、
見出しでなければ捨てられていた。48 件の題名が目印（`ABA89`）のままだった。

閉じ引用符が無い項目がある（RFC 2131 [4]、原文の誤り）。開き引用符から
`, STD` / `, RFC` / `, Work in Progress` までを題名とみなす。

### `unless` は例外であって条件ではない

`condition` の抽出に `unless` を入れると、`exception` と同じ文字列が入る。
実測で 247 件（3.2%）あった。`if` / `when` / `where` / `in case` が条件、
`unless` / `except` / `excluding` が例外である。

### 箇条書きの項目も文の単位で切り出す

箇条書きの項目は 1 文であることが多いが、RFCXML の `<dl>` は 1 項目が段落になる。
RFC 9113 §8.3.1 の `":authority"` の項目は 2,150 文字の段落で、その中に
MUST・MUST NOT・SHOULD・MAY が入っている。項目の全文を要件文にしていたため、
同じ 2,150 文字が 4 件の要件として並んでいた。

テキストブロックと同じく `extractSentence` を通す。元の段落は `fullContext` に残す。

### 公開日は本文から取る

Datatracker の `document.time` は**レコードの最終更新時刻**であって公開日ではない
（RFC 9293 は 2026-05-20 を返す。公開は 2022-08）。公開日は RFCXML の `front/date`、
テキスト経路ではヘッダ行から取る。`RFCMetadata.datatrackerUpdated` が前者の値だが、
ツールの応答には出さない。

### `get_definitions` はテキスト経路では当てにならない

テキスト経路の定義は「行の中の `X: Y`」でしか見分けられない。同じ形が
用語以外にもいくつも出る。

| 出どころ | 例 | 実測 |
|---|---|---:|
| RFC の表紙 | `Request for Comments: 7519` | 111 |
| 末尾の著者欄 | `EMail: mbj@microsoft.com` | 139 |
| 本文の注記 | `NOTE: This is a note to the reader.` | 352 |
| IANA 登録票 | `o  Type name: application` | 58 |
| 折り返した文の途中 | `Overall Policy: is the overall name for the combined UA and` | 237 |
| 見出しの例示 | `Set-Cookie: SID=31d4d96e407aad42`（RFC 6265 §3.1 に 10 回以上） | 633 |

RFC 7519 が返していた 21 件は**全件が用語ではなかった**。XML 経路にも同じ問題が
あり、IANA 登録票を `<dl>` で書く RFC 9209 は `Name` `Description` `Reference` を
34 回ずつ返していた。

`dropNonDefinitions()`（`src/utils/text.ts`）が両方の経路に同じ規則を当てる。
用語でない見出し（`NOT_A_TERM`）、文の書き出し（`SENTENCE_OPENER`）、関係節
（`RELATIVE_CLAUSE`）、同じ用語の繰り返しの 4 つ。

テキスト経路はさらに 4 つを課す。

1. 節に入る前は見ない（表紙）。題名が `Index` の節も見ない。
2. 段落の途中の行は見ない（空行のあと、または前の行より深い字下げ）。
3. `X: Y` の形は**地の文の桁（4 桁目まで）に限る**。それより深いものは例示である。
4. 節の追跡は 1 桁目の見出しだけを見る。字下げした行を数えると、RFC 6455 の
   フレーム図の目盛り `0 1 2 3` を節 0 として記録していた。

### 用語欄で最も多いのは「ぶら下げ」の形

```
   JSON Web Token (JWT)
      A string representing a set of claims as a JSON object that is
      encoded in a JWS or JWE, ...
```

v0.6.25 まで `X: Y` の形しか見ておらず、**この形は 1 件も読めていなかった**。
RFC 7519 §2 の 10 件、RFC 2616 §1.3 の 77 件、RFC 5246 §6.1 が丸ごと落ちていた。

`hangingDefinition()` が読む。用語の行は空行のあと・字下げ 2〜8 桁・60 文字以内・
6 語以内・句点で終わらない。説明の行はそれより 2 桁以上深く、大文字で始まる。
参考文献の `[TAG]` と型定義の断片（`struct {`、`Dss-Sig-Value ::= SEQUENCE {`）を除く。

実測（v0.6.26）: 合計 1,768 件（テキスト 633、XML 1,135）。RFC 7519 は 0 件 →
**10 件**、RFC 5280 は 7 件 → **3 件**（§3 の `CA` `RA` `CRL issuer` だけ）。

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
- **動詞は要求アクションの主動詞であること**。以前は「先頭から 20 文字以内に現れるか」で
  見ていたため、RFC 6455 §6.2 の "remove masking for data frames received from a client" が
  「mask を求めている」と読まれていた。この要求が求めているのは masking を remove する
  ことである。`headVerbOf()` を使う（受動態の be は飛ばす）。
- **主語は単数形にそろえて照合する**。`Requirement.subject` は本文からそのまま取るので
  "endpoints"（複数形）や "an endpoint"（冠詞付き）で入っている。`requirementSubjectOf()`
  を通すこと。素の `===` で比べると、RFC 9114 §6.2.3 の
  "Endpoints MUST NOT consider these streams …" が主語不一致となり、順位付けの
  ボーナスも矛盾検出も効かない。
- `extractSubject()` の単数形化は**後段**に置く。先に混ぜると別の語を拾う。RFC 6455 §5.1 の
  "…(such as intercepting proxies), a client MUST mask …" では、"proxies" を先に
  単数形化すると主語が proxy になり、client の要件が矛盾検出から外れる。
- `VERB_SYNONYMS`（consider / treat など）は**網羅ではない**。載っていない動詞では
  `findProhibitionViolation()` が矛盾を検出しない。検出しないことは `isValid: true` の
  意味（矛盾が見つからなかった）と一致しており、準拠の主張ではない。表を広げるときは、
  主動詞・否定なし・内容語 3 語以上という 3 条件を緩めないこと。

- **受動態で書かれた禁止では判定しない**。`A reference identity of type CN-ID MUST NOT be
  used by clients.` の禁じられた行為は `be used by clients` で、行為の実行者が本文に無い。
  矛盾検出は「主張の主語がその動詞を実行しているか」を見るので、実行している主張を
  出しても `conflicts` は空になる。空の `conflicts` をそのまま `true` にすると、
  違反している主張に「矛盾なし」と答える。`findUndecidablePassiveProhibition()` が
  `MUST NOT be <過去分詞>` の一致を拾い、`isValid` を `null` にして
  `suggestions` に該当要件の ID を出す。主張自身が否定（`not` / `never` / `no` /
  `cannot`）なら準拠を述べているので取り下げない。
  実測（機械生成した受動態の違反文 40 件）: `true` **13 件 → 4 件**。
  要件どおりの文 179 件のうち取り下げたのは 4 件。
  **判断を取り下げるときの「同じ行為か」は `describesSameAct` と違う。**
  限定語（`unless` `except` `without`）の一致を求めない。矛盾を主張するときは
  限定語の不一致で落とすのが正しいが、ここは逆で、限定語に触れていない主張こそ
  判断できない。RFC 6455 §5.4 の `… unless an extension has been negotiated` に
  対し `unless` を求めると当の要件が落ち、順位の下の無関係な要件
  （`MUST NOT be fragmented`）を名指ししていた。

- **限定語の言い換えでも判定しない**。RFC 9110 §6.6.1 は
  `An origin server with a clock MUST generate …` と
  `An origin server without a clock MUST NOT generate …` を並べて書く。
  2 つを区別しているのは `with` / `without` なので、`describesSameAct` は主張にも
  同じ語を求める。言い換えられると当たらない —
  `… even though it has no clock.` は `without` を含まないので矛盾が出ず、
  **`isValid: true`（矛盾なし）を返していた**。
  `findQualifierOnlyViolation()` が、限定語を無視すれば矛盾が出て、かつ主張が
  同じ否定を述べている（`no clock` / `does not have a clock` / `lacks a clock`）
  ときだけ拾い、`null` にする。**逆の枝（`with a clock`）は取り下げない** —
  そちらは準拠している主張である。`without` 以外の限定語は見ない（言い換えの形が
  定まらない）。禁止の要件 1,668 件のうち `without` を含むのは 51 件。

#### 「固有の名前」は RFC の書き方に合わせる

`identifiersOf()` が名前として認めるのは 5 つの形である。全大文字（`TRACE` `HEAD`）、
語の内側のアンダースコア（`MAX_PUSH_ID`）、ハイフンでつないだ頭大文字
（`Content-Length` `Sec-WebSocket-Protocol`）、`header field` を伴う頭大文字の語
（`Date` `Server`）、状態符号（`1xx` `204` `1002`）。`HTTP` `TCP` `URI` のような
一般的な略語（`GENERIC_ACRONYMS`）と角括弧の引用は除く。

**名前と限定語は要件文全体から取る。** 適用対象と限定は要求アクションの外に置かれる
（`An origin server without a clock MUST NOT …` / `The HEAD method is identical to GET
except that the server MUST NOT …`）。

#### 語の重なりは「同じ話題」を示すが「同じ行為」を示さない

矛盾検出の誤りは、ほぼすべてこの一点から出ている。個別の例外を足すのではなく、
`describesSameAct()` を通すこと。**すべての矛盾分岐がこれを通る**。

1. 要求アクションに固有の名前（`MAX_PUSH_ID` `PUSH_PROMISE` `TRACE` のような全大文字・
   アンダースコア付き）があれば、主張にもあることを求める。要件を互いに区別しているのは
   この語であって `frame` や `request` ではない。`identifiersOf()` は `HTTP` `TCP` `URI`
   のような一般的な略語（`GENERIC_ACRONYMS`）と角括弧の引用を除く。
2. 要求アクションに限定語（`arbitrarily` `unless` `except` など）があれば、主張にも
   あることを求める。"close … arbitrarily" が禁じているのは理由なく閉じることである。
3. 双方に条件節があるなら、内容語が 1 語以上重なることを求める。片方にしか無い場合は
   判断材料が無いので通す。

さらに「主張が禁じられた行為をしている」と言うには、`statementMainVerb()` で取った
**主張の主動詞**がその行為であることを求める。"The server removes masking …" の主動詞は
removes であって mask ではない。文中のどこかに動詞が現れるだけでは足りない。

新しい補正を足したくなったら、まずこの 4 つのどれで説明できるかを見ること。
説明できないなら、語の重なりで近似していること自体が限界に来ている。

### `<references>` の入れ子

`collectReferenceSections()` で再帰的にフラット化して normative/informative を分離する。

---

## 共通パターン

横断的な実装パターンは `shuji-mcp-patterns` skill に分離済み。新規ツール追加時は `handler-dispatch.md` のチェックリストを参照。

---

## 変更履歴

技術的背景の詳細は [CHANGELOG.md](./CHANGELOG.md) を参照。
