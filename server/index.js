// Express entrypoint. Binds 0.0.0.0 so it's reachable over Tailscale,
// serves the static frontend, mounts the API, and runs the daily snapshot jobs.
import 'dotenv/config';
import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import apiRouter from './routes.js';
import { snapshotWatchlistIv } from './ivrank.js';
import { snapshotRegime } from './regime.js';
import { getSetting } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use('/api', apiRouter);

// Static frontend.
app.use(express.static(join(__dirname, '..', 'client')));

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0'; // required for Tailscale access from another device

// Warn (don't exit) if keys are missing — they can be added in Settings.
const missing = ['ALPACA_API_KEY_ID', 'ALPACA_API_SECRET_KEY', 'FINNHUB_API_KEY']
  .filter((k) => !process.env[k] && !getSetting(k));
if (missing.length) {
  console.warn(`Missing keys: ${missing.join(', ')}. Add them in Settings (⚙) or .env.`);
}

app.listen(PORT, HOST, () => {
  console.log(`Options & News Planner running at http://${HOST}:${PORT}`);
  console.log(`Local:   http://localhost:${PORT}`);
});

// IV snapshot: run shortly after boot, then every 6 hours. The DB write is
// idempotent per day, so multiple runs just keep the latest reading current.
const SIX_HOURS = 6 * 60 * 60 * 1000;
setTimeout(() => {
  snapshotWatchlistIv().catch((e) => console.error('[iv-snapshot]', e.message));
  setInterval(() => {
    snapshotWatchlistIv().catch((e) => console.error('[iv-snapshot]', e.message));
  }, SIX_HOURS);
}, 30 * 1000);

// Market-breadth snapshot on the same cadence, so the regime panel can show
// which way breadth is moving even on days nobody opens the app. Offset from
// the IV job so the two don't hammer the data API at once.
setTimeout(() => {
  snapshotRegime().catch((e) => console.error('[regime-snapshot]', e.message));
  setInterval(() => {
    snapshotRegime().catch((e) => console.error('[regime-snapshot]', e.message));
  }, SIX_HOURS);
}, 90 * 1000);
