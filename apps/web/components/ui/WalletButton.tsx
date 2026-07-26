'use client';

import { useState } from 'react';
import { useAccount as useWagmiAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi';
import { api } from '../../lib/api';
import { useAccount } from '../../lib/account';
import { shortAddress } from '../../lib/format';
import { clearGuest, loadGuest } from '../../lib/guest';
import { signIn } from '../../lib/siwe';
import { chainConfigured } from '../../lib/wagmi';

/**
 * Connect, sign, and carry guest progress over.
 *
 * Connecting a wallet is not signing in. The address a wallet hands over is a claim;
 * only the signature over a server nonce turns it into an account.
 */
export function WalletButton({ onError }: { onError: (message: string) => void }) {
  const { account, signedIn, signOut, refresh } = useAccount();
  const { address, isConnected } = useWagmiAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);

  const signedInAlready = account.mode === 'player';

  async function handle(): Promise<void> {
    if (busy) return;
    if (signedInAlready) {
      setBusy(true);
      try {
        await signOut();
        await disconnectAsync().catch(() => undefined);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!chainConfigured) {
      onError('Chain is not configured. Set NEXT_PUBLIC_RHC_CHAIN_ID from the Robinhood Chain docs.');
      return;
    }
    setBusy(true);
    try {
      let addr = address;
      if (!isConnected || !addr) {
        const connector = connectors[0];
        if (!connector) {
          onError('No wallet found in this browser.');
          return;
        }
        const res = await connectAsync({ connector });
        addr = res.accounts[0];
      }
      if (!addr) {
        onError('No account was returned by the wallet.');
        return;
      }

      await signIn(addr, ({ message }) => signMessageAsync({ account: addr!, message }));

      // Carry local progress over exactly once, into an account that has none. The server
      // caps it and enforces the once — this is only the offer.
      const guest = loadGuest();
      if (guest.balance > 0) {
        try {
          const migrated = await api.migrateGuest(guest.balance);
          signedIn(migrated.player, migrated.balance);
          clearGuest();
        } catch {
          await refresh(); // the account already had a balance; nothing to carry
        }
      } else {
        await refresh();
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Wallet sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  const label = signedInAlready
    ? `${shortAddress(account.address ?? '')} · signed in`
    : isConnected && address
      ? `${shortAddress(address)} — tap to sign in`
      : 'Not connected — tap to connect';

  return (
    <button className={`wal${signedInAlready ? ' ok' : ''}${busy ? ' busy' : ''}`} onClick={handle}>
      <span className="dot" />
      <span className="lab">
        <span className="l1">WALLET</span>
        <span className="l2">{busy ? 'Waiting for your wallet…' : label}</span>
      </span>
    </button>
  );
}
