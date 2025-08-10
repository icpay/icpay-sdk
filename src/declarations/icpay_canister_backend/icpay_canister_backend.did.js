export const idlFactory = ({ IDL }) => {
  const Account = IDL.Record({
    'account_canister_id' : IDL.Nat64,
    'platform_fee_percentage' : IDL.Nat16,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'wallet_address' : IDL.Text,
    'platform_fee_fixed' : IDL.Opt(IDL.Nat),
    'is_active' : IDL.Bool,
  });
  const Result = IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text });
  const TransactionStatus = IDL.Variant({
    'Failed' : IDL.Text,
    'Processed' : IDL.Null,
    'Received' : IDL.Null,
    'Completed' : IDL.Null,
    'Pending' : IDL.Null,
  });
  const LedgerAccount = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const Transaction = IDL.Record({
    'id' : IDL.Nat,
    'status' : TransactionStatus,
    'account_canister_id' : IDL.Nat64,
    'platform_fee_amount' : IDL.Nat,
    'transfer_fee' : IDL.Nat,
    'recipient' : LedgerAccount,
    'index_to_account' : IDL.Opt(IDL.Nat64),
    'timestamp_to_account' : IDL.Opt(IDL.Nat64),
    'receiver_amount' : IDL.Nat,
    'timestamp' : IDL.Nat64,
    'index_received' : IDL.Opt(IDL.Nat64),
    'sender_principal_id' : IDL.Text,
    'timestamp_to_platform' : IDL.Opt(IDL.Nat64),
    'ledger_canister_id' : IDL.Text,
    'timestamp_received' : IDL.Opt(IDL.Nat64),
    'amount' : IDL.Nat,
    'index_to_platform' : IDL.Opt(IDL.Nat64),
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
  const LedgerTransactionNotification = IDL.Record({
    'block_index' : IDL.Nat64,
    'ledger_canister_id' : IDL.Text,
  });
  const Result_1 = IDL.Variant({ 'Ok' : IDL.Text, 'Err' : IDL.Text });
  const WithdrawRequest = IDL.Record({
    'recipient' : IDL.Text,
    'ledger_canister_id' : IDL.Text,
    'amount' : IDL.Nat,
  });
  return IDL.Service({
    'add_account' : IDL.Func([IDL.Nat64, Account], [Result], []),
    'get_account' : IDL.Func([IDL.Nat64], [IDL.Opt(Account)], ['query']),
    'get_account_transactions' : IDL.Func(
        [IDL.Nat64, IDL.Opt(IDL.Nat32), IDL.Opt(IDL.Nat32)],
        [TransactionResult],
        ['query'],
      ),
    'get_canister_info' : IDL.Func([], [CanisterMetrics], []),
    'get_controller' : IDL.Func([], [IDL.Principal], ['query']),
    'get_controllers' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'get_ledger_transactions' : IDL.Func(
        [IDL.Text, IDL.Opt(IDL.Nat32), IDL.Opt(IDL.Nat32)],
        [TransactionResult],
        ['query'],
      ),
    'get_platform_wallet' : IDL.Func([], [IDL.Text], ['query']),
    'get_transaction' : IDL.Func([IDL.Nat], [IDL.Opt(Transaction)], ['query']),
    'get_transactions' : IDL.Func(
        [TransactionFilter],
        [TransactionResult],
        ['query'],
      ),
    'icrc21_canister_call_consent_message' : IDL.Func(
        [Icrc21ConsentMessageRequest],
        [Icrc21ConsentMessageResponse],
        [],
      ),
    'initialize_controllers' : IDL.Func([], [Result], []),
    'list_accounts' : IDL.Func([], [IDL.Vec(AccountRecord)], ['query']),
    'notify_ledger_transaction' : IDL.Func(
        [LedgerTransactionNotification],
        [Result_1],
        [],
      ),
    'remove_account' : IDL.Func([IDL.Nat64], [Result], []),
    'set_controller' : IDL.Func([IDL.Principal], [Result], []),
    'set_platform_wallet' : IDL.Func([IDL.Text], [Result], []),
    'update_account' : IDL.Func([IDL.Nat64, Account], [Result], []),
    'update_controllers' : IDL.Func([], [Result], []),
    'withdraw_funds' : IDL.Func([WithdrawRequest], [Result_1], []),
  });
};
export const init = ({ IDL }) => { return []; };
