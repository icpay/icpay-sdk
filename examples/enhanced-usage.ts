import Icpay from '../src/index';

// Example usage of the ICPay SDK in PRIVATE mode (server-side)
async function privateExample() {
  // Initialize the SDK with secret key (server-side only)
  const icpay = new Icpay({
    secretKey: 'sk_live_your_secret_key_here',
    environment: 'production', // or 'development'
    apiUrl: 'https://api.icpay.com', // optional, defaults to production URL
    icHost: 'https://ic0.app' // IC network host
  });

  try {
    console.log('=== ICPay SDK Private Mode Examples ===\n');

    // 1. Get detailed account information (full data)
    console.log('1. Fetching detailed account information...');
    const businessAccount = await icpay.getAccountInfo();

    // Type guard to check if we have full account info (private mode)
    if ('email' in businessAccount && 'walletBalance' in businessAccount) {
      console.log('Business Account (Private):', {
        id: businessAccount.id,
        accountCanisterId: businessAccount.accountCanisterId,
        name: businessAccount.name,
        email: businessAccount.email, // Available in private mode
        isActive: businessAccount.isActive,
        walletAddress: businessAccount.walletAddress
      });
    } else {
      console.log('Business Account (Public):', {
        id: businessAccount.id,
        accountCanisterId: businessAccount.accountCanisterId,
        name: businessAccount.name,
        isActive: businessAccount.isActive,
        walletAddress: businessAccount.walletAddress
      });
    }

    // 2. Get verified ledgers with price information
    console.log('\n2. Fetching verified ledgers with prices...');
    const verifiedLedgers = await icpay.getVerifiedLedgers();
    console.log('Verified Ledgers:', verifiedLedgers.map(ledger => ({
      name: ledger.name,
      symbol: ledger.symbol,
      canisterId: ledger.canisterId,
      decimals: ledger.decimals,
      verified: ledger.verified,
      currentPrice: ledger.currentPrice,
      lastPriceUpdate: ledger.lastPriceUpdate
    })));

    // 3. Get all ledgers with price information
    console.log('\n3. Fetching all ledgers with prices...');
    const allLedgersWithPrices = await icpay.getAllLedgersWithPrices();
    console.log('All Ledgers with Prices:', allLedgersWithPrices.map(ledger => ({
      name: ledger.name,
      symbol: ledger.symbol,
      canisterId: ledger.canisterId,
      currentPrice: ledger.currentPrice
    })));

    // 4. Connect to a wallet (required for balance operations)
    console.log('\n4. Connecting to wallet...');
    const connectionResult = await icpay.connectWallet('internet-identity');
    console.log('Wallet Connected:', {
      provider: connectionResult.provider,
      principal: connectionResult.principal,
      connected: connectionResult.connected
    });

    // 5. Get all ledger balances for connected wallet
    console.log('\n5. Fetching all ledger balances for connected wallet...');
    const allBalances = await icpay.getAllLedgerBalances();
    console.log('All Ledger Balances:', {
      totalBalancesUSD: allBalances.totalBalancesUSD,
      lastUpdated: allBalances.lastUpdated,
      balances: allBalances.balances.map(balance => ({
        symbol: balance.ledgerSymbol,
        balance: balance.formattedBalance,
        rawBalance: balance.balance,
        currentPrice: balance.currentPrice,
        usdValue: balance.currentPrice ?
          (parseFloat(balance.formattedBalance) * balance.currentPrice).toFixed(2) :
          'N/A'
      }))
    });

    // 6. Get single ledger balance
    console.log('\n6. Fetching single ledger balance...');
    const icpLedgerId = 'ryjl3-tyaaa-aaaaa-aaaba-cai'; // ICP ledger
    const singleBalance = await icpay.getSingleLedgerBalance(icpLedgerId);
    console.log('ICP Balance:', {
      symbol: singleBalance.ledgerSymbol,
      balance: singleBalance.formattedBalance,
      rawBalance: singleBalance.balance,
      currentPrice: singleBalance.currentPrice,
      usdValue: singleBalance.currentPrice ?
        (parseFloat(singleBalance.formattedBalance) * singleBalance.currentPrice).toFixed(2) :
        'N/A'
    });

    // 7. Calculate token amount from USD price
    console.log('\n7. Calculating token amount from USD...');
    const priceCalculation = await icpay.calculateTokenAmountFromUSD({
      usdAmount: 100, // $100 USD
      ledgerCanisterId: icpLedgerId
    });
    console.log('Price Calculation:', {
      usdAmount: priceCalculation.usdAmount,
      ledgerSymbol: priceCalculation.ledgerSymbol,
      currentPrice: priceCalculation.currentPrice,
      tokenAmountHuman: priceCalculation.tokenAmountHuman,
      tokenAmountDecimals: priceCalculation.tokenAmountDecimals,
      priceTimestamp: priceCalculation.priceTimestamp
    });

    // 8. Get transaction history (private method)
    console.log('\n8. Fetching transaction history...');
    const transactionHistory = await icpay.getTransactionHistory({
      limit: 10,
      offset: 0,
      status: 'completed'
    });
    console.log('Transaction History:', {
      total: transactionHistory.total,
      hasMore: transactionHistory.hasMore,
      transactions: transactionHistory.transactions.map(tx => ({
        id: tx.id,
        status: tx.status,
        amount: tx.amount,
        currency: tx.currency,
        ledgerSymbol: tx.ledgerSymbol,
        createdAt: tx.createdAt
      }))
    });

    // 9. Get account wallet balances (from API, private method)
    console.log('\n9. Fetching account wallet balances from API...');
    const accountWalletBalances = await icpay.protected.getAccountWalletBalances();
    console.log('Account Wallet Balances:', {
      totalBalancesUSD: accountWalletBalances.totalBalancesUSD,
      lastUpdated: accountWalletBalances.lastUpdated,
      balances: accountWalletBalances.balances.map(balance => ({
        symbol: balance.ledgerSymbol,
        balance: balance.formattedBalance,
        currentPrice: balance.currentPrice
      }))
    });

    // 10. Get detailed ledger information
    console.log('\n10. Fetching detailed ledger information...');
    const ledgerInfo = await icpay.getLedgerInfo(icpLedgerId);
    console.log('Ledger Info:', {
      name: ledgerInfo.name,
      symbol: ledgerInfo.symbol,
      canisterId: ledgerInfo.canisterId,
      standard: ledgerInfo.standard,
      decimals: ledgerInfo.decimals,
      verified: ledgerInfo.verified,
      currentPrice: ledgerInfo.currentPrice,
      lastPriceUpdate: ledgerInfo.lastPriceUpdate
    });

    // 11. Send funds using USD amount (public method)
    console.log('\n11. Sending funds using USD amount...');
    try {
      const usdTransaction = await icpay.sendFundsUsd({
        usdAmount: 5.61, // $5.61 USD
        ledgerCanisterId: icpLedgerId,
        metadata: { description: 'USD-based transaction' }
      });
      console.log('USD Transaction Sent:', {
        transactionId: usdTransaction.transactionId,
        status: usdTransaction.status,
        amount: usdTransaction.amount,
        timestamp: usdTransaction.timestamp
      });
    } catch (error) {
      console.log('USD transaction failed (expected if insufficient balance):', error.message);
    }

    // 12. Send funds example (public method)
    console.log('\n12. Send funds example...');
    try {
      const transaction = await icpay.sendFunds({
        ledgerCanisterId: icpLedgerId,
        amount: '10000000', // 0.1 ICP in e8s
        metadata: { description: 'Test transaction' }
      });
      console.log('Transaction Sent:', {
        transactionId: transaction.transactionId,
        status: transaction.status,
        amount: transaction.amount,
        timestamp: transaction.timestamp
      });

      // 13. Get transaction status (private method)
      console.log('\n13. Checking transaction status...');
      const transactionStatus = await icpay.protected.getTransactionStatus(transaction.transactionId);
      console.log('Transaction Status:', {
        transactionId: transactionStatus.transactionId,
        status: transactionStatus.status,
        blockHeight: transactionStatus.blockHeight,
        timestamp: transactionStatus.timestamp
      });
    } catch (error) {
      console.log('Transaction failed (expected if insufficient balance):', error.message);
    }

    console.log('\n=== Private Mode Examples Completed ===');

  } catch (error) {
    console.error('Error in private example:', error);
  }
}

// Run the example
privateExample().catch(console.error);

export default privateExample;
