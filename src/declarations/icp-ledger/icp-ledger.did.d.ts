export interface AccountIdentifier extends Array<number> {}
export interface Tokens extends bigint {}
export interface BlockIndex extends bigint {}
export interface Memo extends bigint {}
export interface SubAccount extends Array<number> {}
export interface TimeStamp extends bigint {}
export interface TransferFee extends bigint {}

export interface AccountBalanceArgs {
  account: AccountIdentifier;
}

export interface AccountBalanceArgsDfx {
  account: string;
}

export interface TransferArgs {
  to: AccountIdentifier;
  fee: TransferFee;
  memo: Memo;
  from_subaccount?: SubAccount;
  created_at_time?: TimeStamp;
  amount: Tokens;
}

export interface TransferError {
  BadFee?: { expected_fee: TransferFee };
  BadBurn?: { min_burn_amount: Tokens };
  InsufficientFunds?: { balance: Tokens };
  TooOld?: null;
  CreatedInFuture?: { ledger_time: TimeStamp };
  TemporarilyUnavailable?: null;
  Duplicate?: { duplicate_of: BlockIndex };
  GenericError?: { error_code: number; message: string };
}

export interface TransferResult {
  Ok?: BlockIndex;
  Err?: TransferError;
}

export interface Block {
  id: BlockIndex;
  parent_hash?: Array<number>;
  timestamp: TimeStamp;
  transaction: {
    Transfer: {
      from: string;
      to: string;
      amount: Tokens;
      fee?: TransferFee;
      memo?: Array<number>;
      created_at_time?: TimeStamp;
    };
  };
}

export interface ArchiveRange {
  start: BlockIndex;
  length: BlockIndex;
  callback: (args: Array<Block>) => Promise<Array<Block>>;
}

export interface QueryBlocksArgs {
  start: BlockIndex;
  length: BlockIndex;
}

export interface QueryBlocksResponse {
  blocks: Array<Block>;
  archived_blocks: Array<ArchiveRange>;
}

export interface _SERVICE {
  account_balance: (arg_0: AccountBalanceArgs) => Promise<Tokens>;
  account_balance_dfx: (arg_0: AccountBalanceArgsDfx) => Promise<Tokens>;
  account_transfer: (arg_0: TransferArgs) => Promise<TransferResult>;
  query_blocks: (arg_0: QueryBlocksArgs) => Promise<QueryBlocksResponse>;
}

export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => any[];