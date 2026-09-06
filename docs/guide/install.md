# Install

Requires **Node.js 22 or later**. The package is published on npm as [`@shuji-bonji/rfcxml-mcp`](https://www.npmjs.com/package/@shuji-bonji/rfcxml-mcp); `npx` fetches it on first use, so no global install is needed.

## Claude Desktop

Add the following to the MCP configuration file:

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

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

## Claude Code

CLI:

```bash
claude mcp add rfcxml -- npx -y @shuji-bonji/rfcxml-mcp
```

Or write the same `mcpServers` block as above into:

- **Project scope**: `.mcp.json` at the project root
- **User scope**: `~/.claude.json`

## Cowork (plugin)

::: info
A Cowork plugin entry is not described in the repository README at v0.6.53. Until it is, register the server with the same `command` / `args` as above in the plugin's MCP configuration.
:::

## Pin a version

::: tip
The 0.6 line publishes patch releases often. Pin the version when a team relies on identical output or when the server runs in CI.
:::

0.6.x ships patch releases frequently. To pin, write the version into the package spec:

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

With the CLI: `claude mcp add rfcxml -- npx -y @shuji-bonji/rfcxml-mcp@0.6.53`.

## Global install (optional)

```bash
npm install -g @shuji-bonji/rfcxml-mcp
```

Then:

```json
{
  "mcpServers": {
    "rfcxml": {
      "command": "rfcxml-mcp"
    }
  }
}
```

## Disk cache: `RFCXML_CACHE_DIR`

By default, fetched RFCs live only in an in-memory LRU cache and are re-fetched after every restart. Set `RFCXML_CACHE_DIR` to keep them on disk:

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

Layout on disk:

```
$RFCXML_CACHE_DIR/
├── xml/rfc9293.xml     # RFCXML (RFC 8650 and later)
└── text/rfc6455.txt    # plain text (older RFCs, or XML fetch failures)
```

## Prefetch: `rfcxml-prefetch`

The package also ships a `rfcxml-prefetch` CLI that fills the same layout ahead of time, for offline or CI use:

```bash
# Fetch a range into $RFCXML_CACHE_DIR (or ~/.cache/rfcxml-mcp when unset)
npx -y -p @shuji-bonji/rfcxml-mcp rfcxml-prefetch --range 9110-9114

# Individual RFCs, explicit directory, re-download even if cached
npx -y -p @shuji-bonji/rfcxml-mcp rfcxml-prefetch --rfc 6455 --rfc 9293 --cache-dir ./rfc-cache --force
```

Options: `--range A-B`, `--rfc N` (repeatable), `--cache-dir DIR`, `--concurrency N` (default 3), `--force`. RFCs already on disk (XML or text) are skipped unless `--force` is given. RFC numbers must be digits only; `--rfc 9110abc` exits with code 1.

::: warning Pass the same `RFCXML_CACHE_DIR` to the server
Files saved by `rfcxml-prefetch` are read only when the MCP server is started with the same `RFCXML_CACHE_DIR`. Without it the server ignores the prefetched files and fetches again.
:::
