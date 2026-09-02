# Changelog

All notable changes to this project will be documented in this file.

## [0.6.7] - 2026-09-02

v0.6.6 の試用で挙がった 5 件を直した。

### Fixed

- **`MUST NOT` に反する主張が `isValid: true` になっていた** (`validate_statement`):

  RFC 9114 §6.2.3 は「Endpoints MUST NOT consider these streams to have any meaning
  upon receipt.」と書いている。これに正面から反する主張が矛盾なしと返っていた。

  ```
  statement: "An endpoint treats a reserved stream type as having a defined meaning upon receipt."
  v0.6.6 → isValid: true, conflicts: []
  v0.6.7 → isValid: false, conflicts: 1 件（R-6.2.3-154）
  ```

  原因は 2 つ重なっていた。

  - **主語の単複を別物として扱っていた**。主張の主語は "endpoint"、要件の
    `subject` は "endpoints" で、`===` で比べていた。順位付けでは主語一致
    ボーナス (5) が付かず、一致語 6 語のこの要件が一致語 3 語の無関係な要件より
    下に落ちていた（順位 8 位、スコア 9）。`detectConflicts` は入口で主語一致を
    求めるため、矛盾の検査自体が行われていなかった。
    `requirementSubjectOf()` を追加し、"an endpoint" / "endpoints" のどちらからも
    単数形の主語語を取る。**順位 1 位、スコア 14** になった。
  - **動詞の入れ替えを見ていなかった**。`NEGATION_PAIRS` は「肯定形と否定形の対」
    （mask ↔ unmask）しか持たない。consider と treat のように、同じ行為を別の
    動詞で述べている場合には当たらない。`findProhibitionViolation()` を追加した。

    誤検出を避けるため 3 つとも満たすことを求める。

    1. 主張が否定を含まないこと（含むなら禁止に従っている見込みが高い）
    2. 禁じられた行為の**主動詞、またはその同義語**が主張に現れること。
       これが要点である。"A server MUST NOT mask any frames that it sends to the
       client." に対する「The server sends frames to the client.」は
       frames / sends / client が重なるが mask が無いので矛盾ではない
    3. 主動詞以外に、行為の内容語が 3 語以上重なること

    同義語の表（consider / treat / regard など 11 組）は**網羅ではない**。
    ここに無い動詞では矛盾を検出しない。検出しないことは `isValid: true` の意味
    （矛盾が見つからなかった）と一致しており、準拠の主張ではない。

- **目的語の中の動詞を要求アクションと取り違えていた**（上記の修正で表面化）:
  - 要求アクションの動詞を「先頭から 20 文字以内に現れるか」で見ていたため、
    RFC 6455 §6.2 の "remove masking for data frames received from a client" が
    「mask を求めている」と読まれ、「The server sends unmasked frames to the
    client.」と矛盾していた。この要求が求めているのは masking を remove すること
    である。
  - 動詞は要求アクションの**主動詞**であることを求める（受動態の be は飛ばす）。
    `ACTION_VERB_WINDOW` は不要になったので削除した。
  - 実測: 「The server sends unmasked frames to the client.」の矛盾 1 件 → **0 件**。
    「A client sends unmasked frames to the server.」は 4 件 → **2 件**（§5.1 の
    "a client MUST mask all frames" と §6.1 の "the frame(s) MUST be masked"）に
    絞られた。

- **`get_rfc_dependencies` の `_sourceNote` が事実と食い違っていた**:
  - テキスト経路では常に「Titles/anchors are placeholders」と注記していたが、
    v0.6.6 から題名は参考文献の欄から取っている。同じ応答の中に
    `"title": "The Web Origin Concept"` があるのに「仮置き」と書いていた。
  - 注記は本当に劣化しているときだけ出す。テキスト経路で残る制約は 1 つで、
    参考文献の欄が 1 つしかない RFC（RFC 2616）ではすべて `informative` に入る。
    そのときだけ、その旨を注記する。RFC 6455 では注記が出なくなった。

- **節の直下に置かれた `<iref>` が、定義でない段落を拾っていた** (`get_definitions`):
  - RFC 9110 §7.7 は `<iref>` を節の直下に置き、導入の段落を 1 つ挟んでから定義を
    書く。`transforming proxy` の定義が「中間装置には変換機能を持つものがある」に
    なっていた。
  - 起点の段落に用語そのものが出てこないときは、**同じ節の中を 4 段落先まで見て、
    用語を含む最初の段落を採る**。見つからなければ起点に戻す。
  - 実測（iref 由来の定義のうち、定義本文に用語が出てくるもの）:

    | RFC | v0.6.6 | v0.6.7 |
    |---|---|---|
    | 9110 | 154 / 172（89.5%） | **162 / 172（94.2%）** |
    | 9114 | 13 / 14 | **14 / 14** |

  - `transforming proxy` は「An HTTP-to-HTTP proxy is called a "transforming proxy"
    if it is designed to modify messages in a semantically meaningful way.」に、
    `browser` と `target URI` も定義の段落になった。

- **`fullContext` に行頭の黒丸が残っていた**:
  - `text` からは落としていたが、`fullContext` は `"o Control frames …"` のまま
    だった。同じ段落の同じ書き出しである。
  - 実測: RFC 6455 の 213 件中、黒丸で始まる `fullContext` は **0 件**（v0.6.6 は
    リスト項目由来のものすべて）。

- **`action` が並列の読点で切れていた**:
  - RFC 6455 §5.4 の "MUST be either text, binary, or one of the reserved opcodes"
    の `action` が `"be either text"` になっていた。
  - `clipAtClauseEnd()` は並列の読点で切らない。判定は 2 通りで、読点のあとに
    もう 1 項目あり、そのあとに接続詞が来る形（3 項目以上の並び）はそれだけで
    並列とみなす。読点の直後がいきなり接続詞の場合は、節の連結
    （"…sent by the sender, and the receiver checks it."）と区別がつかないため、
    直前に `either` などの目印があるか、すでに並列の読点を通っていることを求める。
  - `action` は `"be either text, binary, or one of the reserved opcodes"` になった。

### Added

- **テストを 285 件から 300 件へ**: 主語の単複（複数形の要件・複数形の主張・
  単数形を優先すること）、禁じられた行為の検出（動詞の入れ替え・準拠した主張・
  否定を含む主張・動詞が無い主張）、要求アクションの主動詞、`clipAtClauseEnd` の
  並列、`fullContext` の黒丸、定義の段落選び（前方探索・見つからないとき・
  節をまたがないこと）。
- **E2E テストを 45 件から 54 件へ**: RFC 9114 の禁止違反が `isValid: false` に
  なり、その要件が 1 位に来ること、準拠した主張が矛盾にならないこと、
  "remove masking" を mask の要求と読まないこと、RFC 6455 に仮置きの注記が
  出ないこと、RFC 2616 に単一 References 欄の注記が出ること、
  `transforming proxy` の定義、`fullContext` の黒丸、並列の `action`。

### Notes

- 主語で照合する仕組みは残っている。要件の主語が `SUBJECT_TERMS`（client /
  server / endpoint など 12 語）に無いとき（"SETTINGS frames MUST NOT be sent …"）、
  その要件は矛盾検出の対象外のままである。

## [0.6.6] - 2026-09-02

v0.6.5 の試用で挙がった 5 件を、指示された順（定義と参照 → 要件文 → チェックリスト →
出力の表記）で直した。

### Fixed

