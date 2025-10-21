export const idlFactory = ({ IDL }) => {
  const SplitRule = IDL.Record({
    'account_canister_id' : IDL.Nat64,
    'percentage' : IDL.Nat16,
  });
  const Account = IDL.Record({
    'account_canister_id' : IDL.Nat64,
    'platform_fee_percentage' : IDL.Nat16,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'wallet_address' : IDL.Text,
    'icp_account_identifier' : IDL.Opt(IDL.Text),
    'platform_fee_fixed' : IDL.Opt(IDL.Nat),
    'is_active' : IDL.Bool,
    'splits' : IDL.Vec(SplitRule),
  });
  const Result = IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text });
  const LedgerStandard = IDL.Variant({
    'Ck' : IDL.Null,
    'Icp' : IDL.Null,
    'Icrc' : IDL.Null,
  });
  const TransactionStatus = IDL.Variant({
    'Failed' : IDL.Text,
    'Processed' : IDL.Null,
    'Received' : IDL.Null,
    'Completed' : IDL.Null,
    'Pending' : IDL.Null,
  });
  const Split = IDL.Record({
    'account_canister_id' : IDL.Nat64,
    'index_block' : IDL.Opt(IDL.Nat64),
    'timestamp' : IDL.Opt(IDL.Nat64),
    'account_percentage' : IDL.Nat16,
    'amount' : IDL.Nat,
  });
  const Transaction = IDL.Record({
    'id' : IDL.Nat,
    'status' : TransactionStatus,
    'account_canister_id' : IDL.Nat64,
    'platform_fee_amount' : IDL.Nat,
    'transfer_fee' : IDL.Nat,
    'memo' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'timestamp_to_account' : IDL.Opt(IDL.Nat64),
    'notify_processing' : IDL.Bool,
    'source_type' : IDL.Nat8,
    'timestamp' : IDL.Nat64,
    'index_received' : IDL.Opt(IDL.Nat64),
    'sender_principal_id' : IDL.Text,
    'account_amount' : IDL.Nat,
    'ledger_canister_id' : IDL.Text,
    'splits' : IDL.Vec(Split),
    'timestamp_received' : IDL.Opt(IDL.Nat64),
    'amount' : IDL.Nat,
  });
  const TransactionResult = IDL.Record({
    'transactions' : IDL.Vec(Transaction),
    'total_count' : IDL.Nat32,
    'has_more' : IDL.Bool,
  });
  const CanisterMetrics = IDL.Record({
    'total_accounts' : IDL.Nat32,
    'cycles_balance' : IDL.Nat64,
    'controllers' : IDL.Vec(IDL.Principal),
    'is_healthy' : IDL.Bool,
    'last_update_timestamp' : IDL.Nat64,
    'active_accounts' : IDL.Nat32,
    'memory_size_bytes' : IDL.Nat64,
    'total_transactions' : IDL.Nat32,
    'platform_wallet' : IDL.Text,
  });
  const Payout = IDL.Record({
    'id' : IDL.Nat,
    'fee' : IDL.Nat,
    'status' : TransactionStatus,
    'account_canister_id' : IDL.Nat64,
    'to_principal' : IDL.Text,
    'to_subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'from_subaccount' : IDL.Vec(IDL.Nat8),
    'icp_account_identifier' : IDL.Opt(IDL.Text),
    'notify_processing' : IDL.Opt(IDL.Bool),
    'timestamp_created' : IDL.Nat64,
    'index' : IDL.Opt(IDL.Nat64),
    'ledger_canister_id' : IDL.Text,
    'timestamp_completed' : IDL.Opt(IDL.Nat64),
    'amount' : IDL.Nat,
    'status_message' : IDL.Opt(IDL.Text),
  });
  const Refund = IDL.Record({
    'status' : TransactionStatus,
    'timestamp_platform_to_account' : IDL.Opt(IDL.Nat64),
    'account_canister_id' : IDL.Nat64,
    'original_tx_id' : IDL.Nat,
    'notify_processing' : IDL.Bool,
    'timestamp_created' : IDL.Nat64,
    'timestamp_to_sender' : IDL.Opt(IDL.Nat64),
    'ledger_canister_id' : IDL.Text,
    'amount' : IDL.Nat,
    'platform_refund_amount' : IDL.Nat,
    'index_to_sender' : IDL.Opt(IDL.Nat64),
    'index_platform_to_account' : IDL.Opt(IDL.Nat64),
  });
  const PublicTxStatus = IDL.Record({
    'status' : TransactionStatus,
    'amount' : IDL.Nat,
  });
  const TransactionFilter = IDL.Record({
    'from_timestamp' : IDL.Opt(IDL.Nat64),
    'status' : IDL.Opt(TransactionStatus),
    'account_canister_id' : IDL.Opt(IDL.Nat64),
    'from_id' : IDL.Opt(IDL.Nat),
    'offset' : IDL.Opt(IDL.Nat32),
    'limit' : IDL.Opt(IDL.Nat32),
    'to_timestamp' : IDL.Opt(IDL.Nat64),
    'ledger_canister_id' : IDL.Opt(IDL.Text),
  });
  const Icrc21ConsentMessageMetadata = IDL.Record({
    'utc_offset_minutes' : IDL.Opt(IDL.Int16),
    'language' : IDL.Text,
  });
  const Icrc21DeviceSpec = IDL.Variant({
    'GenericDisplay' : IDL.Null,
    'LineDisplay' : IDL.Record({
      'characters_per_line' : IDL.Nat16,
      'lines_per_page' : IDL.Nat16,
    }),
  });
  const Icrc21ConsentMessageSpec = IDL.Record({
    'metadata' : Icrc21ConsentMessageMetadata,
    'device_spec' : IDL.Opt(Icrc21DeviceSpec),
  });
  const Icrc21ConsentMessageRequest = IDL.Record({
    'arg' : IDL.Vec(IDL.Nat8),
    'method' : IDL.Text,
    'user_preferences' : Icrc21ConsentMessageSpec,
  });
  const Icrc21Page = IDL.Record({ 'lines' : IDL.Vec(IDL.Text) });
  const Icrc21ConsentMessage = IDL.Variant({
    'LineDisplayMessage' : IDL.Record({ 'pages' : IDL.Vec(Icrc21Page) }),
    'GenericDisplayMessage' : IDL.Text,
  });
  const Icrc21ConsentInfo = IDL.Record({
    'metadata' : Icrc21ConsentMessageMetadata,
    'consent_message' : Icrc21ConsentMessage,
  });
  const Icrc21ErrorInfo = IDL.Record({ 'description' : IDL.Text });
  const Icrc21Error = IDL.Variant({
    'GenericError' : IDL.Record({
      'description' : IDL.Text,
      'error_code' : IDL.Nat64,
    }),
    'InsufficientPayment' : Icrc21ErrorInfo,
    'UnsupportedCanisterCall' : Icrc21ErrorInfo,
    'ConsentMessageUnavailable' : Icrc21ErrorInfo,
  });
  const Icrc21ConsentMessageResponse = IDL.Variant({
    'Ok' : Icrc21ConsentInfo,
    'Err' : Icrc21Error,
  });
  const AccountRecord = IDL.Record({
    'account_canister_id' : IDL.Nat64,
    'account' : Account,
  });
  const AllowedLedgerInfo = IDL.Record({
    'canister_id' : IDL.Text,
    'standard' : LedgerStandard,
  });
  const LedgerTransactionNotification = IDL.Record({
    'block_index' : IDL.Nat64,
    'ledger_canister_id' : IDL.Text,
  });
  const NotifyResult = IDL.Record({
    'id' : IDL.Text,
    'status' : TransactionStatus,
    'amount' : IDL.Nat,
  });
  const Result_1 = IDL.Variant({ 'Ok' : NotifyResult, 'Err' : IDL.Text });
  const Result_2 = IDL.Variant({ 'Ok' : Payout, 'Err' : IDL.Text });
  const Result_3 = IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : IDL.Text });
  return IDL.Service({
    'add_account' : IDL.Func([IDL.Nat64, Account], [Result], []),
    'add_allowed_ledger' : IDL.Func([IDL.Text, LedgerStandard], [Result], []),
    'get_account' : IDL.Func([IDL.Nat64], [IDL.Opt(Account)], ['query']),
    'get_account_transactions' : IDL.Func(
        [IDL.Nat64, IDL.Opt(IDL.Nat32), IDL.Opt(IDL.Nat32)],
        [TransactionResult],
        ['query'],
      ),
    'get_canister_info' : IDL.Func([], [CanisterMetrics], ['query']),
    'get_controllers' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'get_payout' : IDL.Func([IDL.Nat], [IDL.Opt(Payout)], ['query']),
    'get_refund_by_original_tx_id' : IDL.Func(
        [IDL.Nat],
        [IDL.Opt(Refund)],
        ['query'],
      ),
    'get_transaction' : IDL.Func([IDL.Nat], [IDL.Opt(Transaction)], ['query']),
    'get_transaction_status_public' : IDL.Func(
        [IDL.Nat64, IDL.Nat, IDL.Opt(IDL.Nat64)],
        [IDL.Opt(PublicTxStatus)],
        ['query'],
      ),
    'get_transactions' : IDL.Func(
        [TransactionFilter],
        [TransactionResult],
        ['query'],
      ),
    'icrc21_canister_call_consent_message' : IDL.Func(
        [Icrc21ConsentMessageRequest],
        [Icrc21ConsentMessageResponse],
        ['query'],
      ),
    'initialize_controllers' : IDL.Func([], [Result], []),
    'list_accounts' : IDL.Func([], [IDL.Vec(AccountRecord)], ['query']),
    'list_allowed_ledgers' : IDL.Func(
        [],
        [IDL.Vec(AllowedLedgerInfo)],
        ['query'],
      ),
    'notify_ledger_transaction' : IDL.Func(
        [LedgerTransactionNotification],
        [Result_1],
        [],
      ),
    'notify_onramp_icp' : IDL.Func(
        [IDL.Vec(IDL.Nat8), IDL.Vec(IDL.Nat8)],
        [Result_1],
        [],
      ),
    'remove_account' : IDL.Func([IDL.Nat64], [Result], []),
    'remove_allowed_ledger' : IDL.Func([IDL.Text], [Result], []),
    'request_payout' : IDL.Func(
        [IDL.Nat, IDL.Nat64, IDL.Text, IDL.Nat],
        [Result_2],
        [],
      ),
    'request_refund' : IDL.Func([IDL.Nat], [Result_3], []),
    'set_platform_wallet' : IDL.Func([IDL.Text], [Result], []),
    'update_account' : IDL.Func([IDL.Nat64, Account], [Result], []),
    'update_controllers' : IDL.Func([], [Result], []),
  });
};
export const init = ({ IDL }) => { return []; };
