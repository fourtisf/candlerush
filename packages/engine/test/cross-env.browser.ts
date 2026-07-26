/**
 * Cross-environment determinism: generate tapes in a real browser, replay them in Node,
 * and require the scores and the final-state digests to match exactly.
 *
 * This is the test that actually protects the ledger. Everything else checks that the
 * engine agrees with itself; this checks that Chromium's JIT and Node's JIT agree about
 * the same IEEE-754 doubles in the same order, which is the assumption the entire
 * score-integrity design rests on.
 *
 * Run: pnpm --filter @candle-rush/engine test:browser
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { ENGINE_VERSION, runReplay, type InputEvent, type MapId, type CharId } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

const MAPS: MapId[] = ['dawn', 'night', 'red', 'gold'];
const CHARS: CharId[] = ['bull', 'bear', 'fox', 'whale', 'ape', 'gem'];
const CASES = 50;

/**
 * CI images often ship a Chromium that does not match the Playwright build number.
 * Point CR_CHROMIUM at a binary to use it; otherwise fall back to Playwright's own.
 */
function chromiumPath(): string | undefined {
  const candidates = [
    process.env.CR_CHROMIUM,
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p));
}

interface BrowserRun {
  tape: InputEvent[];
  digest: string;
  score: number;
  frames: number;
  cleared: number;
}

async function main(): Promise<void> {
  const bundled = await build({
    entryPoints: [resolve(here, 'browser-entry.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'warning',
  });
  const code = bundled.outputFiles[0]!.text;

  const exe = chromiumPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset="utf-8"><title>engine</title>');
  await page.addScriptTag({ content: code });

  // If the engine touches unseeded randomness anywhere, this makes it loud instead of
  // making it a rounding error that shows up as a leaderboard dispute six weeks later.
  await page.evaluate(() => {
    (globalThis as unknown as { __rngGuard: boolean }).__rngGuard = true;
    Math.random = () => {
      throw new Error('engine called Math.random — gameplay randomness must be seeded');
    };
  });

  const cases = Array.from({ length: CASES }, (_, i) => ({
    seed: 1000 + i * 7919,
    mapId: MAPS[i % MAPS.length]!,
    charId: CHARS[i % CHARS.length]!,
    handicap: (i % 5) / 4,
    engineVersion: ENGINE_VERSION,
    noise: i + 1,
  }));

  const browserRuns: BrowserRun[] = await page.evaluate((cs) => {
    const CR = (globalThis as unknown as { CR: { play: (c: unknown, n: number) => BrowserRun } }).CR;
    return cs.map(({ noise, ...cfg }) => CR.play(cfg, noise));
  }, cases);

  await browser.close();

  let failures = 0;
  let totalFrames = 0;
  let totalInputs = 0;
  for (let i = 0; i < cases.length; i++) {
    const { noise: _noise, ...cfg } = cases[i]!;
    const web = browserRuns[i]!;
    const node = runReplay({ ...cfg, inputs: web.tape });
    totalFrames += web.frames;
    totalInputs += web.tape.length;

    const problems: string[] = [];
    if (!node.ok) problems.push(`node rejected the tape: ${node.error} ${node.errorDetail ?? ''}`);
    if (node.score !== web.score) problems.push(`score ${node.score} != ${web.score}`);
    if (node.digest !== web.digest) problems.push(`digest ${node.digest} != ${web.digest}`);
    if (node.frames !== web.frames) problems.push(`frames ${node.frames} != ${web.frames}`);
    if (node.candles !== web.cleared) problems.push(`candles ${node.candles} != ${web.cleared}`);

    if (problems.length) {
      failures++;
      console.error(`✗ ${cfg.mapId}/${cfg.charId} seed=${cfg.seed} h=${cfg.handicap}`);
      for (const p of problems) console.error(`    ${p}`);
    }
  }

  const avgInputs = Math.round(totalInputs / cases.length);
  if (failures) {
    console.error(`\n${failures}/${cases.length} cross-environment mismatches. Determinism is broken.`);
    process.exit(1);
  }
  console.log(
    `✓ ${cases.length} browser tapes replayed in Node with identical scores and digests` +
      ` (${totalFrames} frames, ~${avgInputs} inputs per tape)`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
