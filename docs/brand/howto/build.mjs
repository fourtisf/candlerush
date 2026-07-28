/**
 * The how-to-play banners.
 *
 * Seven cards for a thread plus one that carries the whole thing on its own, drawn from
 * the same tokens, the same figures and the same typefaces as the game — see
 * docs/brand/README.md for why the gold has to turn at 62% and why green is always the
 * candle still open.
 *
 * Run it:
 *   node docs/brand/howto/build.mjs
 *
 * Chromium does the rasterising because the alternative is hand-rolling text layout in
 * SVG, and the fonts are embedded as data URIs so this works with no network at all.
 *
 * Output: docs/brand/howto/*.png at 1600x900 — 16:9, which is what X crops an in-feed
 * image to. Anything else gets cropped for you, and usually through the headline.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { figure } from './art.mjs';

const require = createRequire(new URL('../../../apps/web/package.json', import.meta.url));
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const FONTS = join(HERE, '..', 'fonts');
const OUT = process.env.OUT_DIR ?? HERE;

const W = 1600;
const H = 900;
/**
 * Where the tape runs on a step card.
 *
 * Low enough to clear the last line of body copy: at 700 the wicks came up through it, and
 * a candle drawn across a sentence costs the sentence more than it gains the picture.
 */
const BAND = 765;

const font = (file) => readFileSync(join(FONTS, file)).toString('base64');
const BRICOLAGE = font('bricolage.woff2');
const MARTIAN = font('martian.woff2');

