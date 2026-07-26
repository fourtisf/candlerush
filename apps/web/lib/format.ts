export const money = (n: number): string =>
  (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');

export const short = (n: number): string =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;

export const mmss = (s: number): string =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const shortAddress = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;
