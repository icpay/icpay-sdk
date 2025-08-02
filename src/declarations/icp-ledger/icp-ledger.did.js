export const idlFactory = ({ IDL }) => {
  const AccountIdentifier = IDL.Vec(IDL.Nat8);
  const Tokens = IDL.Nat;
  const BlockIndex = IDL.Nat;
  const Memo = IDL.Nat64;
  const SubAccount = IDL.Vec(IDL.Nat8);
  const TimeStamp = IDL.Nat64;
  const TransferFee = IDL.Nat;
  const AccountBalanceArgs = IDL.Record({
    account: AccountIdentifier,
  });
  const AccountBalanceArgsDfx = IDL.Record({
    account: IDL.Text,
  });
  const TransferArgs = IDL.Record({
    to: AccountIdentifier,
    fee: TransferFee,
    memo: Memo,
    from_subaccount: IDL.Opt(SubAccount),
    created_at_time: IDL.Opt(TimeStamp),
    amount: Tokens,
  });
  const TransferError = IDL.Variant({
    BadFee: IDL.Record({ expected_fee: TransferFee }),
    BadBurn: IDL.Record({ min_burn_amount: Tokens }),
    InsufficientFunds: IDL.Record({ balance: Tokens }),
    TooOld: IDL.Null,
    CreatedInFuture: IDL.Record({ ledger_time: TimeStamp }),
    TemporarilyUnavailable: IDL.Null,
    Duplicate: IDL.Record({ duplicate_of: BlockIndex }),
    GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
  });
  const TransferResult = IDL.Variant({
    Ok: BlockIndex,
    Err: TransferError,
  });
  const Block = IDL.Record({
    id: IDL.Nat,
    parent_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
    timestamp: TimeStamp,
    transaction: IDL.Record({
      Transfer: IDL.Record({
        from: IDL.Principal,
        to: IDL.Principal,
        amount: Tokens,
        fee: IDL.Opt(TransferFee),
        memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
        created_at_time: IDL.Opt(TimeStamp),
      }),
    }),
  });
  const ArchiveRange = IDL.Record({
    start: IDL.Nat,
    length: IDL.Nat,
    callback: IDL.Func([IDL.Vec(Block)], [IDL.Vec(Block)], ['query']),
  });
  return IDL.Service({
    account_balance: IDL.Func([AccountBalanceArgs], [Tokens], ['query']),
    account_balance_dfx: IDL.Func([AccountBalanceArgsDfx], [Tokens], ['query']),
    account_transfer: IDL.Func([TransferArgs], [TransferResult], []),
    query_blocks: IDL.Func([
      IDL.Record({
        start: IDL.Nat,
        length: IDL.Nat,
      }),
    ], [
      IDL.Record({
        blocks: IDL.Vec(Block),
        archived_blocks: IDL.Vec(ArchiveRange),
      }),
    ], ['query']),
  });
};
export const init = ({ IDL }) => {
  return [];
};