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
  // Branch by network namespace: EVM (eip155) vs Solana (solana)
  try {
    const netStrRaw = (requirement?.network as any) || '';
    const netStr = typeof netStrRaw === 'string' ? netStrRaw : String(netStrRaw || '');
    const isSol = /^solana:/i.test(netStr);
    if (isSol) {
      // Solana x402 v2: wallet-standard path (signTransaction). We keep builder utilities here,
      // but SDK uses an unsigned transaction provided by the API (no signMessage).
      // Prefer a real Solana provider; avoid EVM providers accidentally injected
      // Prefer Phantom, then common Solana providers
      const solCandidates: any[] = [
        (w as any)?.phantom?.solana,
        (w as any)?.solana,
        (context as any)?.provider,
      ].filter(Boolean);
      const sol: any =
        solCandidates.find((p) => !!(p?.isPhantom === true)) ||
        solCandidates.find((p) => !!(p?.isBackpack || p?.isSolflare)) ||
        solCandidates.find((p) => !!(p?.signMessage || p?.signer?.signMessage)) ||
        solCandidates[0];
      if (!sol) throw new Error('No Solana wallet available for X402');
      // Require signMessage support
      const canSignMessage =
        typeof sol.signMessage === 'function' ||
        (sol.signer && typeof sol.signer.signMessage === 'function') ||
        typeof sol.request === 'function';
      if (!canSignMessage) throw new Error('Solana wallet does not support signMessage');
      // Discover from (base58)
      let fromBase58: string | null = null;
      // Prefer existing connection info first to avoid provider 'request' internals
      try {
        fromBase58 = sol?.publicKey?.toBase58?.() || sol?.publicKey || null;
      } catch {}
      if (!fromBase58) {
        try {
          if (typeof sol.connect === 'function') {
            const con = await sol.connect();
            fromBase58 = con?.publicKey?.toBase58?.() || con?.publicKey || null;
          }
        } catch {}
      }
      if (!fromBase58 || typeof fromBase58 !== 'string') {
        throw new Error('No Solana wallet account available for X402');
      }
      const nowSec = Math.floor(Date.now() / 1000);
      const validAfter = (nowSec - 86400).toString();
      const validBefore = (nowSec + Number(requirement?.maxTimeoutSeconds || 300)).toString();
      // 32-byte random nonce hex
      let nonceBytes = new Uint8Array(32);
      try {
        if (w?.crypto?.getRandomValues) w.crypto.getRandomValues(nonceBytes);
        else {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const nodeCrypto = typeof require === 'function' ? require('crypto') : null;
          nonceBytes = nodeCrypto?.randomBytes ? nodeCrypto.randomBytes(32) : nonceBytes;
          if (!nodeCrypto?.randomBytes) {
            for (let i = 0; i < nonceBytes.length; i++) nonceBytes[i] = Math.floor(Math.random() * 256);
          }
        }
      } catch {
        for (let i = 0; i < nonceBytes.length; i++) nonceBytes[i] = Math.floor(Math.random() * 256);
      }
      const nonceHex = '0x' + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      // Build id = pack(accountId (u64, big-endian) into high 8 bytes, intentCode (u32 big-endian) into low 4 bytes)
      const accountIdStr = String((requirement?.extra as any)?.accountCanisterId || '');
      const intentCodeStr = String((requirement?.extra as any)?.intentCode || '0');
      const accountId = BigInt(accountIdStr || '0');
      const intentCode = BigInt(intentCodeStr || '0');
      const idBytes = (() => {
        const out = new Uint8Array(32);
        for (let i = 0; i < 8; i++) {
          out[i] = Number((accountId >> BigInt(8 * (7 - i))) & 0xffn);
        }
        out[28] = Number((intentCode >> 24n) & 0xffn);
        out[29] = Number((intentCode >> 16n) & 0xffn);
        out[30] = Number((intentCode >> 8n) & 0xffn);
        out[31] = Number(intentCode & 0xffn);
        return out;
      })();
      const amountStr = String(requirement?.maxAmountRequired || '0');
      // Build message: id(32) + account_id(u64 LE) + amount(u64 LE) + external_cost(u64 LE) + valid_after(i64 LE) + valid_before(i64 LE) + nonce(32)
      const toLeU64 = (numStr: string) => {
        const n = BigInt(numStr || '0');
        const b = new Uint8Array(8);
        let v = n;
        for (let i = 0; i < 8; i++) { b[i] = Number(v & 0xffn); v >>= 8n; }
        return b;
      };
      const toLeI64 = (numStr: string) => {
        // treat as signed in little-endian two's complement if needed (validAfter/validBefore are positive)
        return toLeU64(numStr);
      };
      const externalCostStr = String(((requirement?.extra as any)?.externalCostAmount) || '0');
      const msgParts: Uint8Array[] = [
        idBytes,
        toLeU64(accountIdStr || '0'),
        toLeU64(amountStr),
        toLeU64(externalCostStr),
        toLeI64(validAfter),
        toLeI64(validBefore),
        new Uint8Array(nonceBytes),
      ];
      const message = new Uint8Array(msgParts.reduce((s, p) => s + p.length, 0));
      { let o = 0; for (const p of msgParts) { message.set(p, o); o += p.length; } }
      // Sign message
      // Try multiple signMessage call styles for compatibility
      let sigResp: any = null;
      let signErr: any = null;
      // Prefer Phantom/native signMessage when available (expects Uint8Array)
      if (typeof sol.signMessage === 'function') {
        try { sigResp = await sol.signMessage(message); } catch (e1) {
          signErr = e1;
          try { sigResp = await sol.signMessage(message, 'utf8'); } catch (e2) { signErr = e2; }
        }
      }
      if (!sigResp && sol?.signer && typeof sol.signer.signMessage === 'function') {
        try { sigResp = await sol.signer.signMessage(message); } catch (e3) {
          signErr = e3;
          try { sigResp = await sol.signer.signMessage(message, 'utf8'); } catch (e4) { signErr = e4; }
        }
      }
      // Do not use sol.request fallback; some wallets throw "Unsupported path". Require native signMessage.
      if (!sigResp) {
        throw signErr || new Error('signMessage failed');
      }
      // Normalize signature: accept Uint8Array, number[], or base58/base64 string
      const decodeBase58 = (s: string): Uint8Array => {
        const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        const ALPHABET_MAP: Record<string, number> = {};
        for (let i = 0; i < ALPHABET.length; i++) ALPHABET_MAP[ALPHABET.charAt(i)] = i;
        if (s.length === 0) return new Uint8Array();
        let zeros = 0;
        while (zeros < s.length && s[zeros] === '1') zeros++;
        const size = Math.ceil(s.length * 733 / 1000) + 1; // log(58)/log(256) ~ 0.733
        const b256 = new Uint8Array(size);
        let length = 0;
        for (let i = zeros; i < s.length; i++) {
          const ch = s[i];
          const val = ALPHABET_MAP[ch];
          if (val === undefined) throw new Error('Invalid base58 character');
          let carry = val;
          let j = 0;
          for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
            carry += 58 * b256[k];
            b256[k] = carry % 256;
            carry = Math.floor(carry / 256);
          }
          length = j;
        }
        let it = size - length;
        while (it < size && b256[it] === 0) it++;
        const out = new Uint8Array(zeros + (size - it));
        let p = 0;
        for (let i = 0; i < zeros; i++) out[p++] = 0;
        while (it < size) out[p++] = b256[it++];
        return out;
      };
      let signatureBytes: Uint8Array;
      if (sigResp?.signature) {
        const s = sigResp.signature;
        if (s instanceof Uint8Array) signatureBytes = s;
        else if (Array.isArray(s)) signatureBytes = new Uint8Array(s as number[]);
        else if (typeof s === 'string') {
          // Try base64, then base58
          try { signatureBytes = new Uint8Array(Buffer.from(s, 'base64')); }
          catch { signatureBytes = decodeBase58(s); }
        } else {
          throw new Error('Unsupported signature format');
        }
      } else if (sigResp instanceof Uint8Array) {
        signatureBytes = sigResp;
      } else if (Array.isArray(sigResp)) {
        signatureBytes = new Uint8Array(sigResp as number[]);
      } else {
        throw new Error('Invalid signMessage response');
      }
      const signatureB64 = (() => {
        try { return btoa(String.fromCharCode(...Array.from(signatureBytes))); } catch { return Buffer.from(signatureBytes).toString('base64'); }
      })();
      const idHex = '0x' + Array.from(idBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const headerObj = {
        x402Version: Number(context?.x402Version || 2),
        scheme: String(requirement?.scheme || 'exact'),
        network: String(requirement?.network || ''),
        payload: {
          authorization: {
            from: fromBase58,
            id: idHex,
            accountId: accountIdStr,
            value: amountStr,
            externalCost: externalCostStr,
            validAfter,
            validBefore,
            nonce: nonceHex,
          },
          signature: signatureB64,
        },
      };
      return encodeX402Header(headerObj as any);
    }
  } catch {}
  const eth = (context as any)?.provider || w?.ethereum;
  if (!eth || !eth.request) {
    throw new Error('No EVM wallet available for X402');
  }
  // Ensure wallet is on the intended chain for reliable eth_call (token name) and consistent UX
  try {
    const netStr = (requirement?.network as any) || '';
    // Support CAIP-2 (e.g., "eip155:8453") and plain decimal strings
    const caipMatch = typeof netStr === 'string' ? netStr.match(/^eip155:(\d+)$/i) : null;
    const chainIdDec = caipMatch ? parseInt(caipMatch[1], 10) : (typeof netStr === 'string' ? parseInt(netStr, 10) : Number(netStr || 0));
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
  // Resolve chainId from CAIP-2 if provided, else numeric string
  const caipMatchForDomain = typeof (requirement?.network as any) === 'string' ? String(requirement?.network).match(/^eip155:(\d+)$/i) : null;
  const resolvedChainId = caipMatchForDomain
    ? parseInt(caipMatchForDomain[1], 10)
    : (typeof (requirement?.network as any) === 'string' ? parseInt(String(requirement?.network), 10) : Number((requirement?.network as any) || 0)) || undefined;
  const domain = makeEip712Domain({
    name: String(extra?.name || 'Token'),
    // Default to '2' to align with common USDC EIP-3009 v2; can be overridden by requirement.extra
    version: String(extra?.eip3009Version || '2'),
    chainId: typeof resolvedChainId === 'number' && Number.isFinite(resolvedChainId) && resolvedChainId > 0 ? resolvedChainId : undefined,
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