/** The wordmark, outlined. Same paths the client ships — see apps/web/components/ui/Wordmark.tsx. */
const WORDMARK = `<svg viewBox="0 0 695 120" class="wm" role="img" aria-label="Candle Rush">
  <defs><linearGradient id="au" x1="0" y1="0" x2=".55" y2="1">
    <stop offset="0" stop-color="#FFF8E2"/><stop offset=".18" stop-color="#FFDD8C"/>
    <stop offset=".46" stop-color="#F5B93F"/><stop offset=".62" stop-color="#D08D18"/>
    <stop offset=".82" stop-color="#F7C862"/><stop offset="1" stop-color="#FFE9AE"/>
  </linearGradient><linearGradient id="em" x1="0" y1="0" x2=".5" y2="1">
    <stop offset="0" stop-color="#B6FFE4"/><stop offset=".42" stop-color="#31EEA9"/>
    <stop offset=".78" stop-color="#0C9A66"/><stop offset="1" stop-color="#57F0BE"/>
  </linearGradient></defs>
  <g transform="translate(10 110)"><path fill="#FFF4E8" d="M34.04 1.20Q23.86 1.20 17.14 -2.71Q10.42 -6.61 7.11 -14.54Q3.79 -22.46 3.79 -34.45Q3.79 -52.38 11.49 -61.21Q19.19 -70.05 34.23 -70.05Q42.76 -70.05 48.91 -66.93Q55.06 -63.82 58.38 -57.27Q61.69 -50.72 61.69 -40.50H42.25Q42.25 -44.74 41.40 -47.73Q40.54 -50.73 38.67 -52.30Q36.81 -53.88 33.71 -53.88Q30.19 -53.88 28.17 -52.16Q26.15 -50.45 25.32 -47.23Q24.49 -44.01 24.49 -39.49V-29.31Q24.49 -24.75 25.37 -21.53Q26.25 -18.31 28.24 -16.61Q30.24 -14.92 33.65 -14.92Q36.96 -14.92 38.96 -16.42Q40.95 -17.92 41.88 -20.84Q42.81 -23.76 42.81 -27.90H61.69Q61.69 -17.98 58.48 -11.53Q55.27 -5.07 49.10 -1.94Q42.93 1.20 34.04 1.20Z M62.93 0.00 82.63 -68.80H108.28L127.98 0.00H106.52L104.33 -9.89H85.87L83.73 0.00ZM89.28 -25.19H101.02L98.28 -38.28Q98.03 -39.34 97.69 -40.94Q97.36 -42.55 97.00 -44.42Q96.64 -46.30 96.26 -48.15Q95.88 -50.00 95.57 -51.45H94.73Q94.42 -49.60 93.96 -47.28Q93.50 -44.95 93.01 -42.60Q92.53 -40.24 92.02 -38.28Z M131.49 0.00V-68.80H149.72L163.87 -45.99Q164.49 -44.95 165.44 -43.43Q166.40 -41.91 167.38 -40.29Q168.36 -38.67 168.93 -37.37L169.43 -37.48Q169.37 -39.81 169.37 -42.11Q169.37 -44.41 169.37 -45.99V-68.80H188.29V0.00H170.06L154.54 -24.33Q153.36 -26.33 152.49 -28.19Q151.62 -30.05 150.81 -31.79L150.31 -31.68Q150.36 -29.74 150.36 -27.74Q150.36 -25.75 150.36 -24.33V0.00Z M197.09 0.00V-68.80H223.48Q233.67 -68.80 240.06 -65.12Q246.45 -61.45 249.51 -53.89Q252.57 -46.34 252.57 -34.54Q252.57 -22.84 249.46 -15.17Q246.35 -7.49 239.92 -3.75Q233.48 0.00 223.29 0.00ZM217.39 -16.17H222.56Q225.16 -16.17 226.98 -17.00Q228.81 -17.84 229.87 -19.52Q230.93 -21.21 231.39 -23.75Q231.86 -26.29 231.86 -29.60V-38.49Q231.86 -41.85 231.39 -44.48Q230.93 -47.12 229.87 -48.92Q228.81 -50.73 226.98 -51.68Q225.16 -52.63 222.56 -52.63H217.39Z M259.39 0.00V-68.80H279.69V-16.75H307.69V0.00Z M312.35 0.00V-68.80H362.37V-52.63H332.65V-42.80H357.83V-27.00H332.65V-16.17H362.98V0.00Z"/></g>
  <rect x="399.3" y="0" width="10" height="120" rx="5" fill="#E0A93A" opacity=".72"/>
  <rect x="389.3" y="30" width="30" height="62" rx="9" fill="url(#em)"/>
  <g transform="translate(432.3 110)"><path fill="url(#au)" d="M5.79 0.00V-68.80H40.27Q47.97 -68.80 52.72 -65.84Q57.46 -62.88 59.66 -57.98Q61.86 -53.07 61.86 -47.23Q61.86 -41.19 59.71 -36.23Q57.55 -31.27 53.15 -27.98L63.86 0.00H41.85L34.10 -23.10H26.09V0.00ZM26.09 -38.02H36.24Q38.74 -38.02 40.04 -40.31Q41.35 -42.59 41.35 -45.90Q41.35 -48.05 40.76 -49.72Q40.17 -51.39 39.06 -52.41Q37.94 -53.43 36.24 -53.43H26.09Z M96.18 1.20Q87.33 1.20 80.98 -1.58Q74.63 -4.35 71.24 -10.26Q67.85 -16.16 67.85 -25.47V-68.80H88.15V-25.16Q88.15 -20.61 89.97 -17.74Q91.78 -14.87 96.04 -14.87Q100.34 -14.87 102.23 -17.74Q104.12 -20.61 104.12 -25.16V-68.80H124.42V-25.47Q124.42 -16.16 121.05 -10.26Q117.69 -4.35 111.39 -1.58Q105.09 1.20 96.18 1.20Z M158.82 1.20Q152.95 1.20 147.87 0.22Q142.78 -0.76 138.92 -3.21Q135.05 -5.67 132.85 -10.05Q130.65 -14.44 130.65 -21.24Q130.65 -21.44 130.65 -21.98Q130.65 -22.52 130.75 -22.92H149.99Q149.94 -22.47 149.94 -22.03Q149.94 -21.58 149.94 -21.19Q149.94 -18.38 150.91 -16.92Q151.88 -15.46 153.61 -14.96Q155.33 -14.46 157.48 -14.46Q158.45 -14.46 159.39 -14.58Q160.34 -14.70 161.19 -15.02Q162.04 -15.34 162.71 -15.89Q163.38 -16.44 163.74 -17.26Q164.11 -18.09 164.11 -19.20Q164.11 -21.10 162.74 -22.29Q161.37 -23.49 159.06 -24.38Q156.75 -25.28 153.86 -26.10Q150.97 -26.92 147.86 -27.94Q144.74 -28.96 141.85 -30.48Q138.96 -32.01 136.65 -34.33Q134.34 -36.66 132.97 -40.04Q131.61 -43.43 131.61 -48.14Q131.61 -54.14 133.73 -58.32Q135.85 -62.49 139.56 -65.07Q143.27 -67.65 147.97 -68.85Q152.66 -70.05 157.82 -70.05Q163.02 -70.05 167.59 -68.92Q172.17 -67.78 175.66 -65.37Q179.15 -62.96 181.14 -59.11Q183.14 -55.25 183.19 -49.79V-47.79H164.15V-48.57Q164.15 -50.32 163.61 -51.71Q163.06 -53.09 161.80 -53.91Q160.54 -54.72 158.28 -54.72Q156.23 -54.72 154.87 -54.16Q153.51 -53.61 152.88 -52.66Q152.26 -51.70 152.26 -50.50Q152.26 -48.51 153.63 -47.16Q155.00 -45.82 157.33 -44.90Q159.66 -43.98 162.55 -43.17Q165.44 -42.35 168.54 -41.38Q171.63 -40.41 174.52 -38.96Q177.41 -37.52 179.74 -35.29Q182.07 -33.06 183.44 -29.86Q184.81 -26.65 184.81 -22.09Q184.81 -14.06 181.52 -8.91Q178.24 -3.75 172.41 -1.27Q166.57 1.20 158.82 1.20Z M190.39 0.00V-68.80H210.69V-43.23H226.65V-68.80H246.95V0.00H226.65V-26.53H210.69V0.00Z"/></g>
</svg>`;

