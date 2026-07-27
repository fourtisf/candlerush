import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load `.env` into `process.env` before anything reads it.
 *
 * This used to happen by accident: `@prisma/client` calls dotenv on import to find
 * `DATABASE_URL`, so importing the database module happened to populate everything else
 * too. Depending on another package's import side effect for the JWT secret and the
 * database credentials is not a thing to leave in place — the day Prisma stops doing it,
 * or the day the import order changes, the API boots with no configuration.
 *
 * Existing values always win, so a real environment (systemd, pm2, CI, a shell export)
 * overrides the file rather than the other way round.
 */
export function loadDotEnv(file = resolve(process.cwd(), '.env')): void {
  if (!existsSync(file)) return;
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key in process.env) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnv();