- **`<dl>` を使わない RFC の定義が 1 件も取れていなかった** (`get_definitions`):
  - RFC 9110 が返す 26 件は §14.6（メディア型登録の記入欄）と §16.3.1（フィールド名
    登録の記入欄）で、`resource` `client` `server` `cache` といった同文書の用語は
    入っていなかった。`get_definitions(rfc=9110, term="cache")` は 0 件だった。
  - RFCXML では、用語を定義している箇所に `<iref primary="true">` が置かれる。
    RFC 9110 の XML に `<dfn>` は 1 個も無く、`primary="true"` で `subitem` の無い
    `<iref>` が 162 個あり、これが用語一覧にあたる。

    ```xml
    <section anchor="caches" pn="section-3.8">
      <name>Caches</name>
      <iref item="cache" primary="true" pn="iref-cache-42"/>
      <t pn="section-3.8-1">
       A "cache" is a local store of previous response messages and the
       subsystem that controls its message storage, retrieval, and deletion. …
    ```

  - `extractIrefDefinitions()` を追加した。`<iref>` を含む段落、無ければ直後の段落を
    定義とする。`primary="false"` は言及であって定義ではないので採らない。
    `subitem` を持つものは索引の下位項目（`item="header fields" subitem="Content-Type"`）
    なので採らない。属性の並び順は RFC ごとに違う（RFC 9114 は `item` が先）ため、
    順序に依存せず読む。
  - この抽出だけはパース前の文字列を見る。`preserveOrder: false` では木から
    `<iref>` と `<t>` の並び順が失われるためである。`<iref>` を落とす処理は
    `renderInlineTags()` から `stripNonPrinting()` に分け、抽出のあとに回した。
  - 同じ用語が `<dl>` と `<iref>` の両方にあるときは `<dl>` を採る。用語と定義の対と
    して書かれているためである。並びは節番号順にした（`compareSectionNumbers`）。
    文字列順では §14.6 が §3.1 の "resource" より前に出ていた。
  - 実測:

    | RFC | v0.6.5 | v0.6.6 | 備考 |
    |---|---|---|---|
    | 9110 | 26 | **198** | 先頭が `resource` (§3.1) になった |
    | 9114 | 80 | **91** | `<dl>` に無い `control stream` 等が加わった |
    | 9293 | 114 | **114** | 用語のコロン除去で重複が畳まれ、増減が相殺 |
    | 9000 | 148 | **148** | 同上 |

- **テキスト経路の参照が本文の言及を拾い、規範性を判別していなかった**
  (`get_rfc_dependencies`):
  - 本文全体を `RFC\s*(\d+)` で走査していた。そのため RFC 6455 の 22 件はすべて
    `informative` に入り、`normative` は空だった。参考文献に載っていない言及
    （"RFC 5741" は Status of This Memo の定型文、"RFC 6202" は §1.1 の地の文）まで
    参照に数え、題名は `"RFC 2119"` という仮置きしか返せなかった。
  - "14.1 Normative References" / "14.2 Informative References" の見出しで欄を切り替え、
    `   [RFC2119]` で始まる行から項目を取る。題名は最初の二重引用符の中、RFC 番号は
    角括弧の中（`[RFC2119]`）か、項目末尾の連番（`…, BCP 14, RFC 2119, March 1997.`）
    から取る。
  - ページの区切り（`[Page 68]` の行と、次ページ冒頭の
    `RFC 6455 … December 2011` の行）は字下げが無い。見出しとして通らなかった
    非字下げ行を読み飛ばすことで一緒に落ちる。
  - 節見出しの検出は v0.6.5 の規則（1 桁目から始まる行だけを見出しとする）に従う。
    この修正が成り立つのは、その修正が入っているからである。
  - 実測（規範的 / 参考的、題名が取れた件数）:

    | RFC | v0.6.5 | v0.6.6 |
    |---|---|---|
    | 6455 | 0 / 22（題名 0 件） | **18 / 9（27 件）** |
    | 8446 | 0 / 49（0 件） | **27 / 70（97 件）** |
    | 7230 | 0 / 34（0 件） | **14 / 25（39 件）** |
    | 3986 | 0 / 23（0 件） | **4 / 23（27 件）** |
    | 2616 | 0 / 42（0 件） | **0 / 49（49 件）** |

  - RFC 2616 が 0 / 49 なのは、この RFC の参考文献の欄が 1 つしか無いためである。
    テキストからは規範性を判別できないので `informative` に入れる。

- **テキスト経路の要件文に改行と字下げが残っていた**:
  - `- [ ] The masking key needs to\n   be unpredictable; thus, …` のように
    `generate_checklist` の Markdown が箇条書きとして成立していなかった。
    RFC 6455 では 215 件中 209 件に改行または 4 個以上の連続空白があった。
  - 段落が図・ABNF でなければ、要件文・`condition`・`action`・`fullContext` を畳む。
    図の判別は `looksLikeDiagram()` が体裁で行う（行頭から始まる ABNF の規則、
    2 個以上の空白のあとのセミコロン、4 文字以上の罫線、同じ行で空白が続く縦罫）。
  - **散文にも現れる書き方は目印にしない**。`%x0A`（RFC 7230 §3 の
    "the octet LF (%x0A)" は散文）と、`|` のあとの改行（RFC 6455 は本文でヘッダ名を
    `|Origin|` と括る）は、いずれも散文を図と誤判定させていた。
  - 行頭の黒丸 `"o  "` を落とす。RFC 6455 §5.4 の 3 件が
    `"o  Message fragments MUST be delivered …"` で始まっていた。
  - **ABNF の注釈は散文として組み直す**。続く注釈行をまとめて `;` を外す。
    RFC 6455 §5.2 の要件は
    `"frame-rsv1              = %x0 / %x1\n     ; 1 bit in length, MUST "`（"MUST " で
    切れていた）から `"1 bit in length, MUST be 0 unless negotiated otherwise"` になった。
  - 実測（改行または 4 個以上の連続空白を含む要件文 / 総数）:

    | RFC | v0.6.5 | v0.6.6 |
    |---|---|---|
    | 6455 | 209 / 215 | **0 / 213** |
    | 8446 | 448 / 471 | **0 / 468** |
    | 7230 | 220 / 227 | **0 / 226** |
    | 2616 | 745 / 773 | **0 / 773** |

  - 総数が減るのは、空白の違いだけで別物とされていた要件が重複排除で 1 件に畳まれる
    ためである。

- **`generate_checklist` が同じ行を 2 度出していた**:
  - 1 つの文が `MUST` と `MUST NOT` の両方を含むとき（RFC 6455 §5.3 の
    "the masking key MUST be derived from a strong source of entropy, and the masking
    key for a given frame MUST NOT make it simple …"）、要件は 2 件立つが文は同じで、
    どちらの語についての項目なのか読み取れなかった。
  - 各行に要件レベルを出す（`- [ ] **MUST NOT** … (§5.3)`）。レベルも節も文も同じ行は
    1 度だけ出す。

- **`section` の形が経路によって違っていた**:
  - テキスト経路が `5.3`、XML 経路が `section-6.2.3`、後付録が
    `section-appendix.a.2.5` を返していた。`get_requirements` の結果をそのまま
    `get_related_sections` に渡すと、RFC ごとに文字列の形が変わっていた。
  - 外に出す `section` と `id`（`R-6.2.3-1`）、`get_rfc_structure` の `number` は
    `normalizeSectionNumber()` を通す。後付録は `A.2.5`（公開版 RFC の
    "Appendix A.2.5"）にする。検索側も同じ関数を通すため、`6.2.3` `section-6.2.3`
    `A.2.5` `appendix.a.2.5` はいずれも同じ節に当たる。
  - 実測: XML 経路の要件で `section-` が残るもの、RFC 9110 / 9114 / 9293 / 9000 の
    それぞれ 438 / 255 / 122 / 517 件 → **すべて 0 件**。

- **用語に末尾のコロンと引用符が残っていた** (`get_definitions`):
  - `"stream:"` `"Push ID:"` `"\"Strong comparison\":"`。部分一致では引けるが、
    完全一致で引く利用者には当たらない。
  - 実測: コロン付きの用語は RFC 9110 / 9114 / 9293 / 9000 で
    26 / 80 / 42 / 148 件 → **すべて 0 件**。

### Added

- **テストを 259 件から 285 件へ**: iref からの定義抽出（含む段落・直後の段落・
  `primary="false"` を採らないこと・`subitem` を採らないこと）、用語と節番号の表記、
  参考文献の欄からの参照抽出（規範性の分離・題名・ページの区切り・本文中の言及）、
  要件文の畳み込み（折り返し・黒丸・ABNF の注釈・図は畳まないこと）、
  チェックリストの体裁。
