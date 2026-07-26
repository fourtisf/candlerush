import { randomBytes } from 'node:crypto';
import { createPublicClient, defineChain, http, isAddress, recoverMessageAddress, type Hex } from 'viem';
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import { env } from '../env.js';
import { redis } from '../redis.js';

/**
 * Sign-In with Ethereum (EIP-4361).
 *
 * The prototype's `eth_requestAccounts` proves nothing: it asks the wallet which address
 * it would like to claim and believes the answer. Anyone can claim any address. This asks
 * for a signature over a message that names our domain and a single-use server nonce, and
 * recovers the signer from it.
 */

const NONCE_TTL = 300; // 5 minutes
const nonceKey = (nonce: string) => `siwe:nonce:${nonce}`;

/** Atomic consume: read the bound address and delete in one round trip. */
const CONSUME = `local v = redis.call('GET', KEYS[1]) if v then redis.call('DEL', KEYS[1]) end return v`;

export class SiweError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'BAD_ADDRESS'
      | 'BAD_MESSAGE'
      | 'BAD_DOMAIN'
      | 'BAD_CHAIN'
      | 'BAD_NONCE'
      | 'EXPIRED'
      | 'BAD_SIGNATURE',
  ) {
    super(message);
    this.name = 'SiweError';
  }
}

export function normaliseAddress(address: string): string {
  if (!isAddress(address)) throw new SiweError(`not an address: ${address}`, 'BAD_ADDRESS');
  return address.toLowerCase();
}

export async function issueNonce(address: string): Promise<string> {
  const addr = normaliseAddress(address);
  // EIP-4361 requires at least 8 alphanumeric characters.
  const nonce = randomBytes(16).toString('hex');
  await redis().set(nonceKey(nonce), addr, 'EX', NONCE_TTL);
  return nonce;
}

/**
 * The chain the signature must claim. Chain id and RPC come from the environment
 * because the handoff says to take them from https://docs.robinhood.com/chain rather
 * than from memory — a wrong chain id here silently accepts signatures scoped to a
 * different network.
 */
export function robinhoodChain() {
  const e = env();
  return defineChain({
    id: e.RHC_CHAIN_ID,
    name: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: e.RHC_RPC_URL ? [e.RHC_RPC_URL] : [] } },
  });
}

/**
 * Verify a signed SIWE message and return the address it proves.
 *
 * Order matters: the signature is checked before the nonce is burned, so a wallet that
 * signs the wrong thing does not cost the user their nonce. The burn itself is atomic,
 * so two concurrent submissions of the same message cannot both win.
 */
export async function verifySiwe(message: string, signature: Hex): Promise<string> {
  const e = env();

  let fields: ReturnType<typeof parseSiweMessage>;
  try {
    fields = parseSiweMessage(message);
  } catch {
    throw new SiweError('unparseable SIWE message', 'BAD_MESSAGE');
  }
  if (!fields.address || !fields.nonce) throw new SiweError('incomplete SIWE message', 'BAD_MESSAGE');
  if (fields.domain !== e.SIWE_DOMAIN) throw new SiweError(`wrong domain: ${fields.domain}`, 'BAD_DOMAIN');
  if (fields.chainId !== e.RHC_CHAIN_ID) throw new SiweError(`wrong chain: ${fields.chainId}`, 'BAD_CHAIN');

  if (!validateSiweMessage({ message: fields, domain: e.SIWE_DOMAIN, nonce: fields.nonce })) {
    // Covers expirationTime, notBefore and internal consistency.
    throw new SiweError('SIWE message is not currently valid', 'EXPIRED');
  }

  const claimed = normaliseAddress(fields.address);
  if (!(await signatureProves(message, signature, claimed))) {
    throw new SiweError('signature does not match the claimed address', 'BAD_SIGNATURE');
  }

  const bound = (await redis().eval(CONSUME, 1, nonceKey(fields.nonce))) as string | null;
  if (!bound) throw new SiweError('nonce is unknown, expired or already used', 'BAD_NONCE');
  if (bound !== claimed) throw new SiweError('nonce was issued for another address', 'BAD_NONCE');

  return claimed;
}

/**
 * EOA first: recovery is local and needs no RPC. Smart-contract wallets (ERC-1271) can
 * only be checked on chain, so they fall back to a node when one is configured.
 */
async function signatureProves(message: string, signature: Hex, address: string): Promise<boolean> {
  try {
    const recovered = await recoverMessageAddress({ message, signature });
    if (recovered.toLowerCase() === address) return true;
  } catch {
    // fall through to the contract path
  }
  if (!env().RHC_RPC_URL) return false;
  try {
    const client = createPublicClient({ chain: robinhoodChain(), transport: http(env().RHC_RPC_URL) });
    return await client.verifyMessage({ address: address as Hex, message, signature });
  } catch {
    return false;
  }
}
