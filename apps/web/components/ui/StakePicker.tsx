'use client';

import { STAKES } from '@candle-rush/engine';
import { money, short } from '../../lib/format';

/**
 * How much of the balance is going on this run.
 *
 * Shown in the hub rather than behind a menu, because it is the decision that makes a
 * balance worth having once everything is unlocked. A guest sees nothing here — there is
 * no ledger to draw from, so there would be nothing to choose between.
 */
export function StakePicker({
  value,
  balance,
  onPick,
}: {
  value: string;
  balance: number;
  onPick: (id: string) => void;
}) {
  return (
    <div className="stakes">
      <div className="k stakelab">STAKE</div>
      <div className="stakerow">
        {STAKES.map((s) => {
          const afford = balance >= s.cost;
          const on = value === s.id;
          return (
            <button
              key={s.id}
              className={`stake${on ? ' on' : ''}${afford ? '' : ' poor'}`}
              onClick={() => afford && onPick(s.id)}
              aria-pressed={on}
              // Not `disabled`: it still has something to say, which is what it costs.
              aria-disabled={!afford}
              title={afford ? s.note : `Needs ${money(s.cost)}`}
            >
              <span className="sn">{s.name}</span>
              <span className="sm">×{s.mult}</span>
              <span className="sc">{s.cost === 0 ? 'FREE' : short(s.cost)}</span>
            </button>
          );
        })}
      </div>
      <div className="stakenote">
        {(STAKES.find((s) => s.id === value) ?? STAKES[0]!).note} Rank is always the raw
        score — the stake only decides what it pays.
      </div>
    </div>
  );
}
