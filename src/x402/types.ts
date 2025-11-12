// X402 and EIP-712 related TypeScript types
export interface Eip712Domain {
  name: string;
  version: string;
  chainId?: number;
  verifyingContract: string;
}

export interface TransferWithAuthorizationMessage {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface PermitMessage {
  owner: string;
  spender: string;
  value: string;
  nonce: string;
  deadline: string;
}

export interface X402AcceptExtra {
  intentId?: string;
  provider?: string;
  ledgerId?: string;
  facilitatorUrl?: string | null;
  name?: string;
  eip3009Version?: string;
}

export interface X402Acceptance {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource?: string | null;
  description?: string | null;
  mimeType?: string | null;
  payTo: string;
  maxTimeoutSeconds?: number;
  asset?: string;
  extra?: Partial<X402AcceptExtra>;
}

export interface X402Header {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
    signature: string;
  };
}


