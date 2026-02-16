/**
 * Base Builder Code (ERC-8021) for transaction attribution on Base chain.
 * @see https://docs.base.org/base-chain/builder-codes/app-developers
 * @see https://www.erc8021.com/
 *
 * Suffix format: [CODES as ASCII hex] + [1 byte length] + [1 byte schema id] + [16 bytes 0x8021 marker]
 */
const ICPAY_BASE_BUILDER_CODE = 'bc_h549c0ug';

/** ERC-8021 16-byte marker at end of calldata (8× 0x8021) */
const ERC_8021_MARKER = '80218021802180218021802180218021';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build ERC-8021 data suffix for Base Builder Code (Schema 0 canonical registry).
 */
function getBaseDataSuffixHex(): string {
  const codesBytes = new TextEncoder().encode(ICPAY_BASE_BUILDER_CODE);
  const lengthByte = codesBytes.length;
  const schemaId = 0; // Schema 0 = canonical registry
  return (
    toHex(codesBytes) +
    lengthByte.toString(16).padStart(2, '0') +
    schemaId.toString(16).padStart(2, '0') +
    ERC_8021_MARKER
  );
}

const BASE_DATA_SUFFIX_HEX = getBaseDataSuffixHex();

/** Base mainnet and Base Sepolia chain IDs */
const BASE_CHAIN_IDS = new Set([8453, 84532]);

/**
 * Appends the ICPay Base Builder Code to transaction data when the chain is Base.
 * Use for EVM transactions (normal and x402) so activity is attributed on base.dev.
 */
export function appendBaseBuilderSuffixIfNeeded(
  chainId: string | number | null | undefined,
  data: string
): string {
  const c =
    chainId == null
      ? null
      : typeof chainId === 'string'
        ? parseInt(chainId, 10)
        : chainId;
  if (c == null || !Number.isFinite(c) || !BASE_CHAIN_IDS.has(c)) return data;
  if (!data || typeof data !== 'string') return data;
  return data + BASE_DATA_SUFFIX_HEX;
}