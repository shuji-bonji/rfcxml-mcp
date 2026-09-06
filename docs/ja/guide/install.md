# 導入

**Node.js 22 以上**が必要です。パッケージは npm の [`@shuji-bonji/rfcxml-mcp`](https://www.npmjs.com/package/@shuji-bonji/rfcxml-mcp) として公開しています。`npx` が初回起動時に取得するので、事前のインストールは不要です。

## Claude Desktop

MCP の設定ファイルに次のブロックを追加します。

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

設定ファイルの場所は次のとおりです。

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

## Claude Code

コマンドラインから登録できます。

```bash
claude mcp add rfcxml -- npx -y @shuji-bonji/rfcxml-mcp
```

設定ファイルに書く場合は、上と同じ `mcpServers` ブロックを次のいずれかに置きます。

- **プロジェクト単位**: プロジェクトルートの `.mcp.json`
- **ユーザー単位**: `~/.claude.json`

## Cowork（プラグイン）

::: info
v0.6.53 時点の README には、Cowork のプラグインとして登録する手順がまだ書かれていません。手順が整うまでは、プラグインの MCP 設定に上と同じ `command` / `args` を書いてください。
:::

## バージョンを固定する

::: tip
0.6 系はパッチバージョンが頻繁に上がります。チームで同じ出力を前提にする場合や CI で使う場合は、パッケージ名にバージョンを付けて固定してください。
:::

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

Claude Code では `claude mcp add rfcxml -- npx -y @shuji-bonji/rfcxml-mcp@0.6.53` です。

## グローバルインストール（任意）

```bash
npm install -g @shuji-bonji/rfcxml-mcp
```

インストール後は、`command` に実行ファイル名を直接書けます。

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

既定では、取得した RFC はメモリ上の LRU キャッシュにだけ保持され、サーバーを再起動するたびに取り直します。環境変数 `RFCXML_CACHE_DIR` を設定すると、取得した RFC をディスクに保存し、次回以降はそこから読みます。

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

ディスク上の配置は次のとおりです。

```
$RFCXML_CACHE_DIR/
├── xml/rfc9293.xml     # RFCXML（RFC 8650 以降）
└── text/rfc6455.txt    # テキスト形式（それより前の RFC、または XML の取得に失敗したとき）
```

## 事前取得: `rfcxml-prefetch`

オフライン環境や CI で使うために、RFC をあらかじめキャッシュへ取り込むコマンド `rfcxml-prefetch` を同梱しています。

```bash
# 指定した範囲の RFC を $RFCXML_CACHE_DIR（未設定なら ~/.cache/rfcxml-mcp）へ取得する
npx -y -p @shuji-bonji/rfcxml-mcp rfcxml-prefetch --range 9110-9114

# 個別の RFC を指定し、保存先を変え、キャッシュ済みでも取り直す
npx -y -p @shuji-bonji/rfcxml-mcp rfcxml-prefetch --rfc 6455 --rfc 9293 --cache-dir ./rfc-cache --force
```

オプションは `--range A-B`、`--rfc N`（複数指定可）、`--cache-dir DIR`、`--concurrency N`（既定 3）、`--force` です。XML・テキストのどちらかが既にディスクにある RFC は、`--force` を付けない限り取得しません。RFC 番号は数字だけを受け付け、`--rfc 9110abc` のような指定は終了コード 1 で失敗します。

::: warning サーバー側にも同じ `RFCXML_CACHE_DIR` を渡してください
`rfcxml-prefetch` が保存したファイルは、MCP サーバーの起動時に同じ `RFCXML_CACHE_DIR` が設定されているときだけ読まれます。設定が無いと、サーバーは事前取得したファイルを使わずに取り直します。
:::