- **E2E テストを 36 件から 45 件へ**: RFC 9110 の `cache` が定義として返ること、
  定義が節番号順に並ぶこと、RFC 6455 の参照が 18 / 9 に分かれ題名が取れること、
  参考文献に無い RFC 5741 が参照に出ないこと、要件文に改行が残らないこと、
  ABNF の注釈が散文になること、チェックリストの各項目が 1 行に収まること。

### Notes

- RFC 3986 の要件が 0 件なのは不具合ではない。この RFC は大文字の BCP 14 キーワードを
  1 つも使っていない。

## [0.6.5] - 2026-09-02

v0.6.4 の試用で挙がった 3 件を、指示された順（空白 → 節の誤認 → 索引）で直した。

### Fixed

- **本文に空白の塊が残っていた**（XML 経路）:
  - インライン要素を素テキストへ置き換えると、要素が独立した行に置かれていた分の
    字下げが残る。RFC 9114 §6.2.3 の要件文は
    `"They            MAY\n also be sent on connections where no data is\ncurrently being transferred."`
    となっていた。公開版は "They MAY also be sent on connections…" である。
  - `extractProse()` を追加し、散文（`<t>` / 節の題名 / リスト項目 / 定義 /
    参考文献の題名）の空白を 1 個に畳む。段落内の改行と字下げは表示上のもので
    意味を持たず、公開版 RFC も 72 桁で組み直している。
  - **`<sourcecode>` と `<artwork>` には適用しない**。空白が意味を持つため。
  - 実測（4 個以上の連続空白を含む要件文）:

    | RFC | v0.6.4 | v0.6.5 |
    |---|---|---|
    | 9114 | 244 / 255 | **0** |
    | 9293 | 57 / 122 | **0** |
    | 9110 | 31 / 438 | **0** |

  - テキスト経路（RFC 8650 未満）は畳んでいない。そこでの改行と字下げは RFC の
    .txt そのものの体裁であり、タグ除去の跡ではない。加えてテキスト経路では
    ASCII 図も text ブロックとして入るため（RFC 6455 §5.2 の frame 図など）、
    一律に畳むと図が壊れる。
- **本文の番号付きリスト項目を節として拾っていた**（テキスト経路）:
  - 節見出しは 1 桁目から始まるが、`line.trim()` してから照合していたため字下げが
    失われ、`"   1.  The components of the URI MUST be valid."` のようなリスト項目を
    節として扱っていた。同じ節番号がいくつも並び、`findSection` がどれを引くか
    定まらず、要件の `sectionTitle` に本文の 1 行目が出ていた。
  - 字下げのない行だけを節見出しとして扱う。
  - 実測（節数と節番号の重複）:

    | RFC | v0.6.4 | v0.6.5 |
    |---|---|---|
    | 6455 | 141（重複 52） | **88（0）** |
    | 8446 | 95（重複 8） | **86（0）** |
    | 7230 | 104（重複 16） | **86（0）** |
    | 3986 | 72（重複 3） | **68（0）** |

  - **欠けていた要件が復活した**。リスト項目の行が節の題名として消費されると、
    その行の要件は抽出されない。RFC 6455 の要件は 199 件 → **215 件**になり、
    30 件が正しい親の節へ移った。文の途中から始まっていた要件文
    （`"(/host/, /port/, /resource name/, and /secure/ flag) MUST be valid …"`）も
    完全な文になった。
- **自動生成の索引を定義として拾っていた** (`get_definitions`):
  - 索引は用語ごとに出現箇所を並べた `<dl>` を持つため、定義として出ていた。
    `{ "term": "control stream", "definition": "Section 2, Paragraph 3; …" }`
  - `<name>` が "Index" の節を除外する。索引の節には anchor が付かず `pn` も
    連番なので、名前で判別する。**後付録ごと除外はしない** — RFC 9114 の
    Appendix A.2.5 のように本物の定義が後付録に置かれることがある。
  - 実測: RFC 9114 112 件（索引 32）→ **80 件（0）**、
    RFC 9110 474 件（索引 448）→ **26 件（0）**。

### Added

- **テストを 250 件から 259 件へ**: 空白の畳み込み（タグ除去の跡・段落の折り返し・
  節の題名・sourcecode と artwork を畳まないこと）、字下げされたリスト項目、
  1 桁目の節見出し、索引の除外、後付録の定義を残すこと。
- **E2E テストを 32 件から 36 件へ**: RFC 6455 の節番号に重複が無いこと、
  RFC 9114 の要件文に連続空白が無いこと、索引が定義に出ないこと、
  後付録の定義が残ること。

### Notes

- 本文テキストの公開版 .txt との一致率は変わらず（RFC 9293 / 9110 / 9114 / 9457 /
  9112 / 9205 / 8996 が 100%、9000 99.3%、9113 99.7%、8949 90.6%）。
  一致率の計測は空白を正規化して比較しているため、今回の変更では動かない。

## [0.6.4] - 2026-09-02

テキスト経路（RFC 8650 未満）の題名と節、および XML 経路のインライン要素を直した。
インライン要素の対応で、本文テキストは公開版 RFC とほぼ完全に一致するようになった。

### Fixed

- **テキスト経路の題名がヘッダ塊の 1 行目になっていた**:
  - 「コロンを含まない適度な長さの行」を上から探していたため、発行者と著者が
    2 段組で並ぶ 1 行目（"Internet Engineering Task Force (IETF)   B. Leiba"）を
    題名として拾っていた。コロンを含む題名（RFC 3986
    "Uniform Resource Identifier (URI): Generic Syntax"）も落としていた。
  - ヘッダ塊を最初の空行で終端し、その次の非空行から取るようにした
    （中央寄せの字下げがあること、2 行に折り返す題名を繋ぐことを条件に含む）。
  - `ParsedRFC['metadata'].title` を任意にした。判別できないときは
    Datatracker の題名へ落ちる。
  - 実測: RFC 8174 / 6455 / 8446 / 2119 / 793 / 7230 / 5246 / 3986 の 8 本すべてで
    正しい題名になった。
- **目次の行が節として混ざっていた**:
  - 目次は「題名 + リーダー + ページ番号」で終わる。リーダーの書き方は
    ドット + 空白（RFC 6455）と連続ドット（RFC 8446）の 2 通りがある。
    どちらも節として拾っていたため、同じ節番号が目次と本文の 2 回現れていた。
  - `isValidSectionHeader` の先頭で除外する。
  - 実測: RFC 8174 10 節 → 5 節、RFC 6455 228 → 141、RFC 8446 172 → 95。
- **インライン要素が本文から落ちていた**（`<xref>` と同じ理由）:
  - `<tt>` `<em>` `<strong>` `<sup>` `<sub>` `<contact>` `<eref>` `<iref>` を
    パース前に素テキストへ置き換える（`renderInlineTags`）。
    RFC 9114 の "HEADERS<tt>…</tt>frame" が "HEADERSframe" と語ごと繋がり、
    RFC 9293 の "2<sup>32</sup> - 1" が "2- 1" になっていた。
  - 置き換えは公開版 .txt の印字に合わせる。`<em>` は `_X_`、`<strong>` は `*X*`、
    `<sup>` は `^X`、`<contact fullname="N"/>` は `N`、`<iref>` は何も出さない。
    `<tt>` を引用符で囲む RFC もあるが（RFC 8949 / 9000）、囲まない RFC もあり
    （RFC 9114 / 9113）、公開版 10 本での一致率は囲まない方が高い（99.3% 対 98.7%）
    ため素のまま出す。
- **`<xref>` の描画を 2 点直した**:
  - 中身がある `<xref>` が中身を落としていた。"RFC 793 [16]" が "[16]" に、
    "byte-range requests (Section 14.1.2)" が "Section 14.1.2" になっていた。
  - 付録を "Section B" と書いていた。`derivedLink` の `#appendix-` を根拠に
    "Appendix B" と書く（属性が無い場合は番号が数字で始まらないことを手がかりにする）。

### Notes

