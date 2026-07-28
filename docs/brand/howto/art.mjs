/**
 * The diagrams, drawn once and used everywhere.
 *
 * These are the same six figures the in-game tutorial draws — see
 * apps/web/components/ui/HowToPlay.tsx. Sharing the shapes is the point: somebody who
 * learns the game from a post on X should recognise the panel they meet in the game, and a
 * mechanic that is redrawn twice ends up explained two different ways.
 *
 * Every figure is authored in a 120x64 box and scaled by the caller, so a banner and a
 * 40px card get the same geometry rather than two drawings that drifted apart.
 */

const C = {
  ink: '#FFF4E8',
  gold: '#FFCE5C',
  bull: '#22E6A0',
  bear: '#FF4A6B',
  ice: '#6FB4FF',
  stone: '#4A4436',
};

const cap = 'stroke-linecap="round" stroke-linejoin="round" fill="none"';

/** Jump: a dotted arc from a dead candle to a live one, the trader at the apex. */
const jump = `
  <rect x="4" y="34" width="30" height="26" rx="6" fill="${C.stone}"/>
  <rect x="86" y="26" width="30" height="34" rx="6" fill="${C.bull}"/>
  <path d="M26 30 C 42 2, 78 2, 94 20" stroke="${C.gold}" stroke-width="2.6" stroke-dasharray="1 7" ${cap}/>
  <rect x="50" y="2" width="20" height="20" rx="6" fill="${C.gold}"/>`;

/** Flip: green wants you long, red wants you short. */
const flip = `
  <rect x="10" y="16" width="26" height="34" rx="6" fill="${C.bull}"/>
  <path d="M23 8v10M23 50v8" stroke="${C.bull}" stroke-width="3" opacity=".5" ${cap}/>
  <rect x="84" y="16" width="26" height="34" rx="6" fill="${C.bear}"/>
  <path d="M97 8v10M97 50v8" stroke="${C.bear}" stroke-width="3" opacity=".5" ${cap}/>
  <path d="M46 32h26M64 24l8 8-8 8" stroke="${C.ink}" stroke-width="3" opacity=".7" ${cap}/>
  <text x="23" y="63" fill="${C.bull}" font-size="9" text-anchor="middle" font-family="monospace">LONG</text>
  <text x="97" y="63" fill="${C.bear}" font-size="9" text-anchor="middle" font-family="monospace">SHORT</text>`;

/**
 * Perfect: land on the front lip, not the middle.
 *
 * Labelled, unlike the others. Without them this is a cream square next to a gold stripe
 * and the one thing it has to teach — which part of the candle pays — is exactly the part
 * a reader has to guess.
 */
const perfect = `
  <rect x="30" y="26" width="70" height="30" rx="7" fill="${C.stone}"/>
  <rect x="30" y="26" width="13" height="30" rx="6" fill="${C.gold}"/>
  <rect x="26" y="2" width="20" height="18" rx="5" fill="${C.ink}"/>
  <path d="M36 21v4" stroke="${C.gold}" stroke-width="2.4" stroke-dasharray="1 4" ${cap}/>
  <text x="36" y="63" fill="${C.gold}" font-size="9" text-anchor="middle" font-family="monospace">LIP</text>
  <text x="74" y="63" fill="rgba(255,244,232,.4)" font-size="9" text-anchor="middle" font-family="monospace">BODY</text>`;

/** Streak: it climbs while you keep landing. */
const streak = [
  ['×2', 4, 0.45],
  ['×5', 44, 0.7],
  ['×10', 84, 1],
]
  .map(
    ([t, x, o]) => `<g opacity="${o}">
      <rect x="${x}" y="18" width="34" height="28" rx="8" fill="${C.gold}" opacity=".16"/>
      <text x="${x + 17}" y="37" fill="${C.gold}" font-size="14" text-anchor="middle" font-family="monospace">${t}</text>
    </g>`,
  )
  .join('');

/** Hedge: one free save, and it catches you. */
const hedge = `
  <rect x="50" y="2" width="20" height="20" rx="6" fill="${C.ink}"/>
  <path d="M60 24v8" stroke="${C.ink}" stroke-width="3" opacity=".5" ${cap}/>
  <path d="M36 36 h48 v6 c0 10 -12 18 -24 20 c-12 -2 -24 -10 -24 -20 z" fill="${C.ice}" opacity=".85"/>`;

/**
 * Bell: the last five seconds pay double.
 *
 * The bar underneath is the level, with the lit slice at the end. Two numbers alone do not
 * say *when* — the bar is what makes it the end of something.
 */
const bell = `
  <text x="6" y="32" fill="${C.gold}" font-size="24" font-family="monospace">0:05</text>
  <text x="88" y="32" fill="${C.gold}" font-size="22" font-family="monospace">×2</text>
  <rect x="6" y="44" width="108" height="7" rx="3.5" fill="${C.gold}" opacity=".17"/>
  <rect x="92" y="44" width="22" height="7" rx="3.5" fill="${C.gold}"/>`;

/** Bank or push: the choice the game stops to ask, in the words the buttons actually use. */
const choice = `
  <rect x="4" y="18" width="46" height="28" rx="9" fill="none" stroke="${C.gold}" stroke-width="2.4"/>
  <text x="27" y="36" fill="${C.gold}" font-size="10" text-anchor="middle" font-family="monospace">BACK</text>
  <rect x="56" y="18" width="60" height="28" rx="9" fill="${C.bull}"/>
  <text x="86" y="36" fill="#04231A" font-size="9" text-anchor="middle" font-family="monospace">CONTINUE</text>`;

export const ART = { jump, flip, perfect, streak, hedge, bell, choice };

/** Wrap a figure in its own svg at whatever width the layout wants. */
export const figure = (name, width) =>
  `<svg viewBox="0 0 120 64" width="${width}" height="${(width * 64) / 120}" aria-hidden="true">${ART[name]}</svg>`;
