import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface Account {
  'account_canister_id' : bigint,
  'platform_fee_percentage' : number,
  'subaccount' : [] | [Uint8Array | number[]],
  'wallet_address' : string,
  'icp_account_identifier' : [] | [string],
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
export interface Icrc21ConsentInfo {
  'metadata' : Icrc21ConsentMessageMetadata,
  'consent_message' : Icrc21ConsentMessage,
}
export type Icrc21ConsentMessage = {
    'LineDisplayMessage' : { 'pages' : Array<Icrc21Page> }
  } |
  { 'GenericDisplayMessage' : string };
export interface Icrc21ConsentMessageMetadata {
  'utc_offset_minutes' : [] | [number],
  'language' : string,
}
export interface Icrc21ConsentMessageRequest {
  'arg' : Uint8Array | number[],
  'method' : string,
  'user_preferences' : Icrc21ConsentMessageSpec,
}
export type Icrc21ConsentMessageResponse = { 'Ok' : Icrc21ConsentInfo } |
  { 'Err' : Icrc21Error };
export interface Icrc21ConsentMessageSpec {
  'metadata' : Icrc21ConsentMessageMetadata,
  'device_spec' : [] | [Icrc21DeviceSpec],
}
export type Icrc21DeviceSpec = { 'GenericDisplay' : null } |
  {
    'LineDisplay' : {
      'characters_per_line' : number,
      'lines_per_page' : number,
    }
  };
export type Icrc21Error = {
    'GenericError' : { 'description' : string, 'error_code' : bigint }
  } |
  { 'InsufficientPayment' : Icrc21ErrorInfo } |
  { 'UnsupportedCanisterCall' : Icrc21ErrorInfo } |
  { 'ConsentMessageUnavailable' : Icrc21ErrorInfo };
export interface Icrc21ErrorInfo { 'description' : string }
export interface Icrc21Page { 'lines' : Array<string> }
export interface LedgerTransactionNotification {
  'block_index' : bigint,
  'ledger_canister_id' : string,
}
export interface NotifyResult {
  'id' : string,
  'status' : TransactionStatus,
  'amount' : bigint,
}
export interface Payout {
  'id' : bigint,
  'fee' : bigint,
  'status' : TransactionStatus,
  'account_canister_id' : bigint,
  'to_principal' : string,
  'to_subaccount' : [] | [Uint8Array | number[]],
  'from_subaccount' : Uint8Array | number[],
  'icp_account_identifier' : [] | [string],
  'timestamp_created' : bigint,
  'index' : [] | [bigint],
  'ledger_canister_id' : string,
  'timestamp_completed' : [] | [bigint],
  'amount' : bigint,
  'status_message' : [] | [string],
}
export interface PublicTxStatus {
  'status' : TransactionStatus,
  'amount' : bigint,
}
export interface Refund {
  'status' : TransactionStatus,
  'timestamp_platform_to_account' : [] | [bigint],
  'account_canister_id' : bigint,
  'original_tx_id' : bigint,
  'notify_processing' : boolean,
  'timestamp_created' : bigint,
  'timestamp_to_sender' : [] | [bigint],
  'ledger_canister_id' : string,
  'amount' : bigint,
  'platform_refund_amount' : bigint,
  'index_to_sender' : [] | [bigint],
  'index_platform_to_account' : [] | [bigint],
}
export type Result = { 'Ok' : null } |
  { 'Err' : string };
export type Result_1 = { 'Ok' : NotifyResult } |
  { 'Err' : string };
export type Result_2 = { 'Ok' : Payout } |
  { 'Err' : string };
export type Result_3 = { 'Ok' : bigint } |
  { 'Err' : string };
export type Result_4 = { 'Ok' : string } |
  { 'Err' : string };
export interface Transaction {
  'id' : bigint,
  'status' : TransactionStatus,
  'account_canister_id' : bigint,
  'platform_fee_amount' : bigint,
  'transfer_fee' : bigint,
  'index_to_account' : [] | [bigint],
  'timestamp_to_account' : [] | [bigint],
  'notify_processing' : boolean,
  'timestamp' : bigint,
  'index_received' : [] | [bigint],
  'sender_principal_id' : string,
  'account_amount' : bigint,
  'ledger_canister_id' : string,
  'timestamp_received' : [] | [bigint],
  'amount' : bigint,
}
export interface TransactionFilter {
  'from_timestamp' : [] | [bigint],
  'status' : [] | [TransactionStatus],
  'account_canister_id' : [] | [bigint],
  'from_id' : [] | [bigint],
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
  'get_controllers' : ActorMethod<[], Array<Principal>>,
  'get_ledger_transactions' : ActorMethod<
    [string, [] | [number], [] | [number]],
    TransactionResult
  >,
  'get_payout' : ActorMethod<[bigint], [] | [Payout]>,
  'get_platform_wallet' : ActorMethod<[], string>,
  'get_refund_by_original_tx_id' : ActorMethod<[bigint], [] | [Refund]>,
  'get_transaction' : ActorMethod<[bigint], [] | [Transaction]>,
  'get_transaction_status_public' : ActorMethod<
    [bigint, bigint, [] | [bigint]],
    [] | [PublicTxStatus]
  >,
  'get_transactions' : ActorMethod<[TransactionFilter], TransactionResult>,
  'icrc21_canister_call_consent_message' : ActorMethod<
    [Icrc21ConsentMessageRequest],
    Icrc21ConsentMessageResponse
  >,
  'initialize_controllers' : ActorMethod<[], Result>,
  'list_accounts' : ActorMethod<[], Array<AccountRecord>>,
  'notify_ledger_transaction' : ActorMethod<
    [LedgerTransactionNotification],
    Result_1
  >,
  'remove_account' : ActorMethod<[bigint], Result>,
  'request_payout' : ActorMethod<[bigint, string, bigint], Result_2>,
  'request_refund' : ActorMethod<[bigint], Result_3>,
  'retry_payout' : ActorMethod<[bigint], Result_2>,
  'set_controller' : ActorMethod<[Principal], Result>,
  'set_platform_wallet' : ActorMethod<[string], Result>,
  'update_account' : ActorMethod<[bigint, Account], Result>,
  'update_controllers' : ActorMethod<[], Result>,
  'withdraw_funds' : ActorMethod<[WithdrawRequest], Result_4>,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