- **本文テキストの一致率**（公開版 .txt との段落完全一致、折り返しのハイフン・
  スラッシュを両側で正規化して比較）:

  | RFC | v0.6.3 | v0.6.4 |
  |---|---|---|
  | 9293 (TCP) | 97.6% | **100.0%** |
  | 9110 (HTTP Semantics) | 97.8% | **100.0%** |
  | 9114 (HTTP/3) | 62.6% | **100.0%** |

  他に RFC 9457 / 9112 / 9205 / 8996 も 100%、RFC 9000 99.3%、9113 99.7%、
  8949 90.6%。8949 の残りは `<tt>` の引用符と `<sup>` の括弧付き表記
  （"2^(64)"）で、公開時の xml2rfc の版差によるもの。
- テキスト経路には、本文中の番号付きリスト項目を節と誤認する問題が残っている。
  RFC 6455 は目次を除いたあとでも 141 節のうち 52 件が節番号の重複で、
  "5. If /secure/ is true, the client MUST perform a TLS handshake over" のような
  リスト項目が節として現れる。別途対応する。

### Added

- **テストを 234 件から 250 件へ**: 題名（ヘッダ塊の除外・コロンを含む題名・
  2 行の題名・判別不能）、目次の 2 形式、インライン要素 7 種、入れ子、
  付録の書き分け、中身がある xref。
- **E2E テストを 28 件から 32 件へ**: RFC 8174 の題名と節数、
  RFC 9114 で語が繋がっていないこと、`<tt>` が本文に残っていること。

## [0.6.3] - 2026-09-02

v0.6.2 の試用で挙がった 2 件を修正した。どちらも v0.6.2 で `<xref>` を本文に
描画するようになったことで露出が増えたもので、原因自体は以前からあった。

### Fixed

- **平文で書かれた別文書の節を、この RFC の節として解決していた**:
  - v0.6.2 の切り分けは角括弧の書誌ラベル（`[HTTP/1.1]`）だけを対象にしていた。
    `sectionFormat="bare"` の `<xref>` は地の文が文書名を書くため、
    "GET_MAXSIZES in Section 3.4 of RFC 1122." や
    "as explained in RFC 6691, Section 3.1." という形になり、素通りしていた。
  - `createExternalSectionRegexes` に `Section X of RFC NNNN` と
    `RFC NNNN, Section X` を追加した。節番号の照合も `[\d.]+?` から
    `\d+(?:\.\d+)*` へ変え、文末の句点を巻き込まないようにした。
  - RFC 9293 §3.7.1 の `get_related_sections` は、RFC 1122 §3.4 を
    「3.4 = Sequence Numbers」、RFC 6691 §3.1 を「3.1 = Header Format」として
    返していた。どちらも RFC 9293 の節ではない。v0.6.3 では返さない。
- **要件文が節番号や略語のピリオドで切れていた**:
  - `extractSentence` はピリオドを無条件に文末とみなしていた。RFC 本文には
    "(see Section 5.3 for further details)." や "(e.g., ...)" が頻出するため、
    要件文が "…(see Section 5." や "…low number (e." で終わっていた。
  - 文末の判定を `isSentenceEnd` に切り出した。句読点の直後が空白か文字列の
    終わりであること、直前が略語（`e.g.` `i.e.` `etc.` など）でないことを課す。
  - `parseRequirementComponents` の `condition` / `exception` / `action` は
    `[^,.]+` で止めていたため、括弧内のカンマでも切れていた
    （"this fails (e" ）。`clipAtClauseEnd` に置き換え、括弧の中のカンマでは
    切らないようにした。
  - 途中で切れた要件文の数（`(see Section N.` / `(e.` の形）:

    | RFC | 修正前 | v0.6.3 |
    |---|---|---|
    | 6455 | 4 | **0** |
    | 9293 | 6 | **0** |
    | 9110 | 16 | **0** |

  - 副次的に重複が減った。切れた文と完全な文が別々の要件として並んでいたため。
    RFC 9293 は 129 件 → 122 件、RFC 9110 は 439 件 → 438 件。
    消えた要件は無く（section + level の組は全て残存）、減ったのは
    「同じ要求の切れた版」だけであることを実測で確認した。

### Added

- **テストを 222 件から 234 件へ**: 文末判定（節番号・略語・通常の文末）、
  `clipAtClauseEnd`（括弧内のカンマ・節番号・括弧外のカンマ）、
  平文の別文書参照 2 形、同じ文に両方があるとき。
- **E2E テストを 25 件から 28 件へ**: RFC 9293 §3.7.1 が RFC 1122 / RFC 6691 の
  節を含まないこと、要件文が節番号の途中で終わらないこと、
  略語や節番号の途中で切れた要件文が 1 件も無いこと。

### Notes

- 括弧の釣り合いは品質の指標にならない。RFC 6455 §11.3.2 は原典が
  "(which is logically the same as ... contains all values." と閉じ括弧を
  欠いており、忠実に取れば釣り合わない（§11.3.3 の同じ文は閉じている）。
  E2E は釣り合いではなく「切れ方の形」を見る。

## [0.6.2] - 2026-09-02

v0.6.1 の試用で挙がった 3 件を修正した。うち `<xref>` の取りこぼしは本文テキスト
そのものを壊しており、要件抽出・チェックリスト・マッチングの全てに影響していた。

### Fixed

- **`<xref>` が本文から落ちていた**（影響範囲が最も広い）:
  - パーサは `preserveOrder: false` で動くため、インライン要素は本文テキストから
    位置ごと落ちる。RFC 9110 §9.3.1 の
    "request smuggling attack (Section 11.2 of [HTTP/1.1])" は
    "request smuggling attack ()." になっていた。
  - BCP 14 タグと同じく、パース前に素テキストへ置き換えるようにした
    (`renderXrefTags`)。置き換えは RFCXML の `format` / `sectionFormat` 属性と
    `derivedContent`（公開版が持つ印字用文字列）に従う。
    `bare` は節番号だけ、`of` は "Section 11.2 of [HTTP/1.1]"、
    `counter` は番号だけ、`none` は要素の中身だけを出す。
  - 公開版 RFC のテキストと本文段落を突き合わせた一致率（空白正規化・完全一致）:

    | RFC | 修正前 | v0.6.2 |
    |---|---|---|
    | 9293 | 62.5% | **92.9%** |
    | 9110 | 41.9% | **92.5%** |
    | 9114 | 26.6% | **60.7%** |

  - 残りの不一致は `<tt>` `<em>` `<sup>` など他のインライン要素が同じ理由で
    落ちているもの。RFC 9114 が低いのはこれが多いため。別途対応する。
- **別文書の節をこの RFC の節として返していた**:
  - `<xref>` を描画した結果 "Section 11.2 of [HTTP/1.1]" が本文に現れるようになり、
    そのままでは 11.2 をこの RFC の §11.2 として拾ってしまう。
    `extractCrossReferences` を、別文書の節（`type: 'external'`）と
    この RFC の節（`type: 'section'`）に分けるようにした。
  - あわせて、文末の句点を節番号に巻き込む不具合を直した（"Section 6.1." → `6.1`）。
  - `get_related_sections` は anchor をそのまま返さなくなった。
    RFC 9110 §9.3.1 は 10 件中 6 件が `title: "Unknown"` だったが、
    v0.6.2 では 4 件すべてが実在する節に解決する。
- **`metadata.date` が公開日ではなかった**:
  - Datatracker の `document.time`（レコードの最終更新時刻）を返していた。
    RFC 9293 は公開が 2022-08 なのに 2026-05-20 を返していた。
  - RFCXML の `front/date`、テキスト経路ではヘッダ行から公開年月を取るようにした。
    実測: RFC 9293 → `2022-08`、RFC 9110 → `2022-06`、RFC 6455 → `2011-12`。
  - `RFCMetadata.date` は `datatrackerUpdated` へ改名した（値の意味に名前を合わせた）。
    ツールの応答には出さない。
- **機能語がスコアを押し上げていた** (`validate_statement`):
  - `STOP_WORDS` に 3 文字以上の機能語（`and` / `for` / `not` / `are` など）が
    無く、内容の一致が無い要件でも機能語だけでスコアが積み上がっていた。
    RFC 6455 では 10 件中 8 件が `["client", "and", "server"]` だけで同点だった。
  - BCP 14 キーワード（`must` / `should` / `may` など）も内容語から外した。
    ほぼ全ての要件文に現れるうえ、レベルの一致は `LEVEL_MATCH_BONUS` が別に見ている。

