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

テキスト経路（v0.6.6 以降）は、段落が図・ABNF でなければ要件文と `fullContext` を
畳む。図の判別は `looksLikeDiagram()`（`src/utils/text.ts`）が体裁で行う。

- 目印にするもの: 行頭から始まる ABNF の規則（`frame-rsv1 = %x0 / %x1`）、
  2 個以上の空白のあとのセミコロン、4 文字以上続く罫線、同じ行で空白が続く縦罫。
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

構造的な signal は v0.6.5 の「節見出しは 1 桁目から始まる」で足りている。

古い RFC（RFC 793 など）は上位の見出しを中央に寄せる。`centeredSectionHeader()` が
拾うが、条件は厳しくしてある（字下げ 8 桁以上・全部大文字・1 段・前後が空行）。
緩めると状態遷移図の行を見出しとして拾う。

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
