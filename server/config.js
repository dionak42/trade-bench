// Config accessor: prefer a user-saved setting (from the Settings UI),
// fall back to the .env value. Lets users configure their own API keys
// without editing files.
import { getSetting } from './db.js';

export function cfg(key) {
  return getSetting(key) || process.env[key] || '';
}