### Changed

- **判定に「主語以外の一致語」を求めるようにした**: `MIN_SCORE_FOR_VERDICT` に加えて
  `MIN_CONTENT_KEYWORDS_FOR_VERDICT`（2 語）を満たさなければ `isValid` は `null`。
  主語だけの一致（"The client" とだけ書いた主張）はスコア 8 に達するが、
  何を論じているかを示していないため判定しない。
- **語形の違いを吸収するようにした**: 主張が "masks" と書き要件が "mask" と書く場合、
  素の部分文字列比較では一致しなかった。主張側の語尾（`ing` / `ed` / `es` / `s`）を
  落とした語幹でも照合する。語幹が 4 文字未満になる場合は落とさない。

### Added

- **テストを 198 件から 222 件へ**: xref の各 `format` / `sectionFormat`、
  公開日の抽出（数字月・月名・日付あり・年のみ・欠落）、テキスト経路の公開日、
  別文書参照の分離、句点の巻き込み、機能語の除外、主語のみの主張。
- **E2E テストを 23 件から 25 件へ**: 公開日が `2022-08` であること、
  `get_related_sections` が未解決の節を返さないこと、
  別文書の節を含まないこと、本文に空の括弧が残っていないこと。

## [0.6.1] - 2026-09-02

v0.6.0 を実機で試用して見つかった 2 件の不具合を修正した。どちらも SDK 移行とは
無関係で、以前から存在していた抽出・判定ロジックの問題である。

### Fixed

- **同じ要件が二重に出る問題** (`get_requirements` / `generate_checklist` /
  `validate_statement`):
  - 1 つの文に同じレベルのキーワードが 2 回現れると、マーカーが 2 個立って
    同じ文が 2 件の要件として出力されていた。RFC 1122 の系譜を引く RFC は本文に
    `(MUST-14)` `(MAY-3)` という要求 ID ラベルを埋め込むため、`\bMUST\b` が
    ラベル内の MUST にも一致してこれが常時起きていた。
  - `extractRequirementsFromSections` に「セクション + レベル + 要件文」を鍵とする
    重複排除を入れた。文が同一なら要件としても同一なので、最初の 1 件だけを残す。
  - 実測 (全文): RFC 9293 199 件 → 126 件（MUST 112 → 58）、
    RFC 6455 204 件 → 199 件、RFC 9110 438 件 → 436 件。
    RFC 9293 §3.7.1 のチェックリストは 10 項目 → 6 項目。
  - **ラベルをキーワード走査から除外する方法は採らなかった**。RFC 9293 §3.7.1 の
    MUST-67 のように、BCP 14 キーワードを持たずラベルだけで要求を示す文があり、
    除外するとこれを取りこぼす。ラベルは拾ったうえで重複排除する。
- **`validate_statement` が根拠なしに判定を主張する問題**:
  - `isValid` を `boolean` から `boolean | null` へ変更した。最上位マッチのスコアが
    `MATCHING_LIMITS.MIN_SCORE_FOR_VERDICT` (7) に届かないときは `null` を返す。
    以前は一致が 0 件でも `conflicts.length === 0` から `isValid: true` を返しており、
    「該当なし」が「準拠している」と読めてしまっていた。`isValid` が `null` のときは
    `_verdictNote` でその旨を明示する。
  - 矛盾検出が要件文全体を見ていたため、条件節の無関係な否定を要求アクションと
    取り違えていた。RFC 6455 §5.1 に準拠する
    "The server sends unmasked frames to the client" が、§4.2.1 の条件節
    "finds that the client did not send a handshake" と衝突したと報告されていた。
    キーワードより後ろ（`requiredActionOf`）だけを見るように変更した。
  - `send` / `receive` / `include` のような一般的な動詞では、動詞が一致しただけの
    当たりを落とすようにした（動詞以外に共通する語を 1 つ以上求める）。
    `mask` / `encrypt` / `validate` のように動詞自体が具体的なものには課さない。
  - 矛盾の理由文が定型だったのを、「主張側のどの否定表現が、要求側のどの動詞に
    反するか」を名指しする形に変えた。

### Changed

- **`instructions` と `validate_statement` の説明を更新**: `isValid` が三値であること、
  マッチングが英語キーワードベースであることを明記した。日本語で書いた主張は
  一致しない。
- **`Requirement.action` に依存しない矛盾検出**: `requiredActionOf()` を追加。
  `action` は「キーワード直後から最初の句読点まで」を狙う正規表現で作られるが、
  RFC 本文は 72 桁で折り返されるため改行に阻まれ、テキスト経路では大半が
  `undefined` になっていた。

### Added

- **テストを 184 件から 198 件へ**: 要求 ID ラベル、ラベルのみの要求、同一文の重複、
  条件節の誤検出、一般的な動詞の誤検出、`requiredActionOf` の各ケース。
- **E2E テストを 19 件から 23 件へ**: 誤検出しないこと、一致が無いとき `isValid` が
  `null` になること、`get_requirements` と `generate_checklist` に重複が無いこと。

## [0.6.0] - 2026-09-02

MCP SDK を v1 (`@modelcontextprotocol/sdk`) から v2 (`@modelcontextprotocol/server` /
`@modelcontextprotocol/client`) へ移行した。あわせて低レベル `Server` API から
`McpServer` へ作り直している。

### Changed

- **MCP SDK v2 へ移行**:
  - `@modelcontextprotocol/sdk@^1.29.0` を削除し、`@modelcontextprotocol/server@^2.0.0` を
    dependencies に、`@modelcontextprotocol/client@^2.0.0` を devDependencies（E2E 用）に追加。
  - import から `.js` 拡張子が外れる（`@modelcontextprotocol/server/stdio`）。
  - v2 で低レベル `Server` は `@deprecated` 扱いになったため、`McpServer` +
    `registerTool()` / `registerResource()` へ作り直した。`setRequestHandler` の
    4 ハンドラ（`tools/list` / `tools/call` / `resources/list` / `resources/read`）は
    SDK 側が持つ。
  - 起動を `server.connect(new StdioServerTransport())` から `serveStdio(() => buildServer())` へ変更。
    v2 は接続開始時にプロトコル era を確定し、factory から作った 1 インスタンスを
    その接続に固定する。
- **`src/server.ts` を新設**: サーバ組み立てを `buildServer()` に切り出し、`src/index.ts` は
  起動のみにした。テストから `InMemoryTransport` で同じ関数を叩けるようにするための布石。
- **`src/resources/definitions.ts` を新設**: `rfcxml://schema` の定義を `index.ts` から分離。
- **`tools/definitions.ts` の型**: `Tool[]` から `ToolDefinition[]`（`inputSchema` を
  `JsonSchemaType` に絞った型）へ。`Tool['inputSchema']` は wire 上の緩い JSON 値型で、
  `fromJsonSchema()` にそのまま渡せないため。
- **TypeScript 6.0.3 へ更新**: `tsconfig.json` に `"types": ["node"]` を追加。
- **Node.js 22 以上を要求**: `engines.node` を `>=20.0.0` から `>=22.0.0` へ。
  Node 20 は 2026-04 に EOL。
- **CI の Node マトリクスを 22 / 24 へ**: `publish.yml` も Node 24 に更新。

### Added

- **`instructions` を追加**（`shuji-mcp-patterns` の Pattern G）:
  `initialize` の応答でサーバの射程を宣言する。潰したい誤解は 2 つ。
  1. `validate_statement` が適合判定器だと読まれること。実際は RFC 本文中の
     BCP 14 キーワードと文を突き合わせて該当要件を返すだけで、判定はしない。
  2. 空の結果が「そのような規定は存在しない」と読まれること。RFC 8650 より前は
     テキストフォールバックのため取得できる範囲がツールごとに変わる。
- **ツール定義とハンドラの対応漏れを起動時に検出**: `buildServer()` が
  `toolHandlers` に無いツール名を見つけたら起動時に落ちる。
