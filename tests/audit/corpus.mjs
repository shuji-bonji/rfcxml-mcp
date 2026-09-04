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
    { rfc: 9562, note: 'UUID。表と ABNF が多い' },
    { rfc: 9421, note: 'HTTP メッセージ署名。sourcecode の例が多い' },
    { rfc: 9250, note: 'DNS over QUIC' },
    { rfc: 9700, note: 'OAuth 2.0 のセキュリティ BCP。要件が箇条書きで並ぶ' },
    { rfc: 9651, note: '構造化フィールド値。ABNF と擬似コードが多い' },
    { rfc: 9530, note: 'Digest フィールド' },
    { rfc: 9298, note: 'HTTP 上の UDP プロキシ' },
    { rfc: 9369, note: 'QUIC v2' },
    { rfc: 9460, note: 'SVCB / HTTPS レコード' },
    { rfc: 9449, note: 'DPoP' },
    { rfc: 9420, note: 'MLS。非常に長い' },
    { rfc: 9260, note: 'SCTP の改訂版' },
    { rfc: 9535, note: 'JSONPath。文法と例が多い' },
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
    { rfc: 8259, note: 'JSON。短く、要件が少ない' },
    { rfc: 8174, note: 'BCP 14 の改訂。本文がキーワードそのものの話' },
    { rfc: 8200, note: 'IPv6。ビット図が多い' },
    { rfc: 7252, note: 'CoAP。ビット図と表が多い' },
    { rfc: 8555, note: 'ACME。JSON の例を本文に挟む' },
    { rfc: 6376, note: 'DKIM。ABNF とタグの一覧' },
    { rfc: 7950, note: 'YANG 1.1。文法の定義が本文の大半を占める' },
    { rfc: 6120, note: 'XMPP。XML の例を本文に挟む' },
    { rfc: 5545, note: 'iCalendar。2445 の後継。表と定義が多い' },
    { rfc: 8017, note: 'PKCS #1。数式が多い' },
    { rfc: 5905, note: 'NTPv4。C のコードを本文に載せる' },
    { rfc: 8441, note: 'HTTP/2 上の WebSocket。短い' },
    { rfc: 7541, note: 'HPACK。ハフマン表が長い' },
    { rfc: 7636, note: 'PKCE。短く要件が密' },
    { rfc: 6698, note: 'DANE' },
    { rfc: 8032, note: 'EdDSA。数式とテストベクタ' },
    { rfc: 6570, note: 'URI テンプレート。例の表が非常に多い' },
    { rfc: 6347, note: 'DTLS 1.2' },
    { rfc: 8415, note: 'DHCPv6。3315 の後継で長い' },
    { rfc: 8628, note: 'OAuth デバイスフロー。短い' },
    { rfc: 7515, note: 'JWS。JOSE 系の中核' },
    { rfc: 7517, note: 'JWK' },
    { rfc: 6298, note: 'TCP の再送タイマ。数式が中心' },
    { rfc: 7049, note: 'CBOR。本文に `-1 - n` の減算の式がある' },
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
    { rfc: 5234, note: 'ABNF の定義そのもの' },
    { rfc: 3629, note: 'UTF-8。表が中心' },
    { rfc: 4120, note: 'Kerberos。ASN.1 が長い' },
    { rfc: 4960, note: 'SCTP。ビット図が非常に多い' },
    { rfc: 4880, note: 'OpenPGP。パケット形式の表が多い' },
    { rfc: 4287, note: 'Atom。RELAX NG のスキーマを本文に載せる' },
    { rfc: 3164, note: 'syslog。BSD 実装の記述' },
    { rfc: 5661, note: 'NFSv4.1。600 ページ超' },
    { rfc: 2865, note: 'RADIUS。属性の表が多い' },
    { rfc: 6960, note: 'OCSP。ASN.1' },
    { rfc: 5730, note: 'EPP。XML スキーマを本文に載せる' },
    { rfc: 4291, note: 'IPv6 アドレス体系' },
    { rfc: 4949, note: 'セキュリティ用語集。定義だけで数千件' },
    { rfc: 4566, note: 'SDP。ABNF が中心' },
    { rfc: 3315, note: 'DHCPv6。長い' },
    { rfc: 5681, note: 'TCP 輻輳制御。数式が多い' },
    { rfc: 4034, note: 'DNSSEC のレコード。ワイヤ形式の図' },
    { rfc: 3711, note: 'SRTP' },
    { rfc: 5751, note: 'S/MIME 3.2' },
    { rfc: 3411, note: 'SNMP のアーキテクチャ。MIB を本文に載せる' },
    { rfc: 2474, note: 'DiffServ' },
    { rfc: 4585, note: 'RTP/AVPF' },
    { rfc: 5755, note: '属性証明書。ASN.1' },
    { rfc: 3412, note: 'SNMP のメッセージ処理' },
    { rfc: 4648, note: 'Base16 / 32 / 64。表が中心' },
    { rfc: 3492, note: 'Punycode。C のコードが本文の大半' },
    { rfc: 4193, note: 'ユニークローカルアドレス' },
    { rfc: 3168, note: 'ECN' },
    { rfc: 3022, note: 'NAT' },
    { rfc: 3376, note: 'IGMPv3' },
    { rfc: 3810, note: 'MLDv2' },
  ].map((entry) => ({ ...entry, kind: 'text' })),

  '1990s-late-text': [
    { rfc: 2045 },
    { rfc: 2131, note: '空白で桁を揃えた表がある' },
    { rfc: 2616, note: '参考文献の欄が 1 つしかない' },
    { rfc: 2068, note: '警告コードの表に "99 Miscellaneous warning" がある' },
    { rfc: 2822, note: '参考文献の欄の見出しが Bibliography' },
    { rfc: 1918, note: 'プライベートアドレス。短い BCP' },
    { rfc: 2046, note: 'MIME Part Two' },
    { rfc: 1889, note: 'RTP の初版。1996 年' },
    { rfc: 2445, note: '題名が小文字で始まる節 (iCalendar Object Specification)' },
    { rfc: 2205, note: 'RSVP。1997 年' },
    { rfc: 2401, note: 'IPsec のアーキテクチャ。1998 年' },
    { rfc: 2119, note: 'BCP 14 の定義そのもの。本文がキーワードの話' },
    { rfc: 1939, note: 'POP3。応答例が多い' },
    { rfc: 1812, note: 'ルータ要件。要件だけで構成された長大な文書' },
    { rfc: 2578, note: 'SMIv2。ASN.1 マクロが多い' },
    { rfc: 2328, note: 'OSPFv2。状態遷移と付録のデータ構造' },
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
    { rfc: 1191, note: 'Path MTU Discovery' },
    { rfc: 1323, note: 'TCP の高速通信向け拡張' },
    { rfc: 1583, note: 'OSPFv2 の初版。2328 の前身' },
    { rfc: 1994, note: 'CHAP。1996 年' },
    { rfc: 1661, note: 'PPP。1994 年。状態遷移が中心' },
    { rfc: 1771, note: 'BGP-4。1995 年' },
    { rfc: 1350, note: 'TFTP' },
  ].map((entry) => ({ ...entry, kind: 'text' })),

  '1960s-70s-text': [
    { rfc: 20, note: 'ASCII。1969 年。表が中心' },
    { rfc: 1, note: '最初の RFC。1969 年。手書き風の体裁' },
    { rfc: 733, note: 'メールの書式。1977 年' },
    { rfc: 741, note: 'NVP。1977 年' },
    { rfc: 706, note: 'ホストの死活。1975 年' },
    { rfc: 675, note: 'TCP の初期版。1974 年' },
  ].map((entry) => ({ ...entry, kind: 'text' })),

  '1980s-text': [
    { rfc: 768 },
    { rfc: 791 },
    { rfc: 793, note: '上位の節見出しを中央に寄せる' },
    { rfc: 792, note: '節に番号が無い。ページ見出しが "RFC 792" の 1 行' },
    { rfc: 854, note: '節に番号が無い。見出しは全部大文字' },
    { rfc: 894, note: '節に番号が無い。見出しは Title Case' },
    { rfc: 951, note: 'BOOTP。1985 年' },
    { rfc: 903, note: 'RARP。1984 年。短い' },
    { rfc: 862, note: '節が 2 つしかない' },
    { rfc: 822, note: 'メールの書式。1982 年。ABNF の原型' },
    { rfc: 1057, note: 'RPC。1988 年。XDR の定義が多い' },
    { rfc: 1011, note: '公式プロトコル一覧。1987 年。表が中心' },
    { rfc: 1042, note: 'IEEE 802 上の IP。1988 年' },
    { rfc: 950, note: 'サブネット。1985 年' },
    { rfc: 917, note: 'サブネットの考え方。1984 年' },
    { rfc: 765, note: 'FTP。1980 年' },
    { rfc: 856, note: 'TELNET バイナリ転送。1983 年。非常に短い' },
    { rfc: 855, note: '上位の見出しを字下げし、途中から 1 桁目に戻る' },
    { rfc: 826, note: 'ARP。擬似コードが本文の中心' },
    { rfc: 896, note: '見出しが 1 つも無い。本文の折り返しを節にしていた' },
    { rfc: 959, note: 'FTP。長く、見出しの体裁が場所で変わる' },
    { rfc: 821, note: 'SMTP。状態遷移図が多い' },
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
