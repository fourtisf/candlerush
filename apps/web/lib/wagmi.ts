// `injected` is re-exported from wagmi's root. Pulling it from `wagmi/connectors`
// instead drags in the whole connector barrel — Coinbase, Base account, WalletConnect —
// which is a large bundle and a set of broken optional dependencies for a game that only
// needs whatever wallet the browser already has.
import { createConfig, http, injected } from 'wagmi';
import { defineChain } from 'viem';

/**
 * Robinhood Chain (Arbitrum Orbit L2, ETH gas, EVM).
 *
 * The chain id comes from the environment, not from this file. The handoff is explicit
 * that it must be taken from https://docs.robinhood.com/chain rather than from memory,
 * and getting it wrong means signing a message scoped to the wrong network.
 */
const chainId = Number(process.env.NEXT_PUBLIC_RHC_CHAIN_ID ?? 0);
const rpcUrl = process.env.NEXT_PUBLIC_RHC_RPC_URL ?? '';

export const chainConfigured = chainId > 0;

export const robinhoodChain = defineChain({
  id: chainConfigured ? chainId : 1,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: rpcUrl ? [rpcUrl] : [] } },
});

export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: [injected()],
  transports: { [robinhoodChain.id]: http(rpcUrl || undefined) },
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