- **E2E テストを 15 件から 19 件へ拡張**: `instructions` の到達、
  `rfcxml://schema` の list / read、必須項目を欠いた `tools/call` の拒否を追加。

### Fixed

- **`tools/call` の入力検証がサーバ側で走るようになった**: v1 は `inputSchema` を
  宣言するだけでスキーマ検証をしていなかったため、`{"rfc": "9293"}` のような
  型違いや必須項目の欠落がハンドラまで届いていた。v2 は登録したスキーマで検証し、
  違反はハンドラに到達せず `isError` で返る。ハンドラ側の `validateRFCNumber` 等は
  範囲検査として引き続き必要。

### Security

- **`npm audit` の指摘を 0 件にした**（すべて依存更新のみ、本体コードの変更なし）:
  - `fast-xml-parser` を `^4.5.0` から `^5.11.1` へ。GHSA-gh4j-gqv2-49f6 は `XMLBuilder`
    （XML の書き出し）の問題で、本プロジェクトは parser しか使っていないため実害はないが、
    警告を残さないため上げた。RFC 9293 / 6455 の解析結果が v4 と一致することを E2E で確認済み。
  - `vitest` / `@vitest/coverage-v8` を `^2.1.0` から `^4.1.11` へ。
    esbuild の開発サーバの問題（GHSA-67mh-4wv8-2f99）を解消。184 件のテストは全て通る。
  - `brace-expansion` の推移的依存を更新（DoS 系 3 件）。

### Notes

- **TypeScript 7 は今回見送り**: TypeScript 7.0.2 でのビルド自体は 0 エラーで通るが、
  `typescript-eslint` の peer 範囲が `>=4.8.4 <6.1.0` のままで TS 7 を受け付けない。
  型情報付き lint を維持するため TypeScript 6.0.x に留める。
  `typescript-eslint` が対応した時点で `devDependencies` の 1 行変更で移行できる。
- **削除された v1 API のうち本プロジェクトで使っていたものはない**:
  `SSEServerTransport` / `WebSocketClientTransport` は未使用。

## [0.5.4] - 2026-07-14

### Added

- **`.claude-plugin/plugin.json` を追加**: Claude Code プラグインとしてインストール可能にした。`mcpServers.rfcxml` は `npx -y @shuji-bonji/rfcxml-mcp@latest` を起動する。プラグイン利用者は npm install や設定ファイルの手書きなしに MCP サーバを有効化できる。プラグインの `version` は package.json と揃えて管理する（リリース時は両方を同時に更新すること）。

## [0.5.3] - 2026-05-09

### Build

- **build script に `chmod +x dist/index.js dist/cli/prefetch.js` を追加**: local dev で `./dist/index.js` (rfcxml-mcp) や `./dist/cli/prefetch.js` (rfcxml-prefetch) を直接実行した際の `permission denied` を回避。bin が 2 つあるため両方を chmod する。npm install / npx 経由の通常利用には影響なし。shuji 製 MCP 全体で build script を統一。

## [0.5.2] - 2026-04-27

v0.5.1 のテキストフォールバック時のラベル不整合バグを修正し、Issue #5 と
合わせてテキストフォールバック時の機能制約を明文化。

### Fixed

- **`_referencesSource` のラベル不整合 (`get_rfc_dependencies`)**:
  - v0.5.1 ではテキストパーサが参照を抽出していても `_referencesSource: 'xml'` と返してしまっていた。
  - また `_sourceNote` が「Reference information is not available」と誤主張するケースがあった。
  - 修正後は `'xml' | 'text' | 'api'` の三値で実際の取得元を正確に表す。
  - `_sourceNote` は本当に refs が空のときと、テキスト由来でプレースホルダ titles/anchors のときだけ出すように整理。

### Changed

- **`DependencyResult._referencesSource` 型拡張**: `'xml' | 'api'` → `'xml' | 'text' | 'api'`。
  既存コードで `=== 'api'` だけを判定していた呼び出し元は影響なし。`=== 'xml'` を否定形で扱っていた箇所はレビュー推奨。
- **依存解決の優先順位**:
  1. body (xml/text) で refs があれば本文由来を優先（titles/anchors の質が高い）
  2. body の refs が空のときだけ Datatracker API を呼ぶ
  - v0.5.1 では body=text のとき常に API も呼んでいたが、上書きはせず無駄なリクエストを発生させていた挙動を整理。

### Added

- **テキストフォールバック時の機能制約マトリクス** (`CLAUDE.md`):
  - 各ツールが XML / text / API でどこまで動くかを表で明文化。
  - Issue #5 (`get_related_sections` の text 形式制約) を known limitation として記載。

## [0.5.1] - 2026-04-27

discussion #6 を踏まえた IETF Datatracker API のカバレッジ強化と、
オフライン運用向けのディスクキャッシュ層追加。Phase 1 から Phase 3 まで順に実装。

### Added — Phase 3: disk cache + prefetch CLI

The MCP runtime can now read from and write to a persistent on-disk RFCXML cache, enabling offline / CI-pinned operation. The cache is opt-in via the `RFCXML_CACHE_DIR` environment variable.

- **`utils/disk-cache.ts`** — `DiskCache` class. File layout: `<RFCXML_CACHE_DIR>/xml/rfc{N}.xml`. Errors on read/write are logged but never thrown (best-effort layer).
- **`fetchRFCXML` cache hierarchy:**
  1. in-memory LRU (`xmlCache`) — unchanged
  2. on-disk cache (`DiskCache`) — new, opt-in via env var
  3. parallel network fetch — unchanged
  - Fresh network results are written back to both layers.
  - New `forceFresh` option to bypass both caches (used by the prefetch CLI).
- **`bin/rfcxml-prefetch` CLI** (`src/cli/prefetch.ts`):
  - `--range A-B` / `--rfc N` (repeatable) for selecting RFCs.
  - `--cache-dir DIR` (default `$RFCXML_CACHE_DIR` or `~/.cache/rfcxml-mcp`).
  - `--concurrency N` (default 3 — be polite to RFC Editor).
  - `--force` to redownload existing entries.
  - Uses the same `fetchRFCXML` pipeline as the runtime, so source-priority and validation match exactly.
  - Added to `package.json` `bin` so `npx @shuji-bonji/rfcxml-mcp` users get `rfcxml-prefetch` automatically. Also exposed as `npm run prefetch`.

### Added — Phase 2: API metadata wiring

`fetchRFCMetadata` was previously dead code. Phase 2 wires it into `handleGetRFCStructure` so the metadata block returned by `get_rfc_structure` is now enriched with Datatracker-derived `category` / `stream` / `date` / `abstract`, and optionally `authors`.

- **`get_rfc_structure` tool input:**
  - New `includeAuthors?: boolean` (default false). When true, resolves authors via the documentauthor + person APIs.
- **`handleGetRFCStructure`:**
  - Now fetches RFC body and Datatracker metadata in parallel (`Promise.all`).
  - Merges: XML body wins for `title` / `docName` / `number`; API wins for everything else.
  - On API failure, falls back gracefully to the minimal metadata shape that `fetchRFCMetadata` already provides.

### Added — Phase 1: IETF Datatracker API coverage

Background: discussion #6 pointed out that IETF officially provides three retrieval layers (REST API / bulk download / rsync) but this MCP only exercised a thin slice of the API layer. Phase 1 thickens the API layer; bulk DL is now handled by the Phase 3 prefetch CLI; rsync remains intentionally out of scope.

- **`fetchReferences(rfcNumber)`** in `rfc-fetcher.ts`
  - Fetches the RFCs that this RFC references (normative + informative) via Datatracker `relateddocument?source__name=rfcN`.
  - Sister of the existing `fetchReferencedBy`. Filters out BCP/STD aliases — only real RFC targets are returned.
  - Why: gives `get_rfc_dependencies` a structured fallback for old RFCs (< 8650) where no XML body exists. Previously these returned empty references with a "not available" note.
- **`fetchAuthors(rfcNumber)`** in `rfc-fetcher.ts`
  - Resolves authors via `documentauthor` API and joins to the `person` endpoint for fullnames.
  - Per-process `personCache` (LRU 500) so the same author across multiple RFCs is fetched once.
