# RFCXML MCP Server

[![npm version](https://img.shields.io/npm/v/@shuji-bonji/rfcxml-mcp.svg)](https://www.npmjs.com/package/@shuji-bonji/rfcxml-mcp)
[![CI](https://img.shields.io/github/actions/workflow/status/shuji-bonji/rfcxml-mcp/ci.yml?branch=main&label=CI)](https://github.com/shuji-bonji/rfcxml-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-blueviolet)](https://claude.ai/code)

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

| Feature | Existing mcp-rfc | RFCXML MCP |
|---------|------------------|------------|
| RFC text retrieval | ✅ | ✅ |
| Section extraction | ✅ (text-based) | ✅ (structure-based) |
| MUST/SHOULD/MAY extraction | ❌ | ✅ |
| Condition/exception structuring | ❌ | ✅ |
| RFC dependency graph | ❌ | ✅ |
| Definition scope management | ❌ | ✅ |
| Implementation checklist | ❌ | ✅ |

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

Configuration file locations:
- **Claude Desktop (macOS)**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Windows)**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Claude Code**: `.claude/settings.json` or use `claude settings` command

### Installation (Optional)

For global installation:

```bash
npm install -g @shuji-bonji/rfcxml-mcp

# MCP configuration
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

- `validate_statement` - Verify if a statement complies with RFC requirements
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
  "_sourceNote": "⚠️ Parsed from text format. Accuracy may be lower."
}
```

| `_source` | Description |
|-----------|-------------|
| `xml` | Parsed from RFCXML (high accuracy) |
| `text` | Parsed from text (medium accuracy) |

### Compatibility

| RFC | Format | Notes |
|-----|--------|-------|
| RFC 8650+ | XML | Official RFCXML v3 support |
| Before RFC 8650 | Text | Automatic fallback |

## Output Samples

### `get_rfc_structure` - Get RFC Structure

```json
{
  "metadata": {
    "title": "Transmission Control Protocol (TCP)",
    "docName": "draft-ietf-tcpm-rfc793bis-28",
    "number": 9293
  },
  "sections": [
    {
      "number": "section-1",
      "title": "Purpose and Scope"
    },
    {
      "number": "section-3",
      "title": "Functional Specification",
      "subsections": [
        { "number": "section-3.1", "title": "Header Format" },
        {
          "number": "section-3.5",
          "title": "Establishing a Connection",
          "subsections": [
            { "number": "section-3.5.1", "title": "Half-Open Connections and Other Anomalies" },
            { "number": "section-3.5.2", "title": "Reset Generation" }
          ]
        }
      ]
    }
  ],
  "referenceCount": { "normative": 15, "informative": 85 },
  "_source": "xml"
}
```

### `get_requirements` - Extract Normative Requirements

```json
{
  "rfc": 9293,
  "filter": { "level": "MUST" },
  "stats": { "total": 53, "byLevel": { "MUST": 53 } },
  "requirements": [
    {
      "id": "R-section-3.5-5",
      "level": "MUST",
      "text": "A TCP implementation support simultaneous open attempts (MUST-10).",
      "section": "section-3.5",
      "sectionTitle": "Establishing a Connection"
    },
    {
      "id": "R-section-3.7.1-9",
      "level": "MUST",
      "text": "TCP endpoints implement both sending and receiving the MSS Option (MUST-14).",
      "section": "section-3.7.1",
      "sectionTitle": "Maximum Segment Size Option"
    }
  ],
  "_source": "xml"
}
```

### `get_rfc_dependencies` - Get RFC Dependencies

```json
{
  "rfc": 9293,
  "normative": [
    { "rfcNumber": 791, "title": "Internet Protocol", "anchor": "RFC0791" },
    { "rfcNumber": 2119, "title": "Key words for use in RFCs to Indicate Requirement Levels" },
    { "rfcNumber": 5681, "title": "TCP Congestion Control" }
  ],
  "informative": [
    { "rfcNumber": 793, "title": "Transmission Control Protocol" },
    { "rfcNumber": 1122, "title": "Requirements for Internet Hosts - Communication Layers" }
  ],
  "_source": "xml"
}
```

### `generate_checklist` - Generate Implementation Checklist

```markdown
# RFC 9293 Implementation Checklist

**Transmission Control Protocol (TCP)**

Role: Client

## Required (MUST / REQUIRED / SHALL)

- [ ] A TCP implementation support simultaneous open attempts (MUST-10). (section-3.5)
- [ ] TCP endpoints implement both sending and receiving the MSS Option (MUST-14). (section-3.7.1)
- [ ] The RTO be computed according to the algorithm in, including Karn's algorithm (MUST-18). (section-3.8.1)

## Optional (MAY / OPTIONAL)

- [ ] Implementers include "keep-alives" in their TCP implementations (MAY-5). (section-3.8.4)
```

### Text Fallback Output (Legacy RFCs)

```json
{
  "metadata": {
    "title": "The WebSocket Protocol",
    "number": 6455
  },
  "sections": [
    { "number": "1", "title": "Introduction" },
    { "number": "5", "title": "Data Framing" }
  ],
  "_source": "text",
  "_sourceNote": "⚠️ Parsed from text format. Accuracy may be lower."
}
```

## Examples

See the [examples/](./examples/) directory for complete checklist samples:

| RFC | Protocol | Source |
|-----|----------|--------|
| [RFC 6455](./examples/rfc6455-websocket-checklist.md) | WebSocket | Text (fallback) |
| [RFC 9293](./examples/rfc9293-tcp-checklist.md) | TCP | RFCXML |
| [RFC 7540](./examples/rfc7540-http2-checklist.md) | HTTP/2 | Text (fallback) |

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
├── constants.ts                # BCP 14 keyword definitions
├── services/
│   ├── rfc-fetcher.ts          # RFC fetching (parallel)
│   ├── rfcxml-parser.ts        # RFCXML parser
│   └── rfc-text-parser.ts      # Text fallback parser
├── tools/
│   ├── definitions.ts          # MCP tool definitions
│   └── handlers.ts             # Tool handlers
├── types/
│   └── index.ts                # Type definitions
└── utils/
    ├── cache.ts                # LRU cache
    ├── fetch.ts                # Parallel fetch utility
    └── text.ts                 # Text processing utility
```

### RFC Fetch Optimization

Sends parallel requests to multiple sources (RFC Editor, IETF Tools, Datatracker) and uses the first successful response:

```
┌─────────────────┐
│  fetchRFCXML()  │
└────────┬────────┘
         │ Parallel requests
    ┌────┴────┬────────────┐
    ▼         ▼            ▼
┌────────┐ ┌────────┐ ┌────────┐
│RFC     │ │IETF    │ │Data-   │
│Editor  │ │Tools   │ │tracker │
└────┬───┘ └────┬───┘ └────┬───┘
     │          │          │
     └────┬─────┴──────────┘
          │ Promise.any (first success)
          ▼
    ┌───────────┐
    │ Successful│ → Cancel other requests via AbortController
    │ Response  │
    └───────────┘
```

### Cache Strategy

LRU (Least Recently Used) cache with memory limits:

| Cache | Max Entries | Content |
|-------|-------------|---------|
| XML Cache | 20 | Raw RFCXML |
| Text Cache | 20 | Raw text |
| Metadata Cache | 100 | RFC metadata |
| Parse Cache | 50 | Parsed structure |

## Development

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Build
npm run build

# Test
npm test

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
