# RFCXML MCP Server

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

## Usage Examples

### Extracting Normative Requirements

```typescript
// Tool call
{
  "tool": "get_requirements",
  "arguments": {
    "rfc": 6455,
    "section": "5.5.1"
  }
}

// Result
{
  "section": "5.5.1",
  "title": "Close",
  "requirements": [
    {
      "id": "R-5.5.1-1",
      "level": "MUST",
      "text": "endpoint MUST send a Close frame",
      "subject": "endpoint",
      "action": "send Close frame",
      "condition": "when closing connection",
      "fullContext": "After sending a control frame indicating..."
    }
  ]
}
```

### Generating Implementation Checklist

```typescript
// Tool call
{
  "tool": "generate_checklist",
  "arguments": {
    "rfc": 6455,
    "role": "client"
  }
}

// Result (Markdown)
## RFC 6455 WebSocket Client Implementation Checklist

### Required (MUST)
- [ ] Include Sec-WebSocket-Key in Opening Handshake (Section 4.1)
- [ ] Close TCP connection after receiving Close frame (Section 5.5.1)
- [ ] Mask key must be unpredictable (Section 5.3)

### Recommended (SHOULD)
- [ ] Include reason in Close frame (Section 7.1.6)
```

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
