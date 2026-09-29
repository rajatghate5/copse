/**
 * The safety-number sheet - the out-of-band check that a conversation really is
 * with who it claims. Computed from both identities' public keys, identical on
 * both ends when no one is in the middle. Read it aloud together once.
 */

import { useMemo } from 'react';
import { base64ToBytes, safetyNumber } from '@copse/crypto';
import type { UserSummary } from '@copse/protocol';
import { useAuth } from '../../auth/authStore.ts';
import { Shield, Check } from '../../../lib/icons.tsx';

interface Props {
  other: UserSummary;
  onClose: () => void;
}

export function SafetyNumberSheet({ other, onClose }: Props) {
  const me = useAuth((s) => s.me!);

  const number = useMemo(() => {
    const mine = { encPub: base64ToBytes(me.keys.encPub), sigPub: base64ToBytes(me.keys.sigPub) };
    const theirs = { encPub: base64ToBytes(other.keys.encPub), sigPub: base64ToBytes(other.keys.sigPub) };
    return safetyNumber(mine, theirs);
  }, [me, other]);

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet center-text">
        <div className="shield"><Shield /></div>
        <h2>Safety number</h2>
        <p>Read this aloud with {other.displayName}. If it matches on both screens, no one is listening in.</p>
        <div className="safety-num">
          {number.split(' ').reduce<string[]>((rows, g, i) => {
            const row = Math.floor(i / 4);
            rows[row] = (rows[row] ? rows[row] + ' ' : '') + g;
            return rows;
          }, []).map((row, i) => <div key={i}>{row}</div>)}
        </div>
        <button className="btn" onClick={onClose}><Check /> It matches</button>
      </div>
    </div>
  );
}
