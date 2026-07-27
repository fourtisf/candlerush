import { money } from '../../lib/format';

/**
 * A run, as an image.
 *
 * A great run currently produces nothing a person can post, which is the cheapest viral
 * loop this game is missing. Drawn on a canvas rather than asked of the server: the numbers
 * are already here, and a screenshot endpoint would be a headless browser and a queue for
 * something that takes four milliseconds in the tab that already has the data.
 *
 * 1200x630 — the Open Graph size, so the same file works as a post attachment and as a
 * link preview if it is ever uploaded.
 */

export interface CardData {
  name: string;
  score: number;
  level: number;
  candles: number;
  bestMult: number;
  cashedOut: boolean;
  url?: string;
}

const W = 1200;
const H = 630;

const GOLD = ['#FFF8E2', '#FFDD8C', '#F5B93F', '#D08D18', '#F7C862', '#FFE9AE'];
const EM = ['#B6FFE4', '#31EEA9', '#0C9A66', '#57F0BE'];

function metal(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, stops: string[]) {
  const grad = g.createLinearGradient(x, y, x + w * 0.55, y + h);
  stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), c));
  return grad;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** The mark, drawn from the same geometry as docs/brand/svg/vault.svg. */
function vault(g: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const s = size / 512;
  g.save();
  g.translate(cx - size / 2, cy - size / 2);
  g.scale(s, s);
  const tile = metal(g, 0, 0, 512, 512, ['#1B2657', '#0B1030', '#05071A']);
  g.fillStyle = tile;
  roundRect(g, 0, 0, 512, 512, 118);
  g.fill();
  g.fillStyle = '#C8901E';
  roundRect(g, 181, 72, 22, 372, 11);
  g.fill();
  g.fillStyle = metal(g, 128, 150, 128, 240, GOLD);
  roundRect(g, 128, 150, 128, 240, 38);
  g.fill();
  g.fillStyle = 'rgba(49,238,169,.6)';
  roundRect(g, 330, 120, 18, 288, 9);
  g.fill();
  g.fillStyle = metal(g, 292, 182, 94, 170, EM);
  roundRect(g, 292, 182, 94, 170, 28);
  g.fill();
  g.restore();
}

/**
 * Render the card. Returns a blob so the caller can hand it straight to a download or to
 * the share sheet without re-encoding it.
 */
export async function drawShareCard(data: CardData): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  if (!g) return null;

  const bg = g.createLinearGradient(W * 0.2, 0, W * 0.8, H);
  bg.addColorStop(0, '#141C42');
  bg.addColorStop(0.55, '#0B1030');
  bg.addColorStop(1, '#05071A');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  const bloom = g.createRadialGradient(W / 2, H * 0.16, 0, W / 2, H * 0.16, W * 0.62);
  bloom.addColorStop(0, 'rgba(255,206,92,.16)');
  bloom.addColorStop(1, 'rgba(255,206,92,0)');
  g.fillStyle = bloom;
  g.fillRect(0, 0, W, H);

  // A tape along the bottom, from the run's own numbers so two cards never match.
  let seed = (data.score ^ (data.level * 7919) ^ (data.candles * 104729)) >>> 0;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Clamped so the band stays on the canvas. The obvious version walks the y downward and
  // the last third of the tape falls out of the bottom right corner.
  const BAND = { mid: 556, swing: 34, lo: 0, hi: 0 };
  BAND.lo = BAND.mid - BAND.swing;
  BAND.hi = BAND.mid + BAND.swing;
  let y = BAND.mid;
  for (let x = -20; x < W + 20; x += 34) {
    const move = (rnd() - 0.45) * 52;
    const next = Math.max(BAND.lo, Math.min(BAND.hi, y + move));
    const top = Math.min(y, next);
    const h = Math.max(20, Math.abs(next - y));
    g.globalAlpha = 0.2;
    g.fillStyle = next < y ? '#31EEA9' : '#FF6E8A';
    // Wick first, so these read as candles rather than as a row of pills.
    roundRect(g, x + 7, top - 13, 4, h + 26, 2);
    g.fill();
    g.globalAlpha = 0.28;
    roundRect(g, x, top, 18, h, 5);
    g.fill();
    g.globalAlpha = 1;
    y = next;
  }

  vault(g, 122, 128, 108);

  g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(255,244,232,.5)';
  g.font = '500 20px "Martian Mono", ui-monospace, monospace';
  g.letterSpacing = '6px';
  g.fillText(data.cashedOut ? 'CASHED OUT' : 'LIQUIDATED', 196, 112);
  g.fillStyle = '#FFF4E8';
  g.font = '700 30px "Martian Mono", ui-monospace, monospace';
  g.letterSpacing = '2px';
  g.fillText(data.name.toUpperCase().slice(0, 14), 196, 156);

  g.letterSpacing = '0px';
  g.fillStyle = 'rgba(255,244,232,.5)';
  g.font = '500 22px "Martian Mono", ui-monospace, monospace';
  g.letterSpacing = '8px';
  g.fillText('SCORE', 84, 268);

  g.letterSpacing = '-4px';
  g.font = '800 148px Archivo, system-ui, sans-serif';
  g.fillStyle = metal(g, 84, 290, 700, 130, GOLD);
  g.fillText(money(data.score), 80, 400);

  const stats: [string, string][] = [
    ['LEVEL', String(data.level)],
    ['CANDLES', String(data.candles)],
    ['BEST STREAK', `x${data.bestMult}`],
  ];
  stats.forEach(([label, val], i) => {
    const x = 84 + i * 250;
    g.letterSpacing = '0px';
    g.font = '800 44px Archivo, system-ui, sans-serif';
    g.fillStyle = '#FFF4E8';
    g.fillText(val, x, 480);
    g.font = '500 17px "Martian Mono", ui-monospace, monospace';
    g.letterSpacing = '5px';
    g.fillStyle = 'rgba(255,244,232,.45)';
    g.fillText(label, x, 508);
  });

  if (data.url) {
    g.font = '500 19px "Martian Mono", ui-monospace, monospace';
    g.letterSpacing = '7px';
    g.fillStyle = '#F5C05A';
    const t = data.url.toUpperCase();
    g.fillText(t, W - 84 - g.measureText(t).width, 508);
  }

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/**
 * Hand the card to the player.
 *
 * The share sheet where there is one — that is the whole point on a phone — and a download
 * everywhere else. Reports which one happened so the caller can say something true.
 */
export async function shareCard(blob: Blob, name: string): Promise<'shared' | 'saved' | 'failed'> {
  const file = new File([blob], `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-candlerush.png`, {
    type: 'image/png',
  });
  try {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Candle Rush' });
      return 'shared';
    }
  } catch {
    // Cancelled or unsupported. Fall through to the download rather than saying nothing.
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
    return 'saved';
  } catch {
    return 'failed';
  }
}
