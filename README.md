# mcp-fara

FARA (Foreign Agents Registration Act) MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `search_registrants` | Search FARA registrants — US agents registered to represent FOREIGN principals (foreign governments, parties, businesses) for lobbying/influence inside the US. FARA has no server-side search, so this fetches the bulk active-registrant dump (~556 rows) once and filters CLIENT-SIDE by a name substring (case-insensitive); results are capped. Set status="terminated" to search the much larger terminated dump (~6,500 rows, ~1.4MB fetched once). Returns each registrant's name, registration_number (use it with list_foreign_principals / get_registrant_documents), address and registration_date. Keyless. |
| `list_foreign_principals` | List the FOREIGN principals (foreign governments, parties, companies, individuals) that a given FARA registrant represents — i.e. who a US agent is working for. Addressed server-side by registration_number (get one from search_registrants). Optionally filter the returned set CLIENT-SIDE by country or principal-name substring. Set status="terminated" for former relationships. Returns principal_name, country, registrant_name, registration_date and address. Keyless. |
| `get_registrant_documents` | List FARA filings (PDF documents) for a registrant by registration_number (from search_registrants) — registration statements, supplemental statements, informational materials, exhibits, etc. Each row links the document to the specific foreign principal/country it concerns and gives a direct PDF URL. Optionally filter CLIENT-SIDE by document_type or country substring. Results are capped. Keyless. |

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

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/fara/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Fara data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
