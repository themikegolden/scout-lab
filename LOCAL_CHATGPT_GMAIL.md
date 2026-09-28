# Scout Lab Mailroom — ChatGPT backend + connected Gmail

Scout Lab now supports a manual Mailroom refresh without leaving the dashboard.

## Flow

```text
REFRESH EMAIL
  -> local Node /api/mailroom/refresh
  -> ChatGPT Workspace Agent API
  -> Workspace Agent uses the Gmail account connected in ChatGPT
  -> ChatGPT finds + summarizes the latest relevant Tough Stuff Gear / Shopify mail
  -> ChatGPT sends one private structured result email back to the same Gmail account
  -> Scout Lab reads only that result relay over read-only IMAP
  -> local SQLite
  -> WebSocket refresh
  -> SHOPIFY MAILROOM tab + History
```

The source emails are searched and summarized by ChatGPT. Local IMAP is used only as a private return path for the finished result, so no public callback server or Secure MCP Tunnel is required.

## One-time setup

1. Create/publish a private Workspace Agent named **Scout Lab Mailroom**.
2. Give that agent access to the Gmail account already connected in ChatGPT.
3. Add an API channel and copy the `agtch_...` trigger ID.
4. In ChatGPT Admin > Access tokens, create a Workspace Agent access token.
5. Create a Google App Password for the same Gmail account. This app password is used only by the local Scout Lab process to read the structured result email that ChatGPT sends back to itself.
6. In the repo run:

```bash
npm run setup:mailroom
```

The setup writes all private values to `.env.local`, which is ignored by Git.

## Normal use

After the one-time setup, normal startup is:

```bash
npm start
```

Then open:

```text
http://localhost:3100
```

Press **REFRESH EMAIL**. Scout Lab remains on the Mailroom tab while ChatGPT works in the backend. When the structured relay email arrives, Scout Lab writes the result into SQLite and refreshes the dashboard automatically.

## Required Workspace Agent behavior

The repository already sends precise per-run instructions through the API trigger. The agent should be allowed to:

- read/search Gmail
- send one result email to the same Gmail account

It should not archive, delete, label, star, reply to, or otherwise modify source messages.

## Privacy

- `.env.local` is private and ignored by Git.
- Email summaries are not committed to GitHub.
- The relay email goes only to the same Gmail account.
- Scout Lab stores the resulting summaries locally in `data/scout-lab.sqlite`.
