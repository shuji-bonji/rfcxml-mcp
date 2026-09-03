/**
 * 監査に使う RFC の一覧。
 *
 * 世代ごとに分けてある。v0.6.9 以降で見つかった不具合は、ほぼすべて
 * 「その世代の書式でだけ破れる」ものだった。世代を 1 つ落とすと、その書式の
 * 破れが見えなくなる。
 *
 * | 世代 | 書式の特徴 | ここで見つかったもの |
 * |---|---|---|
 * | 2020 年代（XML） | RFCXML v3、`pn` で並び順が判る | iref 由来の定義、文 + 箇条書き |
 * | 2010 年代（テキスト） | 本文は 3 桁目から、節見出しは 1 桁目 | ページの区切り、節見出しの取りこぼし |
 * | 1990 年代後半 | BCP 14 が定着、表が多い | 空白で桁を揃えた表 |
 * | 1990 年代前半 | 節見出しを字下げ、参考文献の書式が違う | 字下げ見出し、`RFC-817` の書き方 |
 * | 1980 年代 | 本文も 1 桁目から、見出しは中央寄せ、番号が無いものもある | 折り返した本文が節になる、節が 1 つも取れない |
 *
 * `kind` は取得元。`xml` は RFCXML が公開されているもの（RFC 8650 以降）。
 */

/** @typedef {{ rfc: number, kind: 'xml' | 'text', note?: string }} CorpusEntry */

/** @type {Record<string, CorpusEntry[]>} */
export const CORPUS_BY_GENERATION = {
  '2020s-xml': [
    { rfc: 9110, note: 'HTTP Semantics。iref で用語を定義する' },
    { rfc: 9111 },
    { rfc: 9112 },
    { rfc: 9113 },
    { rfc: 9114, note: 'dl で用語を定義する' },
    { rfc: 9204 },
    { rfc: 9205 },
    { rfc: 9209 },
    { rfc: 9218 },
    { rfc: 9293, note: '要求 ID ラベル (MUST-14) を使う' },
    { rfc: 9440 },
    { rfc: 9457 },
    { rfc: 9051, note: '定義が 350 件を超える' },
    { rfc: 9053 },
    { rfc: 9000 },
    { rfc: 8878, note: 'BCP 14 キーワードを 1 つも使わない' },
    { rfc: 8949 },
    { rfc: 9147, note: '表示の約束ごとを dl で書き、記号を項目にする' },
    { rfc: 9180, note: '参照の title が読点で終わる' },
  ].map((entry) => ({ ...entry, kind: 'xml' })),

  '2010s-text': [
    { rfc: 6455, note: 'ABNF の注釈に要件を書く' },
    { rfc: 6265 },
    { rfc: 6749 },
    { rfc: 6797, note: '節の題名が 2 行に折り返す (§11.3 §11.4.1 §14.3)' },
    { rfc: 7519, note: '本文が "Appendix A.2 of [JWE]" と参照する' },
    { rfc: 7230, note: '題名が 2 文字の節 (TE) がある' },
    { rfc: 7231 },
    { rfc: 7540 },
    { rfc: 8446, note: '題名が数字で始まる節 (0-RTT) がある' },
    { rfc: 7159, note: '参照が "Errata ID 3607, RFC 3607" と本文に番号を書く' },
    { rfc: 7489, note: '題名が行幅いっぱいで 1 桁目から始まる' },
  ].map((entry) => ({ ...entry, kind: 'text' })),

  '2000s-text': [
    { rfc: 2818 },
    { rfc: 3261, note: '表示例を交互に並べる' },
    { rfc: 3550, note: '擬似コードの中に要件がある' },
    { rfc: 3986, note: 'BCP 14 キーワードを大文字で使わない' },
    { rfc: 4271 },
    { rfc: 5246 },
    { rfc: 5321, note: 'ABNF の注釈に要件がある' },
    { rfc: 5322, note: '罫線の表がある' },
    { rfc: 6066 },
    { rfc: 5652, note: '引用符を付けずに BCP 14 の定型文を書く' },
    { rfc: 4253, note: '同上' },
    { rfc: 5280, note: 'ASN.1 の型定義が多い。切れ端が要件になっていた' },
  ].map((entry) => ({ ...entry, kind: 'text' })),

  '1990s-late-text': [
    { rfc: 2045 },
    { rfc: 2131, note: '空白で桁を揃えた表がある' },
    { rfc: 2616, note: '参考文献の欄が 1 つしかない' },
    { rfc: 2068, note: '警告コードの表に "99 Miscellaneous warning" がある' },
    { rfc: 2445, note: '題名が小文字で始まる節 (iCalendar Object Specification)' },
  ].map((entry) => ({ ...entry, kind: 'text' })),

  '1990s-early-text': [
    { rfc: 1034 },
    { rfc: 1035, note: '見出しと本文が 1 行に入る' },
    { rfc: 1058 },
    { rfc: 1122, note: '節見出しを深さに応じて字下げする' },
    { rfc: 1123 },
    { rfc: 1157 },
    { rfc: 1305 },
    { rfc: 1521 },
    { rfc: 1738 },
    { rfc: 1866, note: 'SGML の DTD の中に要件がある' },
  ].map((entry) => ({ ...entry, kind: 'text' })),

  '1980s-text': [
    { rfc: 768 },
    { rfc: 791 },
    { rfc: 793, note: '上位の節見出しを中央に寄せる' },
    { rfc: 792, note: '節に番号が無い。ページ見出しが "RFC 792" の 1 行' },
    { rfc: 854, note: '節に番号が無い。見出しは全部大文字' },
    { rfc: 894, note: '節に番号が無い。見出しは Title Case' },
    { rfc: 862, note: '節が 2 つしかない' },
    { rfc: 855, note: '上位の見出しを字下げし、途中から 1 桁目に戻る' },
    { rfc: 896, note: '見出しが 1 つも無い。本文の折り返しを節にしていた' },
  ].map((entry) => ({ ...entry, kind: 'text' })),
};

/** @type {CorpusEntry[]} */
export const CORPUS = Object.values(CORPUS_BY_GENERATION).flat();

/** 世代の名前から、その世代の RFC を引く。 */
export function generationOf(rfc) {
  for (const [generation, entries] of Object.entries(CORPUS_BY_GENERATION)) {
    if (entries.some((entry) => entry.rfc === rfc)) return generation;
  }
  return 'unknown';
}
