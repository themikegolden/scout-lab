# Scout Lab v22 — ChatGPT App + Browser Dashboard

Scout Lab v22 keeps the Tough Stuff Gear dashboard's existing pixel-art room, Scout animation, layout, tabs, styling, D1 data model, freshness rules, pipeline fields, Store Health, and History. The change in v22 is architectural: the **same dashboard can now run in two surfaces**.

1. **Standalone browser URL** — `public/index.html` continues to use the existing `/api/*` routes.
2. **Inside ChatGPT** — `public/chatgpt-widget.html` is generated from `public/index.html` and replaces browser API calls with MCP Apps `tools/call` requests.

There is one visual source of truth. Do not hand-edit `public/chatgpt-widget.html`; run `npm run build:widget` after changing `public/index.html`.

## Architecture

```text
                         ChatGPT
                     Scout Lab plugin UI
                            │
                       MCP Apps bridge
                            │
                       /mcp tools
                            │
          ┌─────────────────┴─────────────────┐
          │                                   │
Browser URL                                ChatGPT UI
public/index.html                   public/chatgpt-widget.html
          │                                   │
          └──────────── shared Worker ─────────┘
                            │
                      REST + MCP tools
                            │
                           D1
                 ┌──────────┼──────────┐
                 │          │          │
              IG leads   Mailroom   History/
                                    Store Health
                            │
                  ChatGPT Workspace Agent
                            │
                          Gmail
```

The browser and ChatGPT versions read and write the same D1 records, so a lead moved to `Shortlist` in ChatGPT is also `Shortlist` at the browser URL, and a Mailroom refresh started from the browser appears in ChatGPT History.

## ChatGPT UI behavior

The generated ChatGPT component uses the open MCP Apps UI bridge:

- `ui/initialize` initializes the component.
- `tools/call` replaces the browser's REST requests.
- The existing Scout Lab JavaScript does not need a second rendering implementation.
- The existing FULL SCREEN button uses ChatGPT's `requestDisplayMode({ mode: "fullscreen" })` when embedded in ChatGPT.
- `setOpenInAppUrl()` points ChatGPT's external/open-in-app control at `SCOUT_PUBLIC_URL`.

## MCP tools

The `/mcp` endpoint exposes the following Scout Lab tools:

- `open_scout_lab` — opens the full interactive dashboard UI in ChatGPT.
- `get_ig_recommendations` — current IG pipeline plus freshness.
- `get_shopify_mailroom` — current saved store mail plus freshness.
- `get_task_history` — task runs, outcomes, counts, and errors.
- `get_store_health` — orders, payment issues, app alerts, freshness.
- `get_integrations` — current ChatGPT/Shopify/database connection state.
- `refresh_mailroom` — starts the real Workspace Agent mailroom flow.
- `update_ig_lead` — updates stage, fit, cost, and notes.
- `publish_mailroom_snapshot` — narrow run/nonce protected Mailroom publisher.
- `publish_ig_snapshot` — publishes completed Scout research.
- `publish_store_health` — publishes Store Health results.

The first eight support normal Scout Lab interaction. Publisher tools are intended for trusted ChatGPT/task workflows.

## Browser REST contract

The browser surface retains the v21 API contract:

- `GET /api/ig-recommendations`
- `GET /api/shopify-mailroom`
- `GET /api/store-summary`
- `GET /api/history`
- `GET /api/integrations`
- `POST /api/mailroom/refresh`
- `PATCH /api/ig-leads/:handle`
- `POST /api/task-results` (protected publisher)

## Data behavior retained from v21

- Direct database-backed feed snapshots instead of source-file publishing.
- Separate Last Researched, Last Published, and Last Checked timestamps.
- IG stages: `New → Review → Shortlist → Contacted → Outcome`.
- Product fit, estimated collaboration cost, and notes are durable and are not wiped by new research.
- History records source, trigger, status, start/finish/check timestamps, checked/added/changed counts, summaries, and errors.
- Store Health tracks orders, payment issues, and app alerts independently.
- A failed refresh preserves the last good Mailroom snapshot.
- Mailroom publisher uses a short-lived, single-use nonce tied to one task run.

## Build and validation

```text
npm install
npm run build:widget
npm run check
```

`npm run dev` and `npm run deploy` rebuild the ChatGPT widget first.

The v22 static checks verify that the generated ChatGPT UI contains the MCP Apps bridge and that the Worker exposes the required Scout Lab tools.

## Configuration

Copy variable names from `.env.example` and keep secrets out of browser code.

Required for the shared dashboard:

- `OWNER_EMAIL`
- D1 binding in `wrangler.jsonc`
- `SCOUT_PUBLIC_URL` — stable browser URL, e.g. `https://scoutlab.toughstuffgear.com`
- `SCOUT_MCP_URL` — normally `SCOUT_PUBLIC_URL + /mcp`

Required for the real Mailroom task:

- `CHATGPT_AGENT_TRIGGER_ID`
- `CHATGPT_WORKSPACE_AGENT_TOKEN`

Optional:

- `SCOUT_PUBLISH_TOKEN` for protected non-MCP publishers
- `SHOPIFY_SHOP`
- `SHOPIFY_ADMIN_TOKEN`

## ChatGPT connection

See `CHATGPT_APP_SETUP.md` for the connection and testing sequence.

## Security before public use

The UI/tool architecture is complete, but the `/mcp` endpoint should use OAuth/authorization before public distribution. Do not expose write-capable MCP tools anonymously on a public production URL. Keep Cloudflare Access (or equivalent owner auth) on the browser surface and add a supported MCP OAuth flow for ChatGPT before making the endpoint broadly discoverable.

## Files added in v22

- `public/chatgpt-widget.html` — generated ChatGPT component; do not edit directly.
- `scripts/build-chatgpt-widget.mjs` — builds the component from the normal dashboard.
- `plugin.json` — portable Agent Plugin identity/metadata.
- `mcp.json` — portable remote MCP declaration template.
- `.codex-plugin/plugin.json` — compatibility manifest.
- `CHATGPT_APP_SETUP.md` — ChatGPT test/setup steps.
- `tests/v22-dual-surface-check.mjs` — dual-surface static checks.