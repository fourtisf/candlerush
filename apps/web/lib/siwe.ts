import { createSiweMessage } from 'viem/siwe';
import type { Address } from 'viem';
import { api } from './api';
import { robinhoodChain } from './wagmi';

/**
 * Sign-In with Ethereum.
 *
 * The nonce comes from the server and is single-use, and the message names our domain,
 * so a signature harvested by another site cannot be replayed here. The prototype's
 * `eth_requestAccounts` only asked the wallet which address it would like to claim.
 */
export async function signIn(
  address: Address,
  signMessage: (args: { account: Address; message: string }) => Promise<string>,
): Promise<{ playerId: string; name: string; balance: number }> {
  const { nonce } = await api.nonce(address);

  const message = createSiweMessage({
    address,
    chainId: robinhoodChain.id,
    domain: process.env.NEXT_PUBLIC_SIWE_DOMAIN ?? window.location.host,
    nonce,
    uri: process.env.NEXT_PUBLIC_SIWE_URI ?? window.location.origin,
    version: '1',
    statement: 'Sign in to Candle Rush.',
    issuedAt: new Date(),
    expirationTime: new Date(Date.now() + 5 * 60 * 1000),
  });

  const signature = await signMessage({ account: address, message });
  const { player, balance } = await api.verify(message, signature);
  return { playerId: player.id, name: player.name, balance };
}