- **`fetchDocEvents(rfcNumber, limit?)`** in `rfc-fetcher.ts`
  - Fetches recent document events (publication, sync, errata-tagging, etc.) via `docevent` API.
- **`fetchRFCMetadata` options:**
  - New `includeAuthors` flag — when true, fetches the documentauthor list in parallel with the document core call. Default false to keep the base call cheap.
- **New `DATATRACKER_API` endpoints in `config.ts`:**
  - `documentAuthor`, `docEvent`, `references` (sister of `referencedBy`).

### Changed

- **`get_rfc_dependencies` result shape:**
  - Added `_referencesSource: 'xml' | 'api'`.
  - When XML provides references, `_referencesSource = 'xml'` (unchanged behavior).
  - When XML body is text-only **or** XML extraction yielded no references, the handler now falls back to `fetchReferences` and returns API-derived entries with `_referencesSource = 'api'`.
  - The "References not available" warning is replaced with a more accurate note when API fallback is used.
- **Pruned deprecated XML/text source URLs** in `RFC_XML_SOURCES` / `RFC_TEXT_SOURCES`:
  - Removed `xml2rfc.ietf.org/public/rfc/...` (storage was consolidated into RFC Editor).
  - Removed `tools.ietf.org/rfc/rfcN.txt` (retired in 2021, only 301-redirects to rfc-editor.org).
  - Net effect: the parallel race no longer duplicates requests against the same backend.

### Fixed

- **`mapCategory` / `mapStream` URI normalization in `rfc-fetcher.ts`:**
  - Datatracker returns `std_level` and `stream` as URIs (e.g., `/api/v1/name/stdlevelname/std/`). The previous string-comparison logic silently fell through to `'info'` / `'IETF'` for **every RFC**. Now a trailing-slug extractor handles both URI form and the legacy human-readable form.

## [0.5.0] - 2026-04-23

### Added

- **`includeReferencedBy` implementation** in `get_rfc_dependencies`
  - Fetches RFCs that reference the given RFC via IETF Datatracker `RelatedDocument` API
  - Filters to published RFCs only (excludes drafts)
  - Returns normative (`refnorm`) and informative (`refinfo`) relationship types
  - New `fetchReferencedBy()` function in `rfc-fetcher.ts`
  - New `ReferencedByEntry` type in `types/index.ts`
  - New `DATATRACKER_API.referencedBy` endpoint in `config.ts`
  - Graceful fallback: returns empty array on API failure

### Changed

- **`@modelcontextprotocol/sdk` updated**: 1.26.0 → 1.29.0
- **Test scripts reorganized** in `package.json`
  - `npm test` now runs single-pass (`vitest --run`) instead of watch mode
  - Added `npm run test:watch` for development watch mode
  - Added `npm run test:coverage` for coverage reporting
- **CI improvements** (`.github/workflows/ci.yml`)
  - Added Node.js 20 + 22 matrix for test and build jobs
  - Lint runs on Node.js 22 only
- **Trusted Publisher support** (`.github/workflows/publish.yml`)
  - Added `permissions.id-token: write` for OIDC-based npm provenance
  - Added `environment: npm` for GitHub Environment protection
  - Added `--provenance` flag to `npm publish`
  - Added Node.js 20 + 22 matrix for test job
  - Consolidated redundant build job into publish job

## [0.4.7] - 2026-04-15

### Documentation

- **README.md / README.ja.md**: Corrected Claude Code MCP configuration paths
  - Removed incorrect `.claude/settings.json` and `claude settings` references
  - Added correct locations: `.mcp.json` (project scope), `~/.claude.json` (user scope), and `claude mcp add` CLI command
- **README.md / README.ja.md**: Split bash and JSON code blocks in the global install example for cleaner copy-paste
- **README.md**: Synchronized `_sourceNote` sample string with the actual implementation (`Warning: Parsed from text format. Accuracy may be limited.`)
- **README.md / README.ja.md**: Updated `src/` directory tree to include `rfc-service.ts`, `logger.ts`, `statement-matcher.ts`, and `requirement-extractor.ts`
- **README.md / README.ja.md**: Clarified test commands — distinguished watch mode (`npm test`) from single-run (`npm test -- --run`) and added `npm run test:e2e`
- **CLAUDE.md**: Slimmed down from ~490 lines to 275 lines by extracting cross-MCP common patterns to a dedicated skill and removing duplicated history already tracked in CHANGELOG

### Internal

- Added `.claude/` to `.gitignore` (Claude Code local settings are user-specific)

No code changes in this release — source artifacts identical to 0.4.6.

## [0.4.6] - 2026-02-16

### Changed

- Version bump to 0.4.6

## [0.4.5] - 2026-02-05

### Fixed

- **Critical: `<bcp14>` tag processing bug** in `get_requirements` and `generate_checklist`
  - BCP 14 keywords (MUST, SHOULD, MAY, etc.) wrapped in `<bcp14>` tags were being dropped from extracted text
  - Example: "A TCP implementation `<bcp14>`MUST`</bcp14>` support..." was extracted as "A TCP implementation support..."
  - Added `normalizeBcp14Tags()` preprocessing step to convert `<bcp14>MUST</bcp14>` to `MUST` before XML parsing
  - Keywords now appear in correct position within extracted requirement text

- **Critical: `validate_statement` semantic verification** - conflict detection now works
  - Previously returned `isValid: true` even for obvious RFC violations
  - Added semantic negation pattern detection (mask/unmasked, encrypt/unencrypted, validate/skip validation)
  - New helper functions: `hasPositiveAction()`, `hasNegativeAction()`, `actionsContradict()`
  - Example: "client sends unmasked frames" now correctly conflicts with "client MUST mask"
  - Example: "server masks frames" now correctly conflicts with "server MUST NOT mask"
  - Fixed false positive detection for incidental verb mentions (e.g., "sends" in "MUST NOT mask...sends")

### Added

- **New tests**: 24 additional tests
  - 3 tests for `<bcp14>` tag normalization in `rfcxml-parser.test.ts`
  - 8 tests for semantic conflict detection in `statement-matcher.test.ts`
  - 3 tests for `<xref>` extraction in `rfcxml-parser.test.ts`
  - 10 tests for requirement filtering in `requirement-extractor.test.ts`
  - Total test count: 150 tests (up from 126)

### Changed

- **Negation pattern expansion**: Added more negative patterns for better detection
  - `validate`: added "skips validation", "no validation"
  - `encrypt`: added "without encryption"
  - `authenticate`: added "skip authentication"
  - `mask`: added "without masking"

- **`get_related_sections` now returns cross-references**
  - Added `<xref>` tag extraction from RFCXML
  - Extracts both section references (`<xref target="section-3.5"/>`) and RFC references (`<xref target="RFC2119"/>`)
  - Combined with existing text pattern detection ("Section X.Y")

- **`generate_checklist` improvements**
  - Now supports multiple sections in `sections` array (previously only first was used)
  - Added `includeSubsections` option (default: true) to include subsections when filtering
  - Section filter now supports both formats: `section-3.5` (XML) and `3.5` (plain)

- **Text fallback improvements**
  - Added RFC reference extraction from text (detected as informative references)
  - Improved section header detection heuristics to reduce false positives
  - Status codes (1000, 1001) and numbered list items no longer detected as sections
  - Validates section titles against common RFC section keywords

- **Section number format normalization**
  - `get_requirements` now accepts both `section-3.5` and `3.5` formats
  - Automatic `section-` prefix stripping for consistent filtering

## [0.4.4] - 2026-02-05

### Added

- **Weighted matching for `validate_statement`**: Improved matching accuracy
  - New `src/utils/statement-matcher.ts` module with keyword weighting system
  - Technical terms (client, server, etc.) get higher weight than regular words
  - Subject detection (client/server/sender/receiver) with match bonus
  - Requirement level detection and conflict detection
  - `MATCHING_WEIGHTS` and `MATCHING_LIMITS` constants for tuning

- **Test coverage expansion**: 75 new tests
  - `src/utils/cache.test.ts` - 16 tests for LRUCache
  - `src/utils/validation.test.ts` - 30 tests for RFC number validation
  - `src/utils/statement-matcher.test.ts` - 29 tests for weighted matching
  - Total test count: 126 tests (up from 51)

