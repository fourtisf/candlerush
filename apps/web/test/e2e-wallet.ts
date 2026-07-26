/**
 * End-to-end: wallet sign-in, a real session, and a server-validated score.
 *
 * This is the one test that exercises the actual claim the architecture makes — that a
 * browser can play a run, send nothing but a seed's worth of button presses, and have the
 * server independently arrive at the same number. It signs a real SIWE message with a real
 * key through a mock EIP-1193 provider, plays until the run ends, and then checks that the
 * server's score and the browser's score agree exactly.
 *
 * It takes as long as a session does, so it is not part of `pnpm test`. Run it against a
 * live stack:
 *   API_URL=http://localhost:4000 WEB_URL=http://localhost:3000 pnpm exec tsx test/e2e-wallet.ts
 *
 * The API must be running with SESSION_MIN_ELAPSED_MS low enough for a short run to settle.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { privateKeyToAccount } from 'viem/accounts';

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000';
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const RUN_TIMEOUT_MS = 140_000;

interface SettledSession {
  status: string;
  serverScore: number;
  clientScore: number;
  serverDigest: string;
  clientDigest: string;
  balance: number;
  inputCount: number;
  frames: number;
  /** Sessions settled for this player, and the sum of the scores the server computed. */
  submitted: number;
  sumScores: number;
  entries: number;
}

function psql(sql: string): string {
  return execFileSync('psql', [DATABASE_URL, '-A', '-t', '-F', '|', '-c', sql], {
    encoding: 'utf8',
  }).trim();
}

/** Start from nothing so the run's own numbers can be asserted rather than a running total. */
function resetPlayer(address: string): void {
  if (!DATABASE_URL) return;
  try {
    psql(`
      DELETE FROM "LedgerEntry" WHERE "playerId" IN (SELECT id FROM "Player" WHERE address = '${address}');
      DELETE FROM "Session" WHERE "playerId" IN (SELECT id FROM "Player" WHERE address = '${address}');
      DELETE FROM "Player" WHERE address = '${address}';`);
  } catch {
    // No database reachable; the server-side assertions will be skipped anyway.
  }
}

/** The server's own record, read straight from the rows it wrote. */
function readSettledSession(address: string): SettledSession | null {
  if (!DATABASE_URL) return null;
  const sql = `
    SELECT s.status, s."serverScore", s."clientScore", s."serverDigest", s."clientDigest",
           s."inputCount", s.frames,
           COALESCE((SELECT SUM(amount) FROM "LedgerEntry" l WHERE l."playerId" = p.id), 0) AS balance,
           (SELECT COUNT(*) FROM "Session" x WHERE x."playerId" = p.id AND x.status = 'SUBMITTED') AS submitted,
           (SELECT COALESCE(SUM(x."serverScore"), 0) FROM "Session" x
              WHERE x."playerId" = p.id AND x.status = 'SUBMITTED') AS sum_scores,
           (SELECT COUNT(*) FROM "LedgerEntry" l WHERE l."playerId" = p.id) AS entries
    FROM "Session" s JOIN "Player" p ON p.id = s."playerId"
    WHERE p.address = '${address}'
    ORDER BY s."issuedAt" DESC LIMIT 1`;
  try {
    const out = psql(sql);
    if (!out) return null;
    const [status, serverScore, clientScore, serverDigest, clientDigest, inputCount, frames, balance,
      submitted, sumScores, entries] = out.split('|');
    return {
      status: status ?? '',
      serverScore: Number(serverScore),
      clientScore: Number(clientScore),
      serverDigest: serverDigest ?? '',
      clientDigest: clientDigest ?? '',
      inputCount: Number(inputCount),
      frames: Number(frames),
      balance: Number(balance),
      submitted: Number(submitted),
      sumScores: Number(sumScores),
      entries: Number(entries),
    };
  } catch {
    return null;
  }
}

// A throwaway key. It signs a message and nothing else; it never holds anything.
const key = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const account = privateKeyToAccount(key);

function chromiumPath(): string | undefined {
  return [process.env.CR_CHROMIUM, '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(
    (p): p is string => !!p && existsSync(p),
  );
}

