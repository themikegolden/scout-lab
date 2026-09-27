# Scout Lab v22 — ChatGPT App setup

## Goal

After deployment, Scout Lab has two entry points that use the same data:

- Browser: `https://YOUR-SCOUT-LAB-DOMAIN/`
- ChatGPT MCP: `https://YOUR-SCOUT-LAB-DOMAIN/mcp`

Inside ChatGPT, calling `open_scout_lab` renders the same Scout Lab dashboard as a ChatGPT UI component. The dashboard's API-shaped requests are intercepted inside the component and translated to MCP `tools/call` operations.

## 1. Deploy the shared backend and browser UI

1. Point `wrangler.jsonc` at the existing Scout Lab D1 database.
2. Apply the existing migration if it has not already been applied.
3. Set `SCOUT_PUBLIC_URL` to the stable browser URL.
4. Set `SCOUT_MCP_URL` to the same origin plus `/mcp`.
5. Configure owner/browser authentication.
6. Configure the Workspace Agent variables if REFRESH EMAIL should be live.
7. Deploy once.

Verify:

- `/healthz` returns an OK response.
- `/` renders Scout Lab.
- `/mcp` is reachable by an MCP client after authentication.

## 2. Connect the MCP server to ChatGPT

For personal testing, use ChatGPT developer mode and add the deployed `/mcp` endpoint as a personal MCP/plugin connection. The MCP server advertises the `open_scout_lab` tool and its `ui://scout-lab/dashboard-v22.html` resource.

Then start a clean ChatGPT conversation and ask:

> Open Scout Lab.

ChatGPT should call `open_scout_lab` and render the pixel-art dashboard. Use FULL SCREEN to switch the ChatGPT component into fullscreen mode.

## 3. Verify shared state

Test the same record from both surfaces:

1. Open the browser dashboard.
2. Open Scout Lab inside ChatGPT.
3. Change an IG lead stage in one surface.
4. Refresh/poll the other surface.
5. Confirm the same pipeline stage appears there.

This confirms there is one backend and not two dashboard databases.

## 4. Verify Mailroom

Before pressing REFRESH EMAIL, `GET /api/integrations` / `get_integrations` should report the ChatGPT Workspace Agent as ready.

Then:

1. Press REFRESH EMAIL in the ChatGPT dashboard or browser dashboard.
2. A History run should immediately appear as queued/running.
3. The Workspace Agent reads only the relevant Gmail/store messages.
4. The agent publishes the validated records using `publish_mailroom_snapshot` and the single-use nonce.
5. The Mailroom feed, LED sign, timestamps, and History update from the same database.

If the agent cannot read Gmail or cannot publish, the run should fail without deleting the last good Mailroom snapshot.

## 5. Normal URL / Open in app

The ChatGPT component calls `window.openai.setOpenInAppUrl()` with `SCOUT_PUBLIC_URL`. That keeps a normal browser URL available even when the dashboard is being used inside ChatGPT.

## 6. Production authorization

Before public distribution, protect the remote MCP endpoint with a supported OAuth flow. The current v22 package intentionally does not pretend anonymous MCP is production-safe. The dashboard/browser owner controls and the MCP connection should ultimately resolve to the same Tough Stuff Gear owner identity.

## Regenerating the ChatGPT component

Never edit `public/chatgpt-widget.html` by hand.

Change `public/index.html`, then run:

```text
npm run build:widget
```

That is what keeps the browser and ChatGPT interfaces visually identical.