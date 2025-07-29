import { Principal } from '@dfinity/principal';
import { createHash } from 'crypto';

/**
 * Convert a Principal (and optional subaccount) to an ICP AccountIdentifier (28 bytes)
 * See: https://internetcomputer.org/docs/current/developer-docs/integrations/ledger/account-identifier/
 */
export function toAccountIdentifier(principal: Principal, subaccount?: Uint8Array): Uint8Array {
  // AccountIdentifier = sha224(0x0A + principal.toUint8Array() + subaccount (32 bytes))
  const padding = Buffer.from([0x0A]);
  const principalBytes = Buffer.from(principal.toUint8Array());
  let subaccountBytes: Buffer;
  if (subaccount && subaccount.length === 32) {
    subaccountBytes = Buffer.from(subaccount);
  } else {
    subaccountBytes = Buffer.alloc(32);
  }
  const data = Buffer.concat([padding, principalBytes, subaccountBytes]);
  const hash = createHash('sha224').update(data).digest();
  return hash;
}
