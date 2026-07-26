import type { CharDef, CharId, MapDef } from '@candle-rush/engine';

/**
 * Character art, ported verbatim.
 *
 * `drawChar` is shared between the in-game player and the character-select thumbnails,
 * deliberately: one function means the picture on the shop card and the thing you control
 * can never drift apart.
 */

export const rgb = (c: readonly number[]): string => `rgb(${c[0]},${c[1]},${c[2]})`;
export const rgba = (c: readonly number[], a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
export const mix = (a: readonly number[], b: readonly number[], t: number): number[] => [
  Math.round(a[0]! + (b[0]! - a[0]!) * t),
  Math.round(a[1]! + (b[1]! - a[1]!) * t),
  Math.round(a[2]! + (b[2]! - a[2]!) * t),
];

export function mixHex(a: string, b: string, t: number): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  return rgb(mix(parse(a), parse(b), t));
}

/** Drawn centred on the origin, sized to (w, h). */
export function drawChar(
  g: CanvasRenderingContext2D,
  id: CharId | string,
  w: number,
  h: number,
  col: string,
  t: number,
): void {
  const D = '#0A0820';
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const eye = (x: number, y: number, r: number) => {
    g.fillStyle = D;
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.fill();
  };
  if (id === 'bull') {
    g.strokeStyle = col;
    g.lineWidth = w * 0.1;
    g.beginPath();
    g.moveTo(-w * 0.3, -h * 0.28);
    g.quadraticCurveTo(-w * 0.6, -h * 0.6, -w * 0.26, -h * 0.62);
    g.moveTo(w * 0.3, -h * 0.28);
    g.quadraticCurveTo(w * 0.6, -h * 0.6, w * 0.26, -h * 0.62);
    g.stroke();
    g.fillStyle = col;
    g.beginPath();
    g.roundRect(-w * 0.5, -h * 0.44, w, h * 0.88, w * 0.34);
    g.fill();
    eye(w * 0.12, -h * 0.1, w * 0.085);
    g.fillStyle = D;
    g.beginPath();
    g.roundRect(-w * 0.16, h * 0.14, w * 0.32, h * 0.09, 4);
    g.fill();
    g.strokeStyle = D;
    g.lineWidth = w * 0.055;
    g.beginPath();
    g.arc(0, h * 0.3, w * 0.1, 0, 7);
    g.stroke();
  } else if (id === 'bear') {
    g.fillStyle = col;
    g.beginPath();
    g.arc(-w * 0.34, -h * 0.4, w * 0.17, 0, 7);
    g.arc(w * 0.34, -h * 0.4, w * 0.17, 0, 7);
    g.fill();
    g.beginPath();
    g.roundRect(-w * 0.5, -h * 0.42, w, h * 0.86, w * 0.42);
    g.fill();
    eye(-w * 0.16, -h * 0.08, w * 0.075);
    eye(w * 0.16, -h * 0.08, w * 0.075);
    g.fillStyle = mixHex(col, '#FFFFFF', 0.4);
    g.beginPath();
    g.roundRect(-w * 0.2, h * 0.06, w * 0.4, h * 0.26, w * 0.18);
    g.fill();
    eye(0, h * 0.14, w * 0.08);
  } else if (id === 'fox') {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(-w * 0.44, -h * 0.3);
    g.lineTo(-w * 0.36, -h * 0.72);
    g.lineTo(-w * 0.12, -h * 0.36);
    g.closePath();
    g.moveTo(w * 0.44, -h * 0.3);
    g.lineTo(w * 0.36, -h * 0.72);
    g.lineTo(w * 0.12, -h * 0.36);
    g.fill();
    g.beginPath();
    g.moveTo(-w * 0.62, h * 0.3);
    g.quadraticCurveTo(-w * 0.92, -h * 0.1, -w * 0.52, -h * 0.24);
    g.quadraticCurveTo(-w * 0.44, h * 0.1, -w * 0.34, h * 0.34);
    g.closePath();
    g.fill();
    g.beginPath();
    g.roundRect(-w * 0.46, -h * 0.4, w * 0.92, h * 0.82, w * 0.28);
    g.fill();
    g.fillStyle = mixHex(col, '#FFFFFF', 0.55);
    g.beginPath();
    g.moveTo(w * 0.12, -h * 0.06);
    g.lineTo(w * 0.6, h * 0.06);
    g.lineTo(w * 0.12, h * 0.24);
    g.closePath();
    g.fill();
    eye(-w * 0.02, -h * 0.12, w * 0.07);
    eye(w * 0.24, -h * 0.1, w * 0.06);
  } else if (id === 'whale') {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(-w * 0.4, 0);
    g.lineTo(-w * 0.78, -h * 0.34);
    g.lineTo(-w * 0.7, h * 0.02);
    g.lineTo(-w * 0.78, h * 0.34);
    g.closePath();
    g.fill();
    g.beginPath();
    g.ellipse(0, 0, w * 0.54, h * 0.42, 0, 0, 7);
    g.fill();
    g.fillStyle = mixHex(col, '#FFFFFF', 0.45);
    g.beginPath();
    g.ellipse(w * 0.06, h * 0.16, w * 0.36, h * 0.2, 0, 0, 7);
    g.fill();
    eye(w * 0.26, -h * 0.1, w * 0.075);
    g.strokeStyle = col;
    g.lineWidth = w * 0.055;
    const s = Math.sin((t || 0) * 4) * 2;
    g.beginPath();
    g.moveTo(w * 0.06, -h * 0.44);
    g.lineTo(w * 0.02, -h * 0.66 + s);
    g.moveTo(w * 0.16, -h * 0.42);
    g.lineTo(w * 0.22, -h * 0.62 + s);
    g.stroke();
  } else if (id === 'ape') {
    g.fillStyle = col;
    g.beginPath();
    g.arc(-w * 0.5, -h * 0.02, w * 0.15, 0, 7);
    g.arc(w * 0.5, -h * 0.02, w * 0.15, 0, 7);
    g.fill();
    g.beginPath();
    g.moveTo(-w * 0.52, h * 0.44);
    g.lineTo(-w * 0.42, -h * 0.34);
    g.quadraticCurveTo(0, -h * 0.58, w * 0.42, -h * 0.34);
    g.lineTo(w * 0.52, h * 0.44);
    g.closePath();
    g.fill();
    g.fillStyle = D;
    g.beginPath();
    g.roundRect(-w * 0.34, -h * 0.24, w * 0.68, h * 0.11, 5);
    g.fill();
    eye(-w * 0.16, -h * 0.02, w * 0.07);
    eye(w * 0.16, -h * 0.02, w * 0.07);
    g.fillStyle = mixHex(col, '#FFFFFF', 0.35);
    g.beginPath();
    g.roundRect(-w * 0.24, h * 0.14, w * 0.48, h * 0.22, w * 0.14);
    g.fill();
  } else {
    // gem
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, -h * 0.54);
    g.lineTo(w * 0.5, -h * 0.14);
    g.lineTo(w * 0.3, h * 0.52);
    g.lineTo(-w * 0.3, h * 0.52);
    g.lineTo(-w * 0.5, -h * 0.14);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(10,8,32,.45)';
    g.lineWidth = w * 0.05;
    g.beginPath();
    g.moveTo(-w * 0.5, -h * 0.14);
    g.lineTo(w * 0.5, -h * 0.14);
    g.moveTo(0, -h * 0.54);
    g.lineTo(-w * 0.3, h * 0.52);
    g.moveTo(0, -h * 0.54);
    g.lineTo(w * 0.3, h * 0.52);
    g.stroke();
    eye(-w * 0.14, h * 0.06, w * 0.07);
    eye(w * 0.14, h * 0.06, w * 0.07);
  }
  g.restore();
}

