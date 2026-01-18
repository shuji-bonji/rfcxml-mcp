# Examples

This directory contains sample outputs from rfcxml-mcp's `generate_checklist` tool.

## Sample Checklists

| File | RFC | Description | Source |
|------|-----|-------------|--------|
| [rfc6455-websocket-checklist.md](./rfc6455-websocket-checklist.md) | RFC 6455 | The WebSocket Protocol | Text (fallback) |
| [rfc9293-tcp-checklist.md](./rfc9293-tcp-checklist.md) | RFC 9293 | Transmission Control Protocol (TCP) | RFCXML |
| [rfc7540-http2-checklist.md](./rfc7540-http2-checklist.md) | RFC 7540 | HTTP/2 | Text (fallback) |

## How to Generate Checklists

### Using Claude Desktop or Claude Code

Once rfcxml-mcp is configured, you can ask Claude to generate a checklist:

**English:**
```
Generate an implementation checklist for RFC 9293 (TCP).
```

**Japanese:**
```
RFC 9293 (TCP) の実装チェックリストを生成してください。
```

### Using MCP Tool Directly

The `generate_checklist` tool accepts the following parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `rfc` | number | RFC number (required) |
| `role` | string | `"client"`, `"server"`, or `"both"` (default: `"both"`) |
| `sections` | string[] | Specific sections to include (optional) |

**Example request:**
```json
{
  "rfc": 9293,
  "role": "both"
}
```

## Source Information

All checklists include source metadata:

- **RFCXML (high accuracy)**: Parsed from official RFCXML v3 format
- **Text fallback (medium accuracy)**: Parsed from plain text format (for RFCs before RFC 8650)

RFCs published after RFC 8650 (December 2019) are available in RFCXML format. Earlier RFCs use text fallback.

## Regenerating Examples

To regenerate these examples:

```bash
cd /path/to/rfcxml-mcp
npm run build
node scripts/generate-examples.js
```

## Related Tools

- `get_requirements` - Extract normative requirements without generating a checklist
- `get_rfc_structure` - Get section hierarchy and metadata
- `validate_statement` - Verify if a statement complies with RFC requirements
