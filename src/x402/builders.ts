import { Eip712Domain, TransferWithAuthorizationMessage, PermitMessage, X402Acceptance, X402Header } from './types';

export function buildTransferWithAuthorizationTypedData(
  domain: Eip712Domain,
  message: TransferWithAuthorizationMessage
) {
  const types = {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  };
  return {
    types,
    domain,
    primaryType: 'TransferWithAuthorization',
    message,
  };
}

export function buildPermitTypedData(domain: Eip712Domain, message: PermitMessage) {
  const types = {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  };
  return {
    types,
    domain,
    primaryType: 'Permit',
    message,
  };
}

export function encodeX402Header(header: X402Header): string {
  const json = JSON.stringify(header);
  try {
    return btoa(json);
  } catch {
    return Buffer.from(json, 'utf8').toString('base64');
  }
}

export function makeEip712Domain(params: {
  name: string;
  version: string;
  chainId?: number;
  verifyingContract: string;
}): Eip712Domain {
  return {
    name: String(params.name),
    version: String(params.version),
    chainId: typeof params.chainId === 'number' ? params.chainId : undefined,
    verifyingContract: String(params.verifyingContract),
  };
}

export function buildX402HeaderFromAuthorization(input: {
  x402Version: number;
  scheme: string;
  network: string;
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
  signature: string;
}): X402Header {
  return {
    x402Version: Number(input.x402Version || 1),
    scheme: String(input.scheme || 'exact'),
    network: String(input.network || ''),
    payload: {
      authorization: {
        from: input.from,
        to: input.to,
        value: input.value,
        validAfter: input.validAfter,
        validBefore: input.validBefore,
        nonce: input.nonce,
      },
      signature: input.signature,
    },
  };
}

/**
 * Build and sign an X402 payment header using an EVM wallet (eth_signTypedData_v4).
 * Returns a base64-encoded header string suitable for the X402 settle endpoint.
 */
export async function buildAndSignX402PaymentHeader(
  requirement: X402Acceptance,
  context?: { x402Version?: number; debug?: boolean; provider?: any }
): Promise<string> {
  const w: any = (globalThis as any)?.window || (globalThis as any);
  const eth = (context as any)?.provider || w?.ethereum;
  if (!eth || !eth.request) {
    throw new Error('No EVM wallet available for X402');
  }
  // Ensure wallet is on the intended chain for reliable eth_call (token name) and consistent UX
  try {
    const netStr = (requirement?.network as any) || '';
    const chainIdDec = typeof netStr === 'string' ? parseInt(netStr, 10) : Number(netStr || 0);
    if (Number.isFinite(chainIdDec) && chainIdDec > 0) {
      const hex = '0x' + chainIdDec.toString(16);
      try {
        const currentHex: string = await eth.request({ method: 'eth_chainId' });
        if (typeof currentHex !== 'string' || currentHex.toLowerCase() !== hex.toLowerCase()) {
          await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
        }
      } catch {
        // Best-effort: if switch fails, continue; signing does not require chain match,
        // but eth_call for token name may fail. We'll handle that gracefully.
      }
    }
  } catch {}
  const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' });
  const from: string = (accounts && accounts[0]) || '';
  if (!from) throw new Error('No wallet account available for X402');

  const nowSec = Math.floor(Date.now() / 1000);
  const validAfter = (nowSec - 86400).toString();
  const validBefore = (nowSec + Number(requirement?.maxTimeoutSeconds || 300)).toString();

  // Generate 32-byte nonce (prefer secure sources)
  let nonceBytes: Uint8Array;
  try {
    if (w?.crypto?.getRandomValues) {
      nonceBytes = w.crypto.getRandomValues(new Uint8Array(32));
    } else {
      // Try Node crypto for non-browser environments
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nodeCrypto = typeof require === 'function' ? require('crypto') : null;
      nonceBytes = nodeCrypto?.randomBytes ? nodeCrypto.randomBytes(32) : new Uint8Array(32);
      if (!nodeCrypto?.randomBytes) {
        for (let i = 0; i < nonceBytes.length; i++) {
          nonceBytes[i] = Math.floor(Math.random() * 256);
        }
      }
    }
  } catch {
    nonceBytes = new Uint8Array(32);
    for (let i = 0; i < nonceBytes.length; i++) {
      nonceBytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const bytesArr: number[] = Array.from(nonceBytes as Uint8Array);
  const nonce = '0x' + bytesArr.map(b => b.toString(16).padStart(2, '0')).join('');

  const extra = (requirement?.extra || {}) as any;
  const primaryType = String(extra?.primaryType || 'TransferWithAuthorization');
  const domain = makeEip712Domain({
    name: String(extra?.name || 'Token'),
    version: String(extra?.eip3009Version || '1'),
    chainId: Number((requirement?.network as any) || 0) || undefined,
    verifyingContract: String(requirement?.asset || requirement?.payTo || ''),
  });

  const typedData =
    primaryType === 'Permit'
      ? buildPermitTypedData(domain, {
          owner: from,
          spender: String(requirement?.payTo || ''),
          value: String(requirement?.maxAmountRequired || '0'),
          nonce: String(BigInt(nonce)),
          deadline: String(validBefore),
        })
      : buildTransferWithAuthorizationTypedData(domain, {
          from,
          to: String(requirement?.payTo || ''),
          value: String(requirement?.maxAmountRequired || '0'),
          validAfter: String(validAfter),
          validBefore: String(validBefore),
          nonce,
        });

  if (context?.debug) {
    try {
      // eslint-disable-next-line no-console
      console.debug('X402 EIP-712 typedData (pre-sign)', {
        domain,
        primaryType: (typedData as any).primaryType,
        verifyingContract: domain.verifyingContract,
        chainId: domain.chainId,
        types: Object.keys(((typedData as any).types || {})),
        message: (typedData as any).message,
      });
    } catch {}
  }
  const payload = JSON.stringify(typedData);
  const signature = await eth.request({
    method: 'eth_signTypedData_v4',
    params: [from, payload],
  });

  const headerObj = buildX402HeaderFromAuthorization({
    x402Version: Number(context?.x402Version || 1),
    scheme: String(requirement?.scheme || 'exact'),
    network: String(requirement?.network || ''),
    from,
    to: String(requirement?.payTo || ''),
    value: String(requirement?.maxAmountRequired || '0'),
    validAfter: String(validAfter),
    validBefore: String(validBefore),
    nonce,
    signature,
  });
  return encodeX402Header(headerObj);
}