/** Data URL of a character, for shop cards and the hub picker. */
export function charThumb(c: CharDef, size: number): string {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size * 2;
  const g = cv.getContext('2d')!;
  g.setTransform(2, 0, 0, 2, 0, 0);
  g.translate(size / 2, size / 2);
  drawChar(g, c.id, size * 0.62, size * 0.62, c.col, 0);
  return cv.toDataURL();
}

/** Data URL of a market's sky, for the market cards. */
export function skyThumb(m: MapDef, w: number, h: number): string {
  const cv = document.createElement('canvas');
  cv.width = w * 2;
  cv.height = h * 2;
  const g = cv.getContext('2d')!;
  g.setTransform(2, 0, 0, 2, 0, 0);
  const gr = g.createLinearGradient(0, 0, 0, h);
  const D = m.sky[1];
  [0, 0.34, 0.62, 0.9].forEach((s, i) => gr.addColorStop(s, rgb(D[i]!)));
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(10,8,26,.55)';
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  if (m.bg === 'city') {
    let x = 0;
    while (x < w) {
      const bw = rnd(5, 12);
      const bh = rnd(8, 26);
      g.fillRect(x, h - bh, bw, bh);
      x += bw + 2;
    }
  } else if (m.bg === 'peaks') {
    for (let i = 0; i < 6; i++) {
      const px = (i * w) / 5;
      g.beginPath();
      g.moveTo(px - 16, h);
      g.lineTo(px, h - rnd(14, 30));
      g.lineTo(px + 16, h);
      g.fill();
    }
  } else {
    g.beginPath();
    g.moveTo(0, h);
    for (let i = 0; i <= w; i += 6) g.lineTo(i, h - 12 - Math.sin(i * 0.12) * 7);
    g.lineTo(w, h);
    g.fill();
  }
  return cv.toDataURL();
}
