# rfcxml-mcp

A Model Context Protocol (MCP) server for **structured understanding** of RFC documents.

- npm: [`@shuji-bonji/rfcxml-mcp`](https://www.npmjs.com/package/@shuji-bonji/rfcxml-mcp)
- Source: [shuji-bonji/rfcxml-mcp](https://github.com/shuji-bonji/rfcxml-mcp) · [CHANGELOG](https://github.com/shuji-bonji/rfcxml-mcp/blob/main/CHANGELOG.md)
- Node.js 22 or later

## What it is, and what it is not

This server is a structured **reader** of published RFCs. It does not return the RFC text as a whole. It reads the RFCXML semantic structure and returns:

- section hierarchy and metadata
- normative requirements (MUST / SHOULD / MAY) in structured form
- term definitions
- reference relationships (normative / informative)
- related sections
- implementation checklists
- the requirements that bear on a statement, with detected contradictions

It is **not** a conformance judge and not a web search. `validate_statement` returns matched requirements; the verdict is yours (see [Accuracy and limits](/guide/accuracy)). Only published RFCs are reachable; Internet-Drafts and arbitrary URLs are not. Sources are fixed to rfc-editor.org and the IETF Datatracker API.

RFCs published after RFC 8650 (December 2019) are available in official RFCXML v3. Earlier RFCs usually have no XML; the server then parses the text format instead, and every response carries `_source` (`xml` or `text`) and, where relevant, `_sourceNote`.

| `_source` | Description                        |
| --------- | ---------------------------------- |
| `xml`     | Parsed from RFCXML (high accuracy) |
| `text`    | Parsed from text (medium accuracy) |

## Tools

| Tool                                                      | Description                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [`get_rfc_structure`](/reference/tools#get-rfc-structure)   | Get RFC section hierarchy and metadata. Metadata is enriched from the IETF Datatracker API.                         |
| [`get_requirements`](/reference/tools#get-requirements)     | Extract normative requirements (MUST/SHOULD/MAY) from RFC in structured format.                                     |
| [`get_definitions`](/reference/tools#get-definitions)       | Get term definitions from RFC.                                                                                      |
| [`get_rfc_dependencies`](/reference/tools#get-rfc-dependencies) | Get RFC reference relationships (normative/informative).                                                        |
| [`get_related_sections`](/reference/tools#get-related-sections) | Get sections related to the specified section.                                                                  |
| [`generate_checklist`](/reference/tools#generate-checklist) | Generate RFC implementation checklist in Markdown format.                                                           |
| [`validate_statement`](/reference/tools#validate-statement) | Find the RFC requirements that bear on a statement, and report detected contradictions. This does NOT decide conformance. |

Full parameter tables: [Tools](/reference/tools). Recorded outputs: [Output examples](/reference/examples). The text the server hands to the client: [Server instructions](/reference/instructions).

## Comparison with existing MCPs

| Feature                         | Existing mcp-rfc | RFCXML MCP           |
| ------------------------------- | ---------------- | -------------------- |
| RFC text retrieval              | ✅               | ✅                   |
| Section extraction              | ✅ (text-based)  | ✅ (structure-based) |
| MUST/SHOULD/MAY extraction      | ❌               | ✅                   |
| Condition/exception structuring | ❌               | ✅                   |
| RFC dependency graph            | ❌               | ✅                   |
| Definition scope management     | ❌               | ✅                   |
| Implementation checklist        | ❌               | ✅                   |

## Next

- [Install](/guide/install) — Claude Desktop, Claude Code, version pinning, disk cache
- [Accuracy and limits](/guide/accuracy) — what the text fallback loses, what `isValid` means, what is checked before a release
