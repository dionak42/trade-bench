// Trade Bench setup — cross-platform, no dependencies required.
// Run with:  npm run setup
import { existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const log = (m) => console.log(m);

log('\n🛠️  Trade Bench setup\n');

// 1. Node version — the app uses the built-in node:sqlite (Node 22+).
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`❌ Node ${process.versions.node} detected — Trade Bench needs Node 22 or newer.`);
  console.error('   Install the latest LTS from https://nodejs.org, then re-run: npm run setup\n');
  process.exit(1);
}
log(`✅ Node ${process.versions.node}`);

// 2. Create .env from the template if it doesn't exist yet.
const env = join(root, '.env');
const example = join(root, '.env.example');
if (existsSync(env)) {
  log('✅ .env already exists (left as-is)');
} else if (existsSync(example)) {
  copyFileSync(example, env);
  log('✅ Created .env from .env.example');
} else {
  log('⚠️  No .env.example found — you can add keys in ⚙ Settings instead');
}

// 3. Install dependencies (spawn without a shell — no injection surface).
log('\n📦 Installing dependencies (npm install)…\n');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const install = spawnSync(npm, ['install'], { cwd: root, stdio: 'inherit' });
if (install.status !== 0) {
  console.error('\n❌ npm install failed — fix the error above and re-run: npm run setup\n');
  process.exit(1);
}

// 4. Next steps.
log(`
✅ Setup complete!

Next steps
──────────
1. Get free API keys (paper trading — no real money is ever involved):
     • Alpaca (keep the Paper toggle on):  https://app.alpaca.markets  → API Keys
     • Finnhub (free tier):                https://finnhub.io/dashboard

2. Add your keys either way:
     • start the app and paste them into ⚙ Settings  (easiest — no file editing), OR
     • edit the .env file directly.

3. Start it:   npm start
4. Open it:    http://localhost:3000

See SETUP.md for details, always-on running (pm2), and phone/desktop access (Tailscale).
`);
