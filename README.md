# Scout Lab - Tough Stuff Gear

Scout Lab is the Tough Stuff Gear Pokelab dashboard: Scout patrols the pixel lab while the app tracks IG collaboration leads, Shopify Mailroom activity, Store Health, and task history.

The primary development mode is now a **standalone local Node.js app**. The same visual source still contains the LED TOUGH STUFF GEAR sign, live clock, TSG FIELD SPECIMENS Poke display case, Scout sprite, Mailroom LED, and the IG / Mailroom / History tabs.

## Start locally

Requirements: Git and Node.js 22 LTS or newer.

```bash
git clone https://github.com/themikegolden/scout-lab.git
cd scout-lab
npm install
npm start
```

Open:

```text
http://localhost:3100
```

See [LOCAL_SETUP.md](LOCAL_SETUP.md) for the complete setup and restart instructions.

## Standalone architecture

```text
GitHub
  |
  v
Node.js local server
  |-- public/index.html          Pokelab browser dashboard
  |-- public/app-v21.js          UI behavior + live connection
  |-- /api/*                     Scout Lab API
  |-- /live                      WebSocket refresh channel
  |-- /mcp                       existing MCP endpoint
  `-- data/scout-lab.sqlite      local persistent database
```

When `DATABASE_URL` is absent, `src/node-server.mjs` automatically uses local SQLite and binds to `127.0.0.1:3100`. Local API access is trusted only while the server remains loopback-only.

If `DATABASE_URL` is present, the same Node server can still use the existing Postgres adapter. This keeps a future VM/server migration straightforward without redesigning the dashboard.

## Local persistence

The first local start creates `data/scout-lab.sqlite` and imports the eight historical IG baseline candidates once. The database is ignored by Git and remains on the local computer.

The browser also opens a WebSocket connection to `/live`. Successful write operations and scheduled task reconciliation send refresh signals immediately; the existing 15-second polling remains as a fallback.

## ChatGPT integration

The MCP and ChatGPT Workspace Agent code remains in the project, but a localhost-only server cannot receive cloud callbacks without an accessible endpoint. Local Scout Lab therefore works without ChatGPT credentials, while Mailroom agent refresh remains a separate integration step.

A future local provider can call the OpenAI API directly from Node, or the same app can be moved to a user-controlled VM/server and exposed securely. Neither option requires redesigning the Pokelab frontend.

## Important files

- `public/index.html` - single visual source of truth for the Pokelab dashboard.
- `public/app-v21.js` - dashboard data behavior, local live connection, and controls.
- `src/node-server.mjs` - standalone Node HTTP/WebSocket server.
- `src/sqlite-d1-adapter.mjs` - local SQLite adapter matching the existing data API.
- `src/local-seed.mjs` - first-run baseline IG import.
- `migrations/001_sqlite_local.sql` - local database schema.
- `src/pg-d1-adapter.mjs` - optional Postgres adapter for future server hosting.
- `src/worker.mjs` - shared Scout Lab REST/MCP business logic.
- `LOCAL_SETUP.md` - computer setup instructions.

## Validation

```bash
npm run build:widget
npm run check
```

`public/chatgpt-widget.html` is generated from `public/index.html`; do not maintain a second visual implementation by hand.

## Security

Local mode binds to `127.0.0.1` by default and does not require a login. If you later bind to `0.0.0.0` or expose Scout Lab on a VM/server, configure real authentication before making the API or MCP endpoint publicly reachable.