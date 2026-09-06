# 精度と制約

各ツールが何を返せて何を返せないか、その理由。内容は v0.6.53 の開発ガイド（`CLAUDE.md`）から取った。

## テキスト経路で落ちるもの

RFC 8650 より前の RFC には公式 RFCXML が無い。それらと、RFC 8650 以降でも XML が 404 以外の理由（5xx・タイムアウト）で取れなかったものは、テキストを解析する。応答には `_source` / `_sourceNote` が付く。

XML の構造に依存する機能は、テキスト経路では精度が落ちる。

| ツール | XML 形式 | text 形式 | API 補完 | 備考 |
|---|:---:|:---:|:---:|---|
| `get_rfc_structure` | ✅ 完全 | ⚠️ 階層精度低下 | ✅ メタデータ補完 | API で abstract / authors を補完。`category` / `stream` は API から取れたときだけ付く（不達なら `_sourceNote` に書く）。公開日は本文から取る |
| `get_requirements` | ✅ 完全 | ⚠️ 抽出精度低下 | ❌ なし | 段落ベースの推測になる |
| `get_definitions` | ✅ 完全 | ⚠️ 抽出精度低下 | ❌ なし | `<dl>` がなく、`X: Y` とぶら下げの形で推測 |
| `get_rfc_dependencies` | ✅ 完全 | ✅ 良 | ✅ Datatracker `relateddocument` | 参考文献の欄があれば text パーサで取得、無ければ API |
| `get_related_sections` | ✅ 完全 | ⚠️ 本文の `Section N` の記述から | ❌ なし | 節レベルの相互参照は本文にしか無く、API に存在しない |
| `generate_checklist` | ✅ 完全 | ⚠️ 抽出精度低下 | ❌ なし | `get_requirements` 経由のため同じ制約 |
| `validate_statement` | ✅ 完全 | ⚠️ 抽出精度低下 | ❌ なし | 同上 |

凡例: ✅ 完全 / ⚠️ 制限あり（精度低下） / ❌ 取得不能。

`_referencesSource` の値の意味（`get_rfc_dependencies` のみ）:

- `'xml'` — RFCXML の `<references>` から抽出。完全な anchor / title 付き
- `'text'` — テキスト本文の参考文献の欄から抽出。題名は欄から取るので仮置きではない。欄が 1 つしかない RFC（RFC 2616）ではすべて `informative` に入り、そのときだけ `_sourceNote` が付く
- `'api'` — Datatracker `relateddocument` API から取得。title / anchor はプレースホルダ（`title: "RFC N"`, `anchor: "RFCN"`）。本文に参考文献の欄が無いときに使う

空の結果は「要求された範囲でこの RFC の本文に一致が無かった」であって、「そのような要件は存在しない」ではない。要件の抽出はキーワード（RFC 2119 / RFC 8174）に基づくので、キーワード無しで書かれた要件は報告されない。

## `validate_statement` は判定器ではない

`isValid` は三値。

| `isValid` | 意味 |
|---|---|
| `null` | 判断できるだけの一致が無い |
| `false` | 矛盾を検出した |
| `true` | 一致した要件の中に矛盾が無かった。準拠の証明ではない |

値の決まり方:

- 最上位の一致が、最小スコアと、主語以外の一致語 2 語の両方を満たさなければ `null`。主語だけの一致はスコアの閾値に達するが、何を論じているかを示していないので判定しない。
- `false` の根拠は矛盾の相手の一致でも足りる。`conflicts` に並ぶ要件が同じ閾値に届けば、最上位の一致だけでは届かなくても `false` になる。`conflicts` が非空で閾値に届く相手が無いときは `null` のままで、注記は「矛盾はあるが判定の閾値に届かない」になる。
- 主張のレベルは原文どおりの大文字のキーワードだけから取る（RFC 8174）。小文字の optional は `detectedLevel: null`。
- 矛盾検出は要件文全体ではなく要求アクション（キーワードより後ろ）だけを見る。条件節の否定を要求アクションと取り違えないため。
- 矛盾と言うには、主張の主動詞がその禁じられた行為であることを求める。"The server removes masking …" の主動詞は removes であって mask ではない。
- `VERB_SYNONYMS` は網羅ではない。載っていない動詞では矛盾を検出しない。検出しないことは `true` の意味（矛盾が見つからなかった）と一致しており、準拠の主張ではない。

