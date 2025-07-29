import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface Account {
  'account_canister_id' : bigint,
  'platform_fee_percentage' : number,
  'subaccount' : [] | [Uint8Array | number[]],
  'wallet_address' : string,
  'platform_fee_fixed' : [] | [bigint],
  'is_active' : boolean,
}
export interface AccountRecord {
  'account_canister_id' : bigint,
  'account' : Account,
}
export interface CanisterMetrics {
  'total_accounts' : number,
  'cycles_balance' : bigint,
  'controllers' : Array<Principal>,
  'is_healthy' : boolean,
  'last_update_timestamp' : bigint,
  'active_accounts' : number,
  'memory_size_bytes' : bigint,
  'total_transactions' : number,
  'platform_wallet' : string,
}
export interface LedgerAccount {
  'owner' : Principal,
  'subaccount' : [] | [Uint8Array | number[]],
}
export interface LedgerTransactionNotification {
  'block_index' : bigint,
  'ledger_canister_id' : string,
}
export type Result = { 'Ok' : null } |
  { 'Err' : string };
export type Result_1 = { 'Ok' : string } |
  { 'Err' : string };
export interface Transaction {
  'id' : string,
  'status' : TransactionStatus,
  'account_canister_id' : bigint,
  'platform_fee_amount' : bigint,
  'recipient' : LedgerAccount,
  'index_to_account' : [] | [bigint],
  'timestamp_to_account' : [] | [bigint],
  'receiver_amount' : bigint,
  'timestamp' : bigint,
  'index_received' : [] | [bigint],
  'sender_principal_id' : string,
  'timestamp_to_platform' : [] | [bigint],
  'ledger_canister_id' : string,
  'timestamp_received' : [] | [bigint],
  'amount' : bigint,
  'index_to_platform' : [] | [bigint],
}
export interface TransactionFilter {
  'from_timestamp' : [] | [bigint],
  'status' : [] | [TransactionStatus],
  'account_canister_id' : [] | [bigint],
  'offset' : [] | [number],
  'limit' : [] | [number],
  'to_timestamp' : [] | [bigint],
  'ledger_canister_id' : [] | [string],
}
export interface TransactionResult {
  'transactions' : Array<Transaction>,
  'total_count' : number,
  'has_more' : boolean,
}
export type TransactionStatus = { 'Failed' : string } |
  { 'Processed' : null } |
  { 'Received' : null } |
  { 'Completed' : null } |
  { 'Pending' : null };
export interface WithdrawRequest {
  'recipient' : string,
  'ledger_canister_id' : string,
  'amount' : bigint,
}
export interface _SERVICE {
  'add_account' : ActorMethod<[bigint, Account], Result>,
  'get_account' : ActorMethod<[bigint], [] | [Account]>,
  'get_account_transactions' : ActorMethod<
    [bigint, [] | [number], [] | [number]],
    TransactionResult
  >,
  'get_canister_info' : ActorMethod<[], CanisterMetrics>,
  'get_controller' : ActorMethod<[], Principal>,
  'get_ledger_transactions' : ActorMethod<
    [string, [] | [number], [] | [number]],
    TransactionResult
  >,
  'get_platform_wallet' : ActorMethod<[], string>,
  'get_transaction' : ActorMethod<[string], [] | [Transaction]>,
  'get_transactions' : ActorMethod<[TransactionFilter], TransactionResult>,
  'list_accounts' : ActorMethod<[], Array<AccountRecord>>,
  'notify_ledger_transaction' : ActorMethod<
    [LedgerTransactionNotification],
    Result_1
  >,
  'remove_account' : ActorMethod<[bigint], Result>,
  'set_controller' : ActorMethod<[Principal], Result>,
  'set_platform_wallet' : ActorMethod<[string], Result>,
  'update_account' : ActorMethod<[bigint, Account], Result>,
  'withdraw_funds' : ActorMethod<[WithdrawRequest], Result_1>,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
