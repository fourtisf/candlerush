/**
 * Browser smoke test: guest play.
 *
 * Loads the real built client, walks it to a live session, and checks that the canvas is
 * actually drawing and the simulation is actually advancing. It catches the whole class
 * of failures that unit tests on a headless engine cannot — a renderer that throws, a loop
 * that never starts, a transform that draws everything off screen.
 *
 * Run against a running web server:
 *   WEB_URL=http://localhost:3000 pnpm exec tsx test/smoke.ts
 */
import { existsSync, mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOT_DIR ?? '/tmp/candlerush-shots';

function chromiumPath(): string | undefined {
  return [process.env.CR_CHROMIUM, '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(
    (p): p is string => !!p && existsSync(p),
  );
}

/** Non-black pixel fraction: a blank canvas means the renderer silently did nothing. */
async function canvasCoverage(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cv = document.querySelector<HTMLCanvasElement>('canvas#game');
    if (!cv) return -1;
    const probe = document.createElement('canvas');
    probe.width = 160;
    probe.height = 90;
    const g = probe.getContext('2d')!;
    g.drawImage(cv, 0, 0, 160, 90);
    const { data } = g.getImageData(0, 0, 160, 90);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! + data[i + 1]! + data[i + 2]! > 60) lit++;
    }
    return lit / (data.length / 4);
  });
}

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  const exe = chromiumPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) {
      problems.push(`console: ${msg.text()}`);
    }
  });

  await page.goto(WEB_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas#game');

  const menuCoverage = await canvasCoverage(page);
  await page.screenshot({ path: `${SHOTS}/1-title.png` });

  await page.getByRole('textbox').fill('SMOKE');
  await page.getByRole('button', { name: 'Open account' }).click();
  await page.getByRole('button', { name: /Open the session/ }).waitFor({ state: 'visible' });
  await page.waitForTimeout(500); // the screen crossfade is 350ms
  await page.screenshot({ path: `${SHOTS}/2-hub.png` });

  await page.getByRole('button', { name: /Open the session/ }).click();
  await page.waitForTimeout(1500);

  // Play badly but persistently, so the run covers ground and the HUD moves.
  for (let i = 0; i < 34; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(340);
  }

  const inRunCoverage = await canvasCoverage(page);
  // Read the HUD while the run is actually in progress — the level loop below deliberately
  // plays past the end of a level, at which point the HUD is gone and the clock reads 0:00.
  const hud = await page.evaluate(() => ({
    pnl: document.querySelector('.pnl')?.textContent ?? '',
    clock: document.querySelector('.clockv')?.textContent ?? '',
    level: document.querySelector('.k.lvl')?.textContent ?? '',
    hudOn: document.querySelector('#hud')?.classList.contains('on') ?? false,
  }));
  await page.screenshot({ path: `${SHOTS}/3-run.png` });

  // Play through the end of a level so the clear panel is exercised, not just assumed.
  let sawLevelPanel = false;
  for (let i = 0; i < 60 && !sawLevelPanel; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(340);
    sawLevelPanel = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.scr.on .eyebrow')).some((n) =>
        (n.textContent ?? '').includes('CLEARED'),
      ),
    );
  }
  if (sawLevelPanel) {
    await page.waitForTimeout(700); // the screen crossfade is 350ms
    await page.screenshot({ path: `${SHOTS}/4-level.png` });
  }

  await browser.close();

  const pnl = Number(hud.pnl.replace(/[$,]/g, ''));
  const clockSeconds = (() => {
    const [m, s] = hud.clock.split(':');
    return Number(m) * 60 + Number(s);
  })();

  const checks: Array<[string, boolean, string]> = [
    ['menu canvas draws', menuCoverage > 0.2, `coverage ${menuCoverage.toFixed(3)}`],
    ['in-run canvas draws', inRunCoverage > 0.2, `coverage ${inRunCoverage.toFixed(3)}`],
    ['HUD is up', hud.hudOn, String(hud.hudOn)],
    ['P&L is accruing', pnl > 0, hud.pnl],
    ['level clock is running down', clockSeconds > 0 && clockSeconds <= 25, hud.clock],
    ['HUD shows a level', /LEVEL \d+/.test(hud.level), hud.level],
    ['the level-clear panel appears', sawLevelPanel, sawLevelPanel ? 'shown' : 'never reached a level end'],
    ['no page or console errors', problems.length === 0, problems.join(' | ') || 'clean'],
  ];

  let failed = 0;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
    if (!ok) failed++;
  }
  console.log(`\nscreenshots in ${SHOTS}`);
  if (failed) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