/**
 * A tape across the lower third, seeded per card so no two banners carry the same one.
 *
 * Clamped to a band rather than walked freely: the obvious version drifts downward and the
 * last third of the run falls off the bottom of the image.
 */
function tape(seed, mid = BAND) {
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const MID = mid;
  const SWING = 58;
  let y = MID;
  let out = '';
  for (let x = -40; x < W + 40; x += 46) {
    const next = Math.max(MID - SWING, Math.min(MID + SWING, y + (rnd() - 0.45) * 78));
    const top = Math.min(y, next);
    const h = Math.max(26, Math.abs(next - y));
    const col = next < y ? '#31EEA9' : '#FF6E8A';
    out +=
      `<rect x="${x + 10}" y="${top - 19}" width="5" height="${h + 38}" rx="2.5" fill="${col}" opacity=".13"/>` +
      `<rect x="${x}" y="${top}" width="25" height="${h}" rx="7" fill="${col}" opacity=".19"/>`;
    y = next;
  }
  return `<svg class="tape" viewBox="0 0 ${W} ${H}">${out}</svg>`;
}

const shell = (seed, body, extra = '', band = BAND) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:D;src:url(data:font/woff2;base64,${BRICOLAGE}) format('woff2');font-weight:100 900}
@font-face{font-family:M;src:url(data:font/woff2;base64,${MARTIAN}) format('woff2');font-weight:100 900}
*{margin:0;padding:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;overflow:hidden;background:#05071A;
  font-family:M,ui-monospace,monospace;color:#FFF4E8;-webkit-font-smoothing:antialiased}
.card{position:relative;width:${W}px;height:${H}px;overflow:hidden;
  background:linear-gradient(158deg,#161F49 0%,#0B1030 52%,#05071A 100%)}
.bloom{position:absolute;inset:0;background:radial-gradient(58% 46% at 50% 8%,rgba(255,206,92,.17),rgba(255,206,92,0) 70%)}
.tape{position:absolute;inset:0;width:${W}px;height:${H}px}
/* The tape runs behind the footer, and a handle printed over a candle is a handle nobody
   copies correctly. Fade to the base colour before it gets there. */
.fade{position:absolute;left:0;right:0;bottom:0;height:190px;
  background:linear-gradient(180deg,rgba(5,7,26,0),rgba(5,7,26,.84) 60%,rgba(5,7,26,.96))}
.inner{position:relative;height:100%;padding:64px 86px;display:flex;flex-direction:column}
.wm{width:330px;height:auto;display:block}
.head{display:flex;align-items:center;justify-content:space-between}
.step{font-size:15px;letter-spacing:.34em;color:rgba(255,244,232,.42)}
.foot{display:flex;align-items:center;justify-content:space-between;
  font-size:16px;letter-spacing:.26em;color:rgba(255,244,232,.4)}
.foot .site{color:#F5C05A}
.foot .x{display:flex;align-items:center;gap:11px}
.foot .x svg{width:15px;height:15px;fill:currentColor}
.kick{font-size:16px;letter-spacing:.32em;color:#FFCE5C}
h1{font-family:D;font-weight:800;letter-spacing:-.035em;line-height:.94;font-size:88px}
p{font-size:20px;line-height:2;letter-spacing:.02em;color:rgba(255,244,232,.62);max-width:660px}
.panel{background:linear-gradient(180deg,rgba(20,17,48,.72),rgba(8,6,22,.82));
  border:1px solid rgba(255,244,232,.13);border-radius:34px;
  box-shadow:0 40px 110px -40px rgba(0,0,0,.95),inset 0 1px 0 rgba(255,244,232,.07)}
${extra}</style></head><body><div class="card">
<div class="bloom"></div>${band === null ? '' : tape(seed, band) + '<div class="fade"></div>'}<div class="inner">${body}</div></div></body></html>`;

const XMARK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.59l5.24 6.93ZM17.61 20.64h2.04L6.49 3.24H4.3Z"/></svg>`;

const foot = `<div class="foot"><span class="site">CANDLERUSH.FUN</span>
  <span class="x">${XMARK}<span>@PLAYCANDLERUSH</span></span></div>`;

/* ── the cards ─────────────────────────────────────────────────────────────── */

const STEPS = [
  {
    file: '01-jump',
    art: 'jump',
    kick: 'TAP · SPACE · UP',
    title: 'Tap. Then tap\nagain, mid-air.',
    body: 'That is the entire control scheme. One tap jumps, a second tap in the air jumps again — and the second one is what clears the gaps the first cannot.',
  },
  {
    file: '02-flip',
    art: 'flip',
    kick: 'RIGHT SIDE · SHIFT',
    title: 'Green wants you long.\nRed wants you short.',
    body: 'Flip to the side the tape is printing. Stand on the wrong side of the trade and the candle you were about to land on is not there.',
  },
  {
    file: '03-perfect',
    art: 'perfect',
    kick: 'PRECISION PAYS',
    title: 'Land on the front lip.',
    body: 'The first few pixels of a candle pay a bonus and build the streak. The middle of the body just holds you up — it pays nothing.',
  },
  {
    file: '04-streak',
    art: 'streak',
    kick: 'CLIMBS TO ×10',
    title: 'Chain the landings.',
    body: 'Every clean landing multiplies the next one. Clip a candle and the multiplier halves rather than resetting, so a bad step is a setback and not the end of the run.',
  },
  {
    file: '05-hedge',
    art: 'hedge',
    kick: 'ONE PER SESSION',
    title: 'The hedge catches\nyou once.',
    body: 'Liquidation takes the hedge instead of you and puts you back on the tape. One per session. After that the next mistake is the last one.',
  },
  {
    file: '06-bell',
    art: 'bell',
    kick: 'FINAL 0:05',
    title: 'The last five seconds\npay double.',
    body: 'The tape speeds up and everything is worth twice as much. The end of a level is where the money is, and it is also where the level is hardest.',
  },
  {
    file: '07-bank-or-push',
    art: 'choice',
    kick: 'EVERY 25 SECONDS',
    title: 'Bank it, or push.',
    body: 'Clear a level and the game stops and asks. Take it and the session ends with the money banked. Push and the next level is faster, with more holes — and pays 25% more. Say nothing and it pushes for you.',
    accent: '#22E6A0',
  },
];

const stepCard = (s, i) =>
  shell(
    i + 3,
    `<div class="head">${WORDMARK}<div class="step">${String(i + 1).padStart(2, '0')} / ${String(STEPS.length).padStart(2, '0')}</div></div>
     <div class="mid">
       <div class="txt">
         <div class="kick"${s.accent ? ` style="color:${s.accent}"` : ''}>${s.kick}</div>
         <h1>${s.title.replace(/\n/g, '<br>')}</h1>
         <p>${s.body}</p>
       </div>
       <div class="panel fig">${figure(s.art, 430)}</div>
     </div>
     ${foot}`,
    `.mid{flex:1;display:flex;align-items:center;gap:70px;padding:34px 0 30px}
     .txt{flex:1;min-width:0}
     .txt h1{margin:26px 0 30px}
     .fig{width:520px;height:340px;flex:0 0 auto;display:grid;place-items:center}`,
  );

/* The one that has to work on its own: everything at a glance, for a pinned post. */
const TILES = [
  { art: 'jump', k: 'JUMP', t: 'Tap once. Tap again in the air.' },
  { art: 'flip', k: 'FLIP', t: 'Green is long. Red is short.', c: '#FF4A6B' },
  { art: 'perfect', k: 'PERFECT', t: 'The front lip pays a bonus.', c: '#FFCE5C' },
  { art: 'streak', k: 'STREAK', t: 'Chain landings up to ×10.', c: '#FFCE5C' },
  { art: 'hedge', k: 'HEDGE', t: 'One free save per session.', c: '#6FB4FF' },
  { art: 'bell', k: 'BELL', t: 'Last five seconds pay double.', c: '#FFCE5C' },
];

const master = shell(
  1,
  `<div class="head">${WORDMARK}<div class="step">HOW TO PLAY</div></div>
   <div class="lede">The terrain is a candlestick chart. Everything else follows from that.</div>
   <div class="grid">
     ${TILES.map(
       (t) => `<div class="panel tile">
       <div class="art">${figure(t.art, 186)}</div>
       <div class="tk"${t.c ? ` style="color:${t.c}"` : ''}>${t.k}</div>
       <div class="tt">${t.t}</div>
     </div>`,
     ).join('')}
   </div>
   <div class="panel hero">
     <div>
       <div class="tk" style="color:#22E6A0">EVERY 25 SECONDS</div>
       <div class="ht">Bank it, or push</div>
     </div>
     <div class="hp">Clear a level and the game stops and asks. The next one is faster and pays 25% more.</div>
   </div>
   ${foot}`,
  `.lede{margin:26px 0 24px;font-size:19px;letter-spacing:.05em;color:rgba(255,244,232,.6)}
   .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
   .tile{padding:20px 22px 22px}
   .tile .art{height:112px;display:grid;place-items:center}
   .tk{font-size:14px;letter-spacing:.28em;color:#22E6A0;margin-top:8px}
   .tt{font-family:D;font-weight:800;font-size:23px;letter-spacing:-.02em;line-height:1.25;margin-top:9px}
   .hero{margin:18px 0 22px;padding:22px 30px;display:flex;align-items:center;gap:38px}
   .ht{font-family:D;font-weight:800;font-size:38px;letter-spacing:-.03em;margin-top:7px;white-space:nowrap}
   .hp{font-size:18px;line-height:1.95;color:rgba(255,244,232,.62)}`,
  // No tape on this one. Panels cover the canvas, so wherever the band goes it survives
  // only as stray candles in the corners — which reads as a rendering fault rather than as
  // texture. The step cards have the open ground for it; this one does not.
  null,
);

/* ── render ────────────────────────────────────────────────────────────────── */

const PAGES = [['00-how-to-play', master], ...STEPS.map((s, i) => [s.file, stepCard(s, i)])];

const chromiumPath = () =>
  [process.env.CR_CHROMIUM, '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(
    (p) => !!p && existsSync(p),
  );

async function main() {
  mkdirSync(OUT, { recursive: true });
  const exe = chromiumPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  for (const [name, html] of PAGES) {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log(`${name}.png`);
  }
  await browser.close();
}

await main();
