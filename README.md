# RFCXML MCP Server

[![npm version](https://img.shields.io/npm/v/@shuji-bonji/rfcxml-mcp.svg)](https://www.npmjs.com/package/@shuji-bonji/rfcxml-mcp)
[![CI](https://img.shields.io/github/actions/workflow/status/shuji-bonji/rfcxml-mcp/ci.yml?branch=main&label=CI)](https://github.com/shuji-bonji/rfcxml-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-blueviolet)](https://claude.ai/code)

[日本語版 README](README.ja.md)

A Model Context Protocol (MCP) server for **structured understanding** of RFC documents.

## Purpose

Unlike existing text-based RFC MCP servers, this server leverages the semantic structure of RFCXML to enable:

- **Normative requirements extraction** (MUST/SHOULD/MAY) with structured output
- **RFC dependency graph** construction
- **Definition scope management**
- **Implementation checklist generation**

## Architecture

```
┌─────────────────────────┐
│  Markdown / PDF         │  Display & Sharing
├─────────────────────────┤
│  Translation            │  Explanation & Verification
├─────────────────────────┤
│  RFCXML MCP             │  Common Understanding for AI & Humans
├─────────────────────────┤
│  RFCXML                 │  Single Source of Truth
└─────────────────────────┘
```

## Comparison with Existing MCPs

| Feature                         | Existing mcp-rfc | RFCXML MCP           |
| ------------------------------- | ---------------- | -------------------- |
| RFC text retrieval              | ✅               | ✅                   |
| Section extraction              | ✅ (text-based)  | ✅ (structure-based) |
| MUST/SHOULD/MAY extraction      | ❌               | ✅                   |
| Condition/exception structuring | ❌               | ✅                   |
| RFC dependency graph            | ❌               | ✅                   |
| Definition scope management     | ❌               | ✅                   |
| Implementation checklist        | ❌               | ✅                   |

## Quick Start

### Using with Claude Desktop / Claude Code

Add the following to your MCP configuration file:

```json
{
  "mcpServers": {
    "rfcxml": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/rfcxml-mcp"]
    }
  }
}
```

To pin a version (0.6.x ships patch releases frequently), write the version into the package spec:

```json
{
  "mcpServers": {
    "rfcxml": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/rfcxml-mcp@0.6.53"]
    }
  }
}
```

To keep fetched RFCs on disk across restarts, pass `RFCXML_CACHE_DIR` (see [Disk cache and `rfcxml-prefetch`](#disk-cache-and-rfcxml-prefetch)):

```json
{
  "mcpServers": {
    "rfcxml": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/rfcxml-mcp@0.6.53"],
      "env": { "RFCXML_CACHE_DIR": "/home/you/.cache/rfcxml-mcp" }
    }
  }
}
```

Configuration file locations:

- **Claude Desktop (macOS)**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Windows)**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Claude Code (project scope)**: `.mcp.json` at the project root
- **Claude Code (user scope)**: `~/.claude.json`
- **Claude Code (CLI)**: `claude mcp add rfcxml -- npx -y @shuji-bonji/rfcxml-mcp`

### Installation (Optional)

For global installation:

```bash
npm install -g @shuji-bonji/rfcxml-mcp
```

Then configure MCP:

```json
{
  "mcpServers": {
    "rfcxml": {
      "command": "rfcxml-mcp"
    }
  }
}
```

## Available Tools

### Phase 1: Basic Structure

- `get_rfc_structure` - Get section hierarchy and metadata
- `get_requirements` - Extract normative requirements (MUST/SHOULD/MAY) with structure
- `get_definitions` - Get term definitions and their scope

### Phase 2: Relationships

- `get_rfc_dependencies` - Get referenced RFCs (normative/informative)
- `get_related_sections` - Get related sections within the same RFC

### Phase 3: Verification Support

- `validate_statement` - Find the RFC requirements that bear on a statement and report detected contradictions. This is **not** a conformance judgment: `isValid` is three-valued (`null` = nothing matched strongly enough to judge, `false` = a contradiction was detected, `true` = no contradiction was detected among the matches). The verdict is yours.
- `generate_checklist` - Generate implementation checklist

## Legacy RFC Support

RFCs published after RFC 8650 (December 2019) are available in official RFCXML v3 format. Earlier RFCs may not have XML available.

This server includes **automatic fallback** functionality - when XML is unavailable, it parses the text format instead.

### Source Information

All responses include source information:

```json
{
  "rfc": 6455,
  "sections": [...],
  "_source": "text",
  "_sourceNote": "Warning: Parsed from text format. Accuracy may be limited."
}
```

| `_source` | Description                        |
| --------- | ---------------------------------- |
| `xml`     | Parsed from RFCXML (high accuracy) |
| `text`    | Parsed from text (medium accuracy) |

### Compatibility

| RFC             | Format | Notes                      |
| --------------- | ------ | -------------------------- |
| RFC 8650+       | XML    | Official RFCXML v3 support |
| Before RFC 8650 | Text   | Automatic fallback         |

## Output Samples

Every sample below is trimmed from the actual output of the current build (`npm run build`, then the listed tool call through an MCP client). Field names and values are verbatim; long arrays are cut with `...`.

### `get_rfc_structure` - Get RFC Structure

`get_rfc_structure { "rfc": 9293 }`

```json
{
  "metadata": {
    "title": "Transmission Control Protocol (TCP)",
    "docName": "draft-ietf-tcpm-rfc793bis-28",
    "number": 9293,
    "date": "2022-08",
    "category": "std",
    "stream": "IETF",
    "abstract": "This document specifies the Transmission Control Protocol (TCP). ..."
  },
  "sections": [
    { "number": "1", "title": "Purpose and Scope" },
    { "number": "2", "title": "Introduction" },
    {
      "number": "3",
      "title": "Functional Specification",
      "subsections": [
        { "number": "3.1", "title": "Header Format" },
        {
          "number": "3.5",
          "title": "Establishing a Connection",
          "subsections": [
            { "number": "3.5.1", "title": "Half-Open Connections and Other Anomalies" },
            { "number": "3.5.2", "title": "Reset Generation" },
            { "number": "3.5.3", "title": "Reset Processing" }
          ]
        }
      ]
    }
  ],
  "referenceCount": { "normative": 15, "informative": 85 },
  "_source": "xml"
}
```

`number` is the section number as printed in the RFC (`3.5`, `A.2`), not the RFCXML `pn` (`section-3.5`). `category` / `stream` / `abstract` come from the IETF Datatracker API and are **omitted** when the API is unreachable or reports a value outside the mapping (e.g. RFC 1 is `unkn` / `legacy`); in that case `_sourceNote` says so.

### `get_requirements` - Extract Normative Requirements

`get_requirements { "rfc": 9293, "level": "MUST" }`

```json
{
  "rfc": 9293,
  "filter": { "section": "all", "level": "MUST" },
  "stats": { "total": 55, "byLevel": { "MUST": 55 } },
  "requirements": [
    {
      "id": "R-3.5-1",
      "level": "MUST",
      "text": "A TCP implementation MUST support simultaneous open attempts (MUST-10).",
      "section": "3.5",
      "sectionTitle": "Establishing a Connection",
      "fullContext": "A TCP implementation MUST support simultaneous open attempts (MUST-10).",
      "subject": "tcp implementation",
      "action": "support simultaneous open attempts (MUST-10)"
    },
    {
      "id": "R-3.7.1-1",
      "level": "MUST",
      "text": "TCP endpoints MUST implement both sending and receiving the MSS Option (MUST-14).",
      "section": "3.7.1",
      "sectionTitle": "Maximum Segment Size Option",
      "fullContext": "TCP endpoints MUST implement both sending and receiving the MSS Option (MUST-14).",
      "subject": "tcp endpoints",
      "action": "implement both sending and receiving the MSS Option (MUST-14)"
    }
  ],
  "_source": "xml"
}
```

`id` is `R-<section>-<n>` with `n` numbered per section, so the identifier stays stable when requirements are added elsewhere in the document.

### `get_rfc_dependencies` - Get RFC Dependencies

`get_rfc_dependencies { "rfc": 9293 }`

```json
{
  "rfc": 9293,
  "normative": [
    { "rfcNumber": 791, "title": "Internet Protocol", "anchor": "RFC0791" },
    { "rfcNumber": 1191, "title": "Path MTU discovery", "anchor": "RFC1191" },
    {
      "rfcNumber": 2119,
      "title": "Key words for use in RFCs to Indicate Requirement Levels",
      "anchor": "RFC2119"
    }
  ],
  "informative": [
    { "rfcNumber": 793, "title": "Transmission Control Protocol", "anchor": "RFC0793" },
    { "rfcNumber": 896, "title": "Congestion Control in IP/TCP Internetworks", "anchor": "RFC0896" }
  ],
  "_source": "xml",
  "_referencesSource": "xml"
}
```

`_referencesSource` tells where the reference list came from: `xml` (RFCXML `<references>`), `text` (the References section of the plain text), or `api` (Datatracker `relateddocument`, with placeholder titles).

### `generate_checklist` - Generate Implementation Checklist

`generate_checklist { "rfc": 9293, "role": "client", "sections": ["3.5", "3.7.1"] }` — the `markdown` field:

```markdown
# RFC 9293 Implementation Checklist

**Transmission Control Protocol (TCP)**

Role: client

Generated: 2026-09-04T17:09:37.833Z

## Mandatory Requirements (MUST / REQUIRED / SHALL)

- [ ] **MUST** A TCP implementation MUST support simultaneous open attempts (MUST-10). (§3.5)
- [ ] **MUST** TCP endpoints MUST implement both sending and receiving the MSS Option (MUST-14). (§3.7.1)
- [ ] **MUST** If an MSS Option is not received at connection setup, TCP implementations MUST assume a default send MSS of 536 (576 - 40) for IPv4 or 1220 (1280 - 60) for IPv6 (MUST-15). (§3.7.1)

## Recommended Requirements (SHOULD / RECOMMENDED)

- [ ] **SHOULD** TCP implementations SHOULD allow a received RST segment to include data (SHLD-2). (§3.5.3)
```

The same call also returns `"stats": { "must": 6, "should": 2, "may": 1, "total": 9 }`.

### `validate_statement` - Find Bearing Requirements

`validate_statement { "rfc": 6455, "statement": "The client MUST mask all frames sent to the server." }`

```json
{
  "rfc": 6455,
  "statement": "The client MUST mask all frames sent to the server.",
  "analysis": { "detectedLevel": "MUST", "detectedSubject": "client" },
  "isValid": true,
  "matchingRequirements": [
    {
      "id": "R-5.3-2",
      "level": "MUST",
      "text": "When preparing a masked frame, the client MUST pick a fresh masking key from the set of allowed 32-bit values.",
      "section": "5.3",
      "sectionTitle": "Client-to-Server Masking",
      "_matchScore": 17,
      "_matchedKeywords": ["client", "mask", "frames"],
      "_subjectMatch": true,
      "_levelMatch": true
    }
  ],
  "conflicts": [],
  "_source": "text",
  "_sourceNote": "Warning: Parsed from text format. Validation accuracy may be limited."
}
```

`isValid: true` means only that no contradiction was detected among the matched requirements. When nothing matches strongly enough, `isValid` is `null` and `_verdictNote` explains why.

### Text Fallback Output (Legacy RFCs)

`get_rfc_structure { "rfc": 6455 }` — RFC 6455 predates RFCXML v3, so the plain text is parsed:

```json
{
  "metadata": {
    "title": "The WebSocket Protocol",
    "number": 6455,
    "date": "2011-12",
    "category": "std",
    "stream": "IETF",
    "abstract": "The WebSocket Protocol enables two-way communication ..."
  },
  "sections": [
    { "number": "1", "title": "Introduction" },
    { "number": "2", "title": "Conformance Requirements" },
    { "number": "5", "title": "Data Framing" }
  ],
  "referenceCount": { "normative": 18, "informative": 9 },
  "_source": "text",
  "_sourceNote": "Warning: Parsed from text format. Accuracy may be limited."
}
```

For RFCs 8650 and later, the XML is tried first. If every XML source returns 404 the call fails ("No RFC with that number is published"). If the XML fetch fails for another reason (5xx, timeout), the text is used and `_sourceNote` says that the XML fetch failed and may be temporary.

## Disk cache and `rfcxml-prefetch`

By default, fetched RFCs live only in an in-memory LRU cache and are re-fetched after every restart. Set `RFCXML_CACHE_DIR` to keep them on disk:

```
$RFCXML_CACHE_DIR/
├── xml/rfc9293.xml     # RFCXML (RFC 8650 and later)
└── text/rfc6455.txt    # plain text (older RFCs, or XML fetch failures)
```

The package also ships a `rfcxml-prefetch` CLI that fills the same layout ahead of time, for offline or CI use:

```bash
# Fetch a range into $RFCXML_CACHE_DIR (or ~/.cache/rfcxml-mcp when unset)
npx -y -p @shuji-bonji/rfcxml-mcp rfcxml-prefetch --range 9110-9114

# Individual RFCs, explicit directory, re-download even if cached
npx -y -p @shuji-bonji/rfcxml-mcp rfcxml-prefetch --rfc 6455 --rfc 9293 --cache-dir ./rfc-cache --force
```

Options: `--range A-B`, `--rfc N` (repeatable), `--cache-dir DIR`, `--concurrency N` (default 3), `--force`. RFCs already on disk (XML or text) are skipped unless `--force` is given. RFC numbers must be digits only; `--rfc 9110abc` exits with code 1.

## Examples

See the [examples/](./examples/) directory for complete checklist samples:

| RFC                                                   | Protocol  | Source          |
| ----------------------------------------------------- | --------- | --------------- |
| [RFC 6455](./examples/rfc6455-websocket-checklist.md) | WebSocket | Text (fallback) |
| [RFC 9293](./examples/rfc9293-tcp-checklist.md)       | TCP       | RFCXML          |
| [RFC 7540](./examples/rfc7540-http2-checklist.md)     | HTTP/2    | Text (fallback) |

**Example prompt for Claude:**

```
Generate an implementation checklist for RFC 9293 (TCP).
```

## Internal Architecture

### Module Structure

```
src/
├── index.ts                    # MCP server entry point
├── config.ts                   # Centralized configuration
├── constants.ts                # BCP 14 keyword definitions + RFC number limits
├── services/
│   ├── rfc-fetcher.ts          # RFC fetching (parallel)
│   ├── rfc-service.ts          # RFC parse & cache management
│   ├── rfcxml-parser.ts        # RFCXML parser
│   ├── rfc-text-parser.ts      # Text fallback parser
│   └── checklist-generator.ts  # Checklist generation service
├── tools/
│   ├── definitions.ts          # MCP tool definitions
│   └── handlers.ts             # Tool handlers (toolHandlers map)
├── types/
│   └── index.ts                # Type definitions
└── utils/
    ├── cache.ts                # LRU cache
    ├── fetch.ts                # Parallel fetch utility
    ├── logger.ts               # Logger abstraction
    ├── requirement-extractor.ts # Shared requirement extraction
    ├── section.ts              # Section search utilities
    ├── statement-matcher.ts    # Weighted statement matching
    ├── text.ts                 # Text processing utility
    └── validation.ts           # Input validation
```

### RFC Fetch Optimization

Sends parallel requests to the two XML sources (RFC Editor, Datatracker) and uses the first successful response. `tools.ietf.org` was retired in 2021 and is not used. There is no retry; the parallel race is the only redundancy.

```
┌─────────────────┐
│  fetchRFCXML()  │
└────────┬────────┘
         │ Parallel requests
    ┌────┴─────────┐
    ▼              ▼
┌────────┐    ┌────────┐
│RFC     │    │Data-   │
│Editor  │    │tracker │
└────┬───┘    └────┬───┘
     │             │
     └──────┬──────┘
            │ Promise.any (first success)
            ▼
    ┌───────────┐
    │ Successful│ → Cancel other requests via AbortController
    │ Response  │
    └───────────┘
```

Concurrent calls for the same RFC (e.g. `get_rfc_structure` and `get_requirements` issued in parallel) share one in-flight fetch and one parse.

### Cache Strategy

LRU (Least Recently Used) cache with memory limits, plus the optional disk cache (`RFCXML_CACHE_DIR`) below the XML / text caches:

| Cache          | Max Entries | Content          |
| -------------- | ----------- | ---------------- |
| XML Cache      | 20          | Raw RFCXML       |
| Text Cache     | 20          | Raw text         |
| Metadata Cache | 100         | RFC metadata     |
| Parse Cache    | 50          | Parsed structure |

## Development

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Build
npm run build

# Unit tests (single run) / watch mode
npm test
npm run test:watch

# E2E test (MCP client integration; fetches a few real RFCs)
npm run test:e2e

# Audit against real RFCs, tool-to-tool crosscheck, output snapshots
# (see tests/audit/README.md; run weekly by .github/workflows/audit.yml)
npm run audit
npm run crosscheck
npm run snapshot

# Lint
npm run lint

# Format
npm run format
```

## License

MIT

## Related Projects

- [mjpitz/mcp-rfc](https://github.com/mjpitz/mcp-rfc) - Text-based RFC MCP
- [ietf-tools/RFCXML](https://github.com/ietf-tools/RFCXML) - RFCXML schema
- [xml2rfc](https://xml2rfc.ietf.org/) - IETF official tool