async function main(): Promise<void> {
  resetPlayer(account.address.toLowerCase());

  const exe = chromiumPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // The signing half of the mock wallet lives in Node, where viem already is.
  await page.exposeFunction('__mockSign', async (message: string) =>
    account.signMessage({ message }),
  );

  await page.addInitScript(
    ({ address, chainIdHex }: { address: string; chainIdHex: string }) => {
      type Handler = (...args: unknown[]) => void;
      const listeners = new Map<string, Set<Handler>>();
      const provider = {
        isMetaMask: true,
        async request({ method, params }: { method: string; params?: unknown[] }) {
          switch (method) {
            case 'eth_requestAccounts':
            case 'eth_accounts':
              return [address];
            case 'eth_chainId':
              return chainIdHex;
            case 'net_version':
              return String(parseInt(chainIdHex, 16));
            case 'personal_sign': {
              // params: [hexMessage, address]
              const hex = (params?.[0] as string) ?? '0x';
              const bytes = hex.slice(2).match(/../g) ?? [];
              const text = new TextDecoder().decode(Uint8Array.from(bytes, (b) => parseInt(b, 16)));
              return (window as unknown as { __mockSign: (m: string) => Promise<string> }).__mockSign(text);
            }
            case 'wallet_switchEthereumChain':
              return null;
            default:
              throw Object.assign(new Error(`unsupported method ${method}`), { code: 4200 });
          }
        },
        on(event: string, handler: Handler) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(handler);
        },
        removeListener(event: string, handler: Handler) {
          listeners.get(event)?.delete(handler);
        },
      };
      Object.defineProperty(window, 'ethereum', { value: provider, writable: true, configurable: true });
    },
    { address: account.address, chainIdHex: '0x7a69' },
  );

  await page.goto(WEB_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas#game');

  await page.getByRole('textbox').fill('E2E');
  await page.getByRole('button', { name: /tap to connect/ }).click();
  await page.getByRole('button', { name: /signed in/ }).waitFor({ timeout: 30_000 });
  console.log(`✓ signed in as ${account.address}`);

  await page.getByRole('button', { name: 'Open account' }).click();
  await page.getByRole('button', { name: /Open the session/ }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /Open the session/ }).click();
  await page.waitForFunction(() => document.querySelector('#hud')?.classList.contains('on'), null, {
    timeout: 15_000,
  });
  console.log('✓ session issued and running');

  // Play a little, then stop — a gap will finish the job, or the bell will.
  const started = Date.now();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
  }
  await page.waitForSelector('.credit', { timeout: RUN_TIMEOUT_MS });
  await page.waitForFunction(
    () => !document.querySelector('.credit')?.textContent?.includes('VALIDATING'),
    null,
    { timeout: 30_000 },
  );
  console.log(`✓ run finished and submitted after ${((Date.now() - started) / 1000).toFixed(0)}s`);

  // Scope to the panel that is actually on screen: every screen stays mounted at opacity 0,
  // so a bare `.big` finds the hidden revive panel first.
  const shown = await page.evaluate(() => {
    const panel = document.querySelector('.scr.on');
    return {
      score: panel?.querySelector('.big')?.textContent ?? '',
      credit: panel?.querySelector('.credit')?.textContent ?? '',
      candles: panel?.querySelector('.st .v')?.textContent ?? '',
      error: panel?.querySelector('.err')?.textContent ?? '',
      unranked: !!panel?.querySelector('.unranked'),
    };
  });
  await page.screenshot({ path: '/tmp/candlerush-shots/4-results.png' });
  await browser.close();

  // Ask the database what the server actually recorded, independently of the page. Going
  // straight to Postgres rather than adding a test-only endpoint keeps the API surface honest.
  const server = readSettledSession(account.address.toLowerCase());

  const shownScore = Number(shown.score.replace(/[$,]/g, ''));
  const checks: Array<[string, boolean, string]> = [
    ['no page errors', errors.length === 0, errors.join(' | ') || 'clean'],
    ['results screen shows a credited score', shownScore > 0 && shown.credit.includes('CREDITED'), `${shown.score} / ${shown.credit}`],
    ['session was ranked, not treated as a guest run', !shown.unranked, shown.unranked ? 'marked unranked' : 'ranked'],
    ['no submission error', !shown.error, shown.error || 'none'],
  ];
  if (server) {
    checks.push(
      ['server settled the session', server.status === 'SUBMITTED', server.status],
      [
        'server score matches what the browser showed',
        server.serverScore === shownScore,
        `${server.serverScore} vs ${shownScore}`,
      ],
      [
        'browser and server replays agree exactly',
        server.serverScore === server.clientScore && server.serverDigest === server.clientDigest,
        `score ${server.clientScore}/${server.serverScore}, digest ${server.clientDigest}/${server.serverDigest}`,
      ],
      [
        'balance is the ledger sum, and the ledger is one entry per settled session',
        server.balance === server.sumScores && server.entries === server.submitted,
        `balance ${server.balance}, ${server.entries} entries across ${server.submitted} sessions`,
      ],
      ['the tape is small', server.inputCount < 500, `${server.inputCount} inputs over ${server.frames} frames`],
    );
  } else {
    console.log('· server-side assertions skipped (set DATABASE_URL to enable them)');
  }

  let failed = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
    if (!ok) failed++;
  }
  if (failed) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
