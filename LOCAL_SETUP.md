# Scout Lab - Local Standalone Setup

Scout Lab now runs as a normal local Node.js app. Railway is not required to run it on your computer.

## What you need

- Git
- Node.js 22 LTS or newer
- A browser

## First time setup

Open Terminal, PowerShell, or Command Prompt and run:

```bash
git clone https://github.com/themikegolden/scout-lab.git
cd scout-lab
npm install
npm start
```

Then open:

```text
http://localhost:3100
```

Scout Lab will print `SCOUT LAB ONLINE` when it is ready.

## What happens on first start

- Node serves the existing Pokelab dashboard locally.
- A local SQLite database is created at `data/scout-lab.sqlite`.
- The eight baseline IG candidates from the previous Scout Lab are imported once.
- The browser connects to Node at `/live` for immediate refresh signals.
- Normal 15-second polling stays enabled as a fallback.
- No username or password is required while the server is bound to localhost.

## Start it again later

From the `scout-lab` folder:

```bash
npm start
```

Your local database remains in `data/scout-lab.sqlite` between sessions.

## Get future GitHub updates

```bash
git pull
npm install
npm start
```

## Stop Scout Lab

In the terminal running Scout Lab, press:

```text
Ctrl+C
```

## Current ChatGPT behavior

The dashboard and its local data functions do not require ChatGPT to be configured. The existing ChatGPT Workspace Agent mail-refresh path is still present, but a plain localhost server cannot receive callbacks from ChatGPT's cloud service. That button will remain unavailable until a compatible ChatGPT bridge is configured.

This does not require another hosting platform. Later options include adding a direct local OpenAI API provider, or moving the same Node app to your own VM/server and exposing its MCP endpoint securely.

## Local architecture

```text
GitHub repo
    |
    | git clone / git pull
    v
Node.js on your computer
    |-- Pokelab browser UI
    |-- REST API
    |-- WebSocket live updates
    |-- local SQLite database
    `-- optional ChatGPT bridge later

http://localhost:3100
```

## Local files that stay private

The following are ignored by Git and stay on your computer:

- `data/*.sqlite`
- `.env`
- `.env.local`
- local log files

Do not commit API keys, tokens, passwords, or your local SQLite database to GitHub.
## Make REFRESH EMAIL work locally

Scout Lab can read Gmail directly from your Mac in read-only IMAP mode. It does not send, delete, archive, label, or modify messages.

1. In your Google Account, turn on 2-Step Verification if it is not already enabled.
2. Create a Google **App Password** for Scout Lab.
3. In the Scout Lab folder, create a file named `.env.local` with:

```text
GMAIL_USER=your-gmail-address
GMAIL_APP_PASSWORD=your-16-character-app-password
```

4. Stop Scout Lab with `Control+C`.
5. Run `npm start` again.
6. Open the Mailroom tab and press **REFRESH EMAIL**.

The app password stays in `.env.local`, which is ignored by Git and is not uploaded to GitHub.
