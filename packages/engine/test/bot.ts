import { C, IN, Sim, isSolid, type Candle, type InputEvent, type SessionConfig } from '../src/index.js';
import { MAX_FRAMES } from '../src/config.js';
import { Random } from '../src/rng.js';

/**
 * A scripted player, so the tests exercise real gameplay instead of an idle run that
 * falls off the fourth candle. It is not meant to be good — it is meant to produce long,
 * varied, reproducible tapes that touch jumps, double jumps, flips, stumbles, pickups
 * and the occasional death.
 *
 * Inputs are recorded on the frame they are applied, exactly as the browser records them,
 * so the resulting tape is a legal submission.
 */
export function playBot(
  cfg: SessionConfig,
  noiseSeed = 1,
  opts: { revive?: boolean } = {},
): { tape: InputEvent[]; sim: Sim } {
  const sim = new Sim(cfg);
  const rng = new Random(noiseSeed);
  const tape: InputEvent[] = [];
  let releaseAt = -1;

  const send = (f: number, code: number) => {
    tape.push([f, code] as InputEvent);
    sim.applyInput(code);
  };

  for (let f = 0; f < MAX_FRAMES && sim.mode !== 'ended'; f++) {
    const p = sim.p;

    if (sim.mode === 'reviveOffer') {
      send(f, opts.revive ? IN.REVIVE : IN.DECLINE);
      sim.step();
      continue;
    }

    if (releaseAt === f) {
      send(f, IN.JUMP_UP);
      releaseAt = -1;
    }

    let next: Candle | null = null;
    let stand: Candle | null = null;
    for (const c of sim.world.candles) {
      if (c.i === p.standIdx) stand = c;
      if (c.x > p.x + 8 && (!next || c.x < next.x)) next = c;
    }

    const footY = p.y + C.ph;
    let wantJump = false;
    if (next) {
      const rise = footY - next.y;
      const dx = next.x - (p.x + C.pw);
      // Jump for anything taller than an auto-step, anything you would fall through,
      // and anything on the far side of a gap.
      if ((rise > C.step + 2 || !isSolid(next, p.short, p.standIdx) || next.gapped) && dx < 46) {
        wantJump = true;
      }
    }
    if (!p.ground && p.vy > 140 && p.jumps < 2) wantJump = true; // bail out of a fall

    if (wantJump && releaseAt < 0) {
      send(f, IN.JUMP_DOWN);
      releaseAt = Math.min(f + rng.int(6, 26), MAX_FRAMES - 1);
    }

    if (!sim.map.longOnly && p.flipCd <= 0 && stand?.kind === 'doji') {
      let ahead: Candle | null = null;
      for (const c of sim.world.candles) {
        if (c.x > p.x + 40 && c.x < p.x + 340 && c.kind !== 'doji' && (!ahead || c.x < ahead.x)) ahead = c;
      }
      if (ahead && !isSolid(ahead, p.short, p.standIdx)) send(f, IN.FLIP);
    }

    sim.step();
  }

  return { tape, sim };
}
