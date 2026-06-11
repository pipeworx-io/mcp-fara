# mcp-fara

FARA (Foreign Agents Registration Act) MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 871+ live data sources.

## Tools

| Tool | Description |
|------|-------------|

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "fara": {
      "url": "https://gateway.pipeworx.io/fara/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 871+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Fara data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [All tools and guides](https://github.com/pipeworx-io/examples)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
