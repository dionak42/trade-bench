# Getting Started with Trade Bench

A quick guide to running your own copy. No coding required — just a few commands.
Everything here is **free**: it uses paper trading (fake money) and free data tiers.

## 1. Prerequisites

- **Node.js 22 or newer** — download the "LTS" version from https://nodejs.org.
  Check what you have with `node --version`.
- **git** — to download the code (https://git-scm.com).

## 2. Get the code

```
git clone https://github.com/dionak42/call-put-calc.git
cd call-put-calc
```

## 3. Run setup

```
npm run setup
```

This checks your Node version, installs everything the app needs, and creates a `.env`
file for your keys. If your Node is too old it'll tell you.

## 4. Get your free API keys

Two services, both free — sign up and grab a key from each:

- **Alpaca** (prices, options, paper trading) — https://app.alpaca.markets
  - Keep the **Paper** toggle on (top-left). This is fake-money trading — zero risk.
  - Open the **API Keys** panel → **Generate**. Copy the **Key ID** and the **Secret Key**
    (the secret is shown only once — copy it right away).
- **Finnhub** (news, earnings, symbol search) — https://finnhub.io/dashboard → copy your API key.

## 5. Add your keys — pick either way

- **Easiest — in the app:** run `npm start`, open http://localhost:3000, click **⚙ Settings**,
  paste your keys, and hit **Save**. There's a **Test connection** button to confirm they work.
  No file editing.
- **Or in the file:** open `.env` and paste each key next to its variable.

## 6. Start it

```
npm start
```

Then open **http://localhost:3000** in your browser. Type a ticker and you're off.

---

## Optional: keep it always-on

To run it in the background and restart after reboots (using pm2):

```
npm install -g pm2
pm2 start server/index.js --name trade-bench
pm2 save
```

(See the main [README](README.md) for the one-time reboot-startup command.)

## Optional: use it from your phone / other devices

Install **Tailscale** (https://tailscale.com) on the machine running the app *and* on your
phone/laptop, sign into the same account on both, then open the app at the host machine's
Tailscale IP (e.g. `http://100.x.x.x:3000`). On a phone you can **Add to Home Screen** for an
app-like icon. Details and the security rationale are in the [README](README.md).

## Troubleshooting

- **"Node 22 or newer" error** — update Node from https://nodejs.org, then re-run `npm run setup`.
- **Port 3000 already in use** — set a different port in `.env` (e.g. `PORT=3001`) and restart.
- **No data / keys rejected** — make sure you used **Paper** Alpaca keys and copied them fully;
  test them in **⚙ Settings → Test connection**.
- **macOS "allow incoming connections" popup** — click **Allow** so other devices can reach it.

## What it costs

Nothing. Alpaca paper trading and Finnhub's free tier are both free, and the app never touches
real money — it's for planning and practice.