**受動態で書かれた禁止では判定しない。** `A reference identity of type CN-ID MUST NOT be used by clients.` の禁じられた行為は `be used by clients` で、行為の実行者が本文に無い。矛盾検出は「主張の主語がその動詞を実行しているか」を見るので、実行している主張を出しても `conflicts` は空になる。空の `conflicts` をそのまま `true` にすると、違反している主張に「矛盾なし」と答える。そのため `MUST NOT be <過去分詞>` の一致を拾い、`isValid` を `null` にして `suggestions` に該当要件の ID を出す。主張自身が否定（`not` / `never` / `no` / `cannot`）なら準拠を述べているので取り下げない。実測（機械生成した受動態の違反文 40 件）: `true` 13 件 → 4 件。要件どおりの文 179 件のうち取り下げたのは 4 件。

**限定語の言い換えでも判定しない。** RFC 9110 §6.6.1 は `An origin server with a clock MUST generate …` と `An origin server without a clock MUST NOT generate …` を並べて書く。2 つを区別しているのは `with` / `without` なので、同じ行為かの判定は主張にも同じ語を求める。`… even though it has no clock.` は `without` を含まないので矛盾が出ず、以前は `isValid: true` を返していた。限定語を無視すれば矛盾が出て、かつ主張が同じ否定を述べている（`no clock` / `does not have a clock` / `lacks a clock`）ときだけ拾い、`null` にする。逆の枝（`with a clock`）は取り下げない — そちらは準拠している主張である。`without` 以外の限定語は見ない（言い換えの形が定まらない）。禁止の要件 1,668 件のうち `without` を含むのは 51 件。

## 公開日は本文から取る

Datatracker の `document.time` はレコードの最終更新時刻であって公開日ではない（RFC 9293 は 2026-05-20 を返す。公開は 2022-08）。公開日は RFCXML の `front/date`、テキスト経路ではヘッダ行から取る。Datatracker の値は内部の `RFCMetadata.datatrackerUpdated` に持つが、ツールの応答には出さない。

## 表の行は、その 1 行だけを要件にする

図・表の行にキーワードが当たったときは、**その 1 行だけ**を要件文にする。RFC 2131 §4.3.1 の Table 3 は 2 ページにわたるので、段落全体を返すと `generate_checklist` に 2,000 文字の「要件」がレベルごとに 4 回並ぶ。

XML 経路の `<table>` も同じ規則で、本文の行から 1 行ずつ（セルを `" | "` で繋いで）要件にする。見出し行は見ない（RFC 9293 §3.11 は見出しに MUST / SHOULD / MAY を並べる）。キーワードの直後が `-\d`（要求 ID ラベル `MUST-14`）だけの行は要件にしない。RFC 9293 Appendix B は `Treat as unsigned number | MUST-1 | X | | | |` を 110 行並べ、ラベルのレベルと X の列のレベルが違う行がある（`MUST-60` の X は MUST NOT の列）。要件そのものは §3.1 などの本文から出ている。`fullContext` は見出し行 + その行。主語・条件・アクションは付けない。監査 corpus の XML 32 本には本文の行にキーワードを持つ `<table>` が無く、この経路は単体テストでのみ検証している。

ASN.1 の型定義の欄と値を並べた表（`keyIdentifier [0] KeyIdentifier OPTIONAL,`）は散文ではないので要件にしない。

## 公開前に通すもの

v0.6.0 から v0.6.13 まで、13 件の不具合はすべて公開したあとの試用で見つかった。どれも公開は必要なかった。手元で同じ操作をすれば同じものが出た。publish の前に次を順に通す。件数は v0.6.53 時点の実数で、増やすたびに古くなる。正は各ファイルと `npm test` の出力である。

| 手順 | 見るもの |
|---|---|
| `npm test` | 書いた条件の取りこぼし（622 件） |
| `npm run test:e2e` | MCP クライアントから見た振る舞い（76 件） |
| `npm run audit` | 想定していない書式で破れる場所（RFC 171 本 × 不変条件 51 種） |
| `npm run crosscheck` | 出力どうしの食い違い（RFC 171 本 × 14 種、X1〜X14） |
| `npm run snapshot` | 条件に落とせない見た目の崩れ（出力見本 38 本） |
| `rfcxml-mcp-dev` で試用 | 実際の使い方で気づくもの |

CI が回すのは一部だけである。`ci.yml` は push / PR ごとに `lint` → `format:check` → `npm test` → `build` → `npm run test:e2e` を回す。`publish.yml` は `npm test` → `npm run build` → `npm run test:e2e` を通してから publish する。`audit.yml` は週次（月曜 00:00 UTC）と `workflow_dispatch` で `audit` → `crosscheck` → `snapshot` を回し、`tests/audit/.cache` を `actions/cache` に載せる。0.6.41〜0.6.45 のあいだ監査が手元で止まっていたことに気づけなかったので置いた。週次で通るからといって publish の前に手元で通さなくてよいわけではない。

`npm run snapshot` で固定した出力は [出力例](/ja/reference/examples) に載せている。
