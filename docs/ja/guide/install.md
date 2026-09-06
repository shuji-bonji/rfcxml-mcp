# 導入

**Node.js 22 以上** が要る。パッケージは npm の [`@shuji-bonji/rfcxml-mcp`](https://www.npmjs.com/package/@shuji-bonji/rfcxml-mcp) にあり、`npx` が初回に取得するのでグローバルインストールは不要。

## Claude Desktop

MCP の設定ファイルに次を書く。

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

設定ファイルの場所:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

## Claude Code

CLI:

```bash
claude mcp add rfcxml -- npx -y @shuji-bonji/rfcxml-mcp
```

または上と同じ `mcpServers` ブロックを次に書く。

- **プロジェクトスコープ**: プロジェクトルートの `.mcp.json`
- **ユーザースコープ**: `~/.claude.json`

## Cowork（プラグイン）

::: info
v0.6.53 時点の README には Cowork プラグインとしての登録手順が書かれていない。書かれるまでは、プラグインの MCP 設定に上と同じ `command` / `args` を書く。
:::

## 版を固定する

0.6 系はパッチが頻繁に出る。固定するときはパッケージ名に版を書く。

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

CLI では `claude mcp add rfcxml -- npx -y @shuji-bonji/rfcxml-mcp@0.6.53`。

## グローバルインストール（任意）

```bash
npm install -g @shuji-bonji/rfcxml-mcp
```

そのうえで:

```json
{
  "mcpServers": {
    "rfcxml": {
      "command": "rfcxml-mcp"
    }
  }
}
```

## ディスクキャッシュ: `RFCXML_CACHE_DIR`

既定では、取得した RFC はメモリの LRU にしか入らず、再起動のたびに取り直す。`RFCXML_CACHE_DIR` を設定するとディスクに残る。

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

ディスク上の配置:

```
$RFCXML_CACHE_DIR/
├── xml/rfc9293.xml     # RFCXML（RFC 8650 以上）
└── text/rfc6455.txt    # テキスト（それより前の RFC、または XML の取得に失敗したとき）
```

## 事前取得: `rfcxml-prefetch`

同じ配置をあらかじめ埋める CLI `rfcxml-prefetch` も同梱している（オフライン・CI 向け）。

```bash
# 範囲を $RFCXML_CACHE_DIR（未設定なら ~/.cache/rfcxml-mcp）へ取得
npx -y -p @shuji-bonji/rfcxml-mcp rfcxml-prefetch --range 9110-9114

# 個別の RFC、ディレクトリ指定、キャッシュ済みでも取り直す
npx -y -p @shuji-bonji/rfcxml-mcp rfcxml-prefetch --rfc 6455 --rfc 9293 --cache-dir ./rfc-cache --force
```

オプション: `--range A-B`、`--rfc N`（繰り返し可）、`--cache-dir DIR`、`--concurrency N`（既定 3）、`--force`。ディスクにある RFC（XML でもテキストでも）は `--force` が無ければ飛ばす。RFC 番号は数字のみ。`--rfc 9110abc` は終了コード 1。

事前取得したファイルを MCP サーバに読ませるには、サーバ起動時にも同じ `RFCXML_CACHE_DIR` を渡す。
