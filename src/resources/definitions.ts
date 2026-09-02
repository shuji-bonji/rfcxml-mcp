/**
 * MCP Resource Definitions
 *
 * `rfcxml://schema` は RFCXML v3 の語彙情報を返す静的リソース。
 * 内容が定数であるため、サーバ組み立て (`server.ts`) からは切り離してここに置く。
 */

/** リソース URI */
export const RFCXML_SCHEMA_URI = 'rfcxml://schema';

/** `resources/list` に出す表示情報 */
export const RFCXML_SCHEMA_METADATA = {
  name: 'RFCXML Schema Information',
  description: 'RFCXML v3 structure and schema information',
  mimeType: 'application/json',
} as const;

/** `resources/read` が返す本体 */
export const RFCXML_SCHEMA_PAYLOAD = {
  version: 'v3',
  spec: 'RFC 7991 (superseded by rfc7991bis)',
  documentation: 'https://authors.ietf.org/rfcxml-vocabulary',
  keyElements: {
    bcp14: 'Markup for RFC 2119 keywords (MUST, SHOULD, MAY, etc.)',
    xref: 'Internal and external references',
    reference: 'Bibliography references',
    section: 'Section structure',
    t: 'Text paragraph',
    dl: 'Definition list',
    sourcecode: 'Source code',
  },
} as const;
