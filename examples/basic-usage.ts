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
      verified: ledger.verified,
      currentPrice: ledger.currentPrice,
      priceFetchMethod: ledger.priceFetchMethod,
      lastPriceUpdate: ledger.lastPriceUpdate
    })));

    // 3. Show available wallet providers
    console.log('\nAvailable wallet providers:');
    const providers = icpay.getWalletProviders();
    providers.forEach(provider => {
      const isAvailable = icpay.isWalletProviderAvailable(provider.id);
      console.log(`- ${provider.name} (${provider.id}): ${isAvailable ? 'Available' : 'Not Available'}`);
    });

    // 4. Connect to a wallet (example with Internet Identity)
    console.log('\nConnecting to Internet Identity...');
    const connectionResult = await icpay.connectWallet('internet-identity');
    console.log('Wallet Connected:', {
      provider: connectionResult.provider,
      principal: connectionResult.principal,
      connected: connectionResult.connected
    });

    // 5. Get wallet balance
    console.log('\nFetching wallet balance...');
    const balance = await icpay.getBalance();
    console.log('Wallet Balance:', balance);

    // 6. Send funds example
    console.log('\nSending funds...');
    const transaction = await icpay.sendFunds({
      ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai', // ICP ledger canister ID
      amount: '10000000', // 0.1 ICP in e8s
      metadata: {
        orderId: 'order-123',
        customerEmail: 'customer@example.com'
      }
    });
    console.log('Transaction Sent:', {
      transactionId: transaction.transactionId,
      status: transaction.status,
      amount: transaction.amount,
      timestamp: transaction.timestamp
    });

    // 7. Send funds with USD amount
    console.log('\nSending funds with USD amount...');
    const usdTransaction = await icpay.sendFundsUsd({
      usdAmount: 5.61, // $5.61 USD
      ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai',
      metadata: {
        orderId: 'order-124',
        customerEmail: 'customer@example.com'
      }
    });
    console.log('USD Transaction Sent:', {
      transactionId: usdTransaction.transactionId,
      status: usdTransaction.status,
      amount: usdTransaction.amount,
      timestamp: usdTransaction.timestamp
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

      // Now you can send funds
      const transaction = await icpay.sendFunds({
        ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai',
        amount: '10000000', // 0.1 ICP in e8s
        metadata: { description: 'Test payment' }
      });

      console.log('Transaction sent:', transaction);
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
    const verifiedLedgers = await icpay.getVerifiedLedgers();

    // Example with ICP
    const icpTransaction = await icpay.sendFunds({
      ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai', // ICP ledger
      amount: '525000000', // 5.25 ICP in e8s
      metadata: { description: 'ICP payment' }
    });

    // Example with USD amount
    const usdTransaction = await icpay.sendFundsUsd({
      usdAmount: 5.25,
      ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai',
      metadata: { description: 'USD payment' }
    });

    // Example with another ledger (if available)
    const icpayTestLedger = verifiedLedgers.find(l => l.symbol === 'ICPAY_TEST');
    if (icpayTestLedger) {
      const icpayTestTransaction = await icpay.sendFunds({
        ledgerCanisterId: icpayTestLedger.canisterId,
        amount: '100000000', // 1 ICPAY_TEST token
        metadata: { description: 'ICPay test payment' }
      });
    }

  } catch (error) {
    console.error('Ledger Examples Error:', error);
  }
}

export { example, walletModalExample, ledgerExamples };