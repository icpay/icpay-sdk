import Icpay from '../src/index';

// Example usage of the ICPay SDK
async function example() {
  // Initialize the SDK with your account credentials
  const icpay = new Icpay({
    secretKey: 'your-secret-key',
    accountId: 'your-account-id',
    environment: 'development', // or 'production'
    apiUrl: 'https://api.icpay.com' // optional, defaults to production URL
  });

  try {
    // 1. Get business account information
    console.log('Fetching business account...');
    const businessAccount = await icpay.getAccountInfo();
    console.log('Business Account:', {
      id: businessAccount.id,
      accountCanisterId: businessAccount.accountCanisterId,
      name: businessAccount.name,
      isActive: businessAccount.isActive,
      walletAddress: businessAccount.walletAddress
    });

    // 2. Get verified ledgers
    console.log('\nFetching verified ledgers...');
    const verifiedLedgers = await icpay.getVerifiedLedgers();
    console.log('Verified Ledgers:', verifiedLedgers.map(ledger => ({
      name: ledger.name,
      symbol: ledger.symbol,
      canisterId: ledger.canisterId,
      decimals: ledger.decimals,
      verified: ledger.verified
    })));

    // 3. Get canister information
    console.log('\nFetching canister info...');
    const canisterInfo = await icpay.getCanisterInfo();
    console.log('Canister Info:', canisterInfo);

    // 4. Show available wallet providers
    console.log('\nAvailable wallet providers:');
    const providers = icpay.getWalletProviders();
    providers.forEach(provider => {
      const isAvailable = icpay.isWalletProviderAvailable(provider.id);
      console.log(`- ${provider.name} (${provider.id}): ${isAvailable ? 'Available' : 'Not Available'}`);
    });

    // 5. Connect to a wallet (example with Internet Identity)
    console.log('\nConnecting to Internet Identity...');
    const connectionResult = await icpay.connectWallet('internet-identity');
    console.log('Wallet Connected:', {
      provider: connectionResult.provider,
      principal: connectionResult.principal,
      connected: connectionResult.connected
    });

    // 6. Get wallet balance
    console.log('\nFetching wallet balance...');
    const balance = await icpay.getBalance();
    console.log('Wallet Balance:', balance);

    // 7. Create a payment transaction
    console.log('\nCreating payment transaction...');
    const paymentRequest = {
      amount: 20.40, // 20.40 ICP
      currency: 'ICP',
      ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai', // ICP ledger canister ID
      accountCanisterId: businessAccount.accountCanisterId,
      description: 'Payment for services',
      metadata: {
        orderId: 'order-123',
        customerEmail: 'customer@example.com'
      }
    };

    const transaction = await icpay.createPayment(paymentRequest);
    console.log('Payment Transaction Created:', {
      transactionId: transaction.transactionId,
      amount: transaction.amount,
      token: transaction.token,
      recipientCanister: transaction.recipientCanister,
      description: transaction.description,
      metadata: transaction.metadata
    });

    // 8. Check transaction status
    console.log('\nChecking transaction status...');
    const status = await icpay.getTransactionStatus(transaction.transactionId);
    console.log('Transaction Status:', status);

    // 9. Get account information
    console.log('\nFetching account information...');
    const accountInfo = await icpay.getAccountInfo();
    console.log('Account Info:', accountInfo);

    // 10. Disconnect wallet
    console.log('\nDisconnecting wallet...');
    await icpay.disconnectWallet();
    console.log('Wallet disconnected');

    // 11. Example: Notify canister about a ledger transaction and handle transaction_id
    // (Assuming you have a canister client and can call notify_ledger_transaction)
    // const notifyResult = await icpay.notifyLedgerTransaction({
    //   ledgerCanisterId: 'your-ledger-canister-id',
    //   blockIndex: 123
    // });
    // console.log('Notify result (transaction_id):', notifyResult);

  } catch (error) {
    console.error('Error:', error);
  }
}

// Example of using the wallet modal
async function walletModalExample() {
  const icpay = new Icpay({
    secretKey: 'your-secret-key',
    accountId: 'your-account-id'
  });

  try {
    // Show wallet connection modal
    console.log('Showing wallet connection modal...');
    const result = await icpay.showWalletModal();
    console.log('Modal Result:', result);

    if (result.connected) {
      console.log('Successfully connected to:', result.provider);

      // Now you can create payments
      const businessAccount = await icpay.getAccountInfo();
      const payment = await icpay.createPayment({
        amount: 10.50,
        currency: 'ICP',
        ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai',
        accountCanisterId: businessAccount.accountCanisterId,
        description: 'Test payment'
      });

      console.log('Payment created:', payment);
    }
  } catch (error) {
    console.error('Modal Error:', error);
  }
}

// Example of handling different ledger types
async function ledgerExamples() {
  const icpay = new Icpay({
    secretKey: 'your-secret-key',
    accountId: 'your-account-id'
  });

  try {
    const businessAccount = await icpay.getAccountInfo();
    const verifiedLedgers = await icpay.getVerifiedLedgers();

    // Example with ICP (sent to our canister's account on ICP ledger)
    const icpPayment = await icpay.createPayment({
      amount: 5.25,
      currency: 'ICP',
      ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai', // ICP ledger
      accountCanisterId: businessAccount.accountCanisterId,
      description: 'ICP payment'
    });

    // Example with ICPAY_TEST (sent directly to our canister ID)
    const icpayTestLedger = verifiedLedgers.find(l => l.symbol === 'ICPay');
    if (icpayTestLedger) {
      const icpayTestPayment = await icpay.createPayment({
        amount: 100,
        currency: 'ICPAY_TEST',
        ledgerCanisterId: icpayTestLedger.canisterId,
        accountCanisterId: businessAccount.accountCanisterId,
        description: 'ICPay test payment'
      });
    }

  } catch (error) {
    console.error('Ledger Examples Error:', error);
  }
}

export { example, walletModalExample, ledgerExamples };