### Changed

- **`_sourceNote` pattern simplification**: Reduced code duplication
  - New `getSourceNoteIfText()` helper in `rfc-service.ts`
  - 7 repetitive patterns in `handlers.ts` consolidated to single function call

- **TypeScript type safety improvements**: Eliminated `any` type warnings
  - Added `XmlNode` type alias and `RfcXml` interface in `rfcxml-parser.ts`
  - Reduced eslint-disable comments to minimum required (2 necessary cases)

- **Constants extraction**: Magic numbers replaced with named constants
  - `METADATA_EXTRACTION` and `DEFINITION_EXTRACTION` in `rfc-text-parser.ts`
  - `MATCHING_WEIGHTS` and `MATCHING_LIMITS` in `statement-matcher.ts`

### Fixed

- **Error logging in `fetchRFCMetadata`**: Added `logger.warn` call in catch block
  - Previously failed silently, now logs warning with error details

## [0.4.3] - 2026-02-03

### Changed

- **Service layer refactoring**: Improved separation of concerns
  - Extracted RFC parsing logic to `src/services/rfc-service.ts`
  - `getParsedRFC()`, `clearParseCache()`, and `getTextSourceNote()` moved from handlers
  - Handlers now only handle request/response transformation

- **Logger abstraction**: Centralized logging for future extensibility
  - New `src/utils/logger.ts` module
  - Replaced direct `console.error` calls with `logger.info/warn/error`
  - Supports DEBUG environment variable for verbose output

- **Constants consolidation**: Magic numbers extracted to named constants
  - Added `RFC_NUMBER_LIMITS.MIN/MAX` to `src/constants.ts`
  - Updated `validation.ts` to use centralized limits

### Added

- **Test coverage reporting**: Added `@vitest/coverage-v8` dependency
  - Run `npm test -- --coverage` to generate coverage report
  - Current coverage: 64.74% overall, 97%+ on core handlers

### Internal

- `ParsedRFCWithSource` and `SourceNoteContext` types exported from `rfc-service.ts`
- `getParseCacheSize()` function for monitoring cache state

## [0.4.2] - 2026-02-03

### Fixed

- **Version re-release**: v0.4.1 was published before main branch CI completed. This release is functionally identical to v0.4.1.

## [0.4.1] - 2026-02-03

### Changed

- **Code refactoring**: Improved code organization and maintainability
  - Extracted shared requirement extraction logic to `src/utils/requirement-extractor.ts`
  - Extracted checklist generation to `src/services/checklist-generator.ts`
  - Extracted section utilities to `src/utils/section.ts`
  - Reduced `handlers.ts` from 510 lines to ~400 lines (~22% reduction)

### Added

- **New utility modules**:
  - `src/utils/requirement-extractor.ts` - Shared requirement extraction for XML/text parsers
  - `src/utils/section.ts` - Section search and cross-reference collection utilities
  - `src/services/checklist-generator.ts` - Dedicated checklist generation service

### Performance

- **List extraction optimization**: Fixed duplicate `extractText()` calls in `rfcxml-parser.ts`
  - List item content is now extracted once and reused for requirement marker extraction

### Internal

- Centralized `ParsedRFC` interface in `types/index.ts`
- Extracted `SECTION_HEADER_PATTERN` to `constants.ts`
- Both XML and text parsers now use shared `extractRequirementsFromSections()` function

## [0.4.0] - 2026-02-01

### Changed

- **Internationalization (i18n)**: All user-facing messages are now in English
  - Tool descriptions in `definitions.ts` (23 locations)
  - `_sourceNote` warnings and error messages in `handlers.ts`
  - Generated checklist output (Markdown headers and labels)
  - RFCXMLNotAvailableError messages in `rfc-fetcher.ts`
  - Resource descriptions in `index.ts`

### Fixed

- **Version synchronization bug**: Server now dynamically reads version from `package.json`
  - Previously hardcoded `0.1.0` in `index.ts` and `0.1.2` in `config.ts`
  - Now uses `createRequire` to load version at runtime

- **REQUIREMENT_REGEX lastIndex issue**: Added `createRequirementRegex()` factory function
  - Global regex with `/g` flag can cause issues when reused in exec() loops
  - Factory function creates fresh regex instance for each use

- **fetchRFCMetadata timeout**: Added 30-second timeout using AbortController
  - Previously had no timeout, could hang indefinitely

### Added

- **RFC number validation**: All tool handlers now validate RFC number input
  - New `src/utils/validation.ts` module
  - Validates positive integer between 1 and 99999

- **Type safety improvements** in `handlers.ts`
  - Added `SimplifiedSection` interface
  - Added `DependencyResult` interface
  - Re-exported `Section` type from `rfcxml-parser.ts`

- **Helper function for source notes**: `getTextSourceNote()` consolidates 7 duplicate patterns

## [0.3.0] - 2026-01-24

### Added

- **GitHub Actions CI/CD**
  - `ci.yml` - Automated lint, test, and build on push/PR to main
  - `publish.yml` - Automated npm publish on version tags (v*)
  - Version verification ensures package.json matches git tag

- **README badges** (shields.io)
  - npm version, CI status, License, Node.js version, Claude Code compatible

### Changed

- **Code refactoring**: Switch statement replaced with Map-based lookup
  - `src/tools/handlers.ts` - Added `toolHandlers` export for cleaner dispatch
  - `src/index.ts` - Simplified tool handler dispatch (60 lines → 18 lines)

### Performance

- **`extractText` optimization** in `src/services/rfcxml-parser.ts`
  - Reduced string concatenation by using array accumulator
  - Improved performance for large RFC documents

## [0.2.0] - 2026-01-19

### Changed

#### Architecture Refactoring

- **Duplicate code reduction**: Extracted shared code into reusable modules
  - `src/constants.ts` - BCP 14 / RFC 2119 keywords (MUST/SHOULD/MAY)
  - `src/utils/text.ts` - Text utilities (`extractSentence`, `extractCrossReferences`, `toArray`)

- **LRU cache implementation**: Replaced simple Map-based cache with size-limited LRU cache
  - `src/utils/cache.ts` - Generic LRU cache with configurable max size
  - XML cache: 20 entries, Text cache: 20 entries, Metadata: 100 entries, Parsed: 50 entries

- **Configuration externalization**: Centralized all settings in a single module
  - `src/config.ts` - HTTP settings, cache settings, RFC sources, API endpoints

- **Parallel fetch with AbortController**: Improved RFC fetch performance
  - `src/utils/fetch.ts` - Parallel fetch from multiple sources (RFC Editor, IETF Tools, Datatracker)
  - Uses `Promise.any` to return first successful response
  - Automatically cancels pending requests after first success
  - Includes timeout handling per request

### Performance

- RFC fetch latency reduced by fetching from 3 sources in parallel
- Memory usage bounded by LRU cache eviction

## [0.1.2] - 2026-01-18

### Added

- `README.ja.md` - Japanese documentation
- Output samples in documentation (both EN/JA)
- ESLint configuration (`eslint.config.js`)
- Prettier configuration (`.prettierrc`)
- Vitest test suite (51 tests)

### Changed

- `README.md` translated to English

## [0.1.1] - 2026-01-18

### Added

- `CHANGELOG.md` for version tracking

### Fixed

- `get_related_sections` - Section number normalization (`section-3.5` vs `3.5`)
- `get_rfc_dependencies` - Nested XML references structure handling

### Changed

- All responses now include `_source` field (`xml` | `text`)
- Text fallback responses include `_sourceNote` warning

## [0.1.0] - 2026-01-18

### Added

- Initial release
- `get_rfc_structure` - Section hierarchy and metadata
- `get_requirements` - Normative requirements extraction (MUST/SHOULD/MAY)
- `get_definitions` - Term definitions
- `get_rfc_dependencies` - RFC references (normative/informative)
- `get_related_sections` - Related sections within RFC
- `generate_checklist` - Implementation checklist generation
- `validate_statement` - Statement validation against RFC
- Automatic text fallback for RFCs before 8650
