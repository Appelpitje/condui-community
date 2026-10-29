# Condui MCP server

The `/mcp` endpoint edits the same projects as the Community browser editor. It uses the official
[TypeScript MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) and the existing Condui
command registry, project migrations, symbol catalogue, validation, and storage. No model API key or
separate AI service is required by Condui; connect an MCP-capable assistant of your choice.

## Local setup

Use Node.js 24 as pinned in `.nvmrc`, install dependencies with `npm ci --ignore-scripts`, then run:

```bash
npm run build
npm run start:mcp
```

The editor is at `http://127.0.0.1:8090` and the MCP endpoint at `http://127.0.0.1:8090/mcp`.
The launcher creates the ignored `condui-data/` directory for project storage. It honours existing
`CONDUI_DATA_DIR`, `HOST`, and `PORT` settings. When setting `CONDUI_DATA_DIR` yourself, create that
directory first. Use only one Condui server process per data directory.

This checkout includes `.codex/config.toml`:

```toml
[mcp_servers.condui]
url = "http://127.0.0.1:8090/mcp"
```

Codex loads this configuration for trusted projects. Start the server, then restart the MCP connection
in Codex. See the [official Codex MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
If you change `PORT`, change the client URL too. `npm start` retains its existing default port, 8080;
its MCP endpoint also works when server storage is enabled.

Container installations must build the modified source (`docker build -t condui-community:local .`)
and mount a data directory at `/data`. The upstream published image does not include this local change.
For example: `docker run --rm -p 127.0.0.1:8090:8080 -v "$PWD/condui-data:/data" condui-community:local`.

## Access

The endpoint uses the existing Community network/password guard. If `CONDUI_PASSWORD` is set,
configure your client to send HTTP Basic authorization (the username may be empty). For Codex, set
`env_http_headers = { Authorization = "CONDUI_MCP_AUTHORIZATION" }` in the server entry and supply
`CONDUI_MCP_AUTHORIZATION` in Codex's environment as `Basic ` followed by base64 of `:your-password`.
Keep credentials out of tracked configuration files. The normal HTTPS requirement for internet
access still applies. Cross-origin browser requests are rejected; HTTP bodies are limited to 4 MiB.

## Drawing workflow

1. Use `condui_list_projects` or `condui_create_project` to choose a server project.
2. Use `condui_find_entities`, `condui_read_entities`, and `condui_get_graph` to inspect IDs and connections.
3. Use `condui_list_symbols`, `condui_list_commands`, and `condui_describe_command` to discover supported inputs.
4. Read `condui_get_workflow` for a complete example covering a circuit, switch, light, wall, door,
   situation-plan wiring, and panel layout.
5. Call `condui_preview_commands` with the latest `revision` as `expectedRevision`. Then apply the same
   batch with `condui_apply_commands`. Each batch accepts up to 100 commands and saves all or nothing.
6. Run `condui_validate_project`, follow pagination, and reload the project in the browser to inspect the drawing.

For example, after discovering the actual project and panel IDs:

```json
{
  "projectId": "PROJECT_ID",
  "expectedRevision": 1,
  "commands": [
    {
      "id": "circuit.createEmpty",
      "as": "lighting",
      "input": { "panelId": "PANEL_ID", "kind": "lighting" }
    },
    {
      "id": "electrical.placeSymbol",
      "input": {
        "symbolId": "light_point",
        "destination": {
          "kind": "circuit",
          "circuitId": { "$created": { "from": "lighting", "kind": "circuit" } }
        }
      }
    }
  ]
}
```

Aliases refer only to earlier commands within that batch. Preview IDs are temporary; use aliases
in the submitted batch and native IDs returned by a successful save for subsequent calls.
If a browser or another assistant changes the project, the old revision is rejected. Read again and
prepare the edit against the latest state; MCP does not offer forced overwrites.

## Boundaries and verification

The assistant accesses saved server projects, not unsaved browser state or browser-only projects.
Open drawings do not automatically refresh. Export PDF drawings or portable project archives through
the editor. Community edition restrictions, including unavailable junction editing, still apply.
Electrical creation defaults are editable assumptions. Validation reports findings and coverage;
it does not establish unknown installation facts or certify regulatory compliance.

Run `npm run test:mcp` for protocol-level tests using the real HTTP server and MCP client. These cover
native drawing commands, canonical browser storage, previews, rollback, concurrent revisions,
password/network/origin checks, request limits, and disabled storage. `npm run build` builds both the
browser application and the Node MCP bundle; CI runs the integration tests after the build.
