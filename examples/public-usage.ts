import Icpay from '../src/index';

// Example usage of the ICPay SDK in PUBLIC mode (frontend-safe)
async function publicExample() {
  // Initialize the SDK with publishable key (safe for frontend)
  const icpay = new Icpay({
    publishableKey: 'pk_live_your_publishable_key_here',
    environment: 'production', // or 'development'
    apiUrl: 'https://api.icpay.com' // optional, defaults to production URL
  });

  try {
    console.log('=== ICPay SDK Public Mode Examples ===\n');

    // 1. Get basic account information (limited data)
    console.log('1. Fetching basic account information...');
    const accountInfo = await icpay.getAccountInfo();
    console.log('Account Info (Public):', {
      id: accountInfo.id,
      name: accountInfo.name,
      isActive: accountInfo.isActive,
      isLive: accountInfo.isLive,
      accountCanisterId: accountInfo.accountCanisterId,
      walletAddress: accountInfo.walletAddress,
      // Note: email and walletBalance are not available in public mode
    });

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

    // 4. Get detailed ledger information
    console.log('\n4. Fetching detailed ledger information...');
    const icpLedgerId = 'ryjl3-tyaaa-aaaaa-aaaba-cai'; // ICP ledger
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

    // 5. Calculate token amount from USD price
    console.log('\n5. Calculating token amount from USD...');
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

    // 6. Show available wallet providers (wallet methods still work)
    console.log('\n6. Available wallet providers:');
    const providers = icpay.getWalletProviders();
    providers.forEach(provider => {
      const isAvailable = icpay.isWalletProviderAvailable(provider.id);
      console.log(`- ${provider.name} (${provider.id}): ${isAvailable ? 'Available' : 'Not Available'}`);
    });

    // 7. Connect to wallet (wallet operations work independently)
    console.log('\n7. Connecting to wallet...');
    try {
      const connectionResult = await icpay.connectWallet('internet-identity');
      console.log('Wallet Connected:', {
        provider: connectionResult.provider,
        principal: connectionResult.principal,
        connected: connectionResult.connected
      });

      // 9. Get single ledger balance (this works with connected wallet)
      console.log('\n9. Getting single ledger balance...');
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

      // 10. Get all ledger balances (this works with connected wallet)
      console.log('\n10. Getting all ledger balances...');
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
      } catch (error) {
        console.log('Transaction failed (expected if insufficient balance):', error.message);
      }

    } catch (error) {
      console.log('Wallet operations failed (expected if no wallet available):', error.message);
    }

    console.log('\n=== Public Mode Examples Completed ===');
    console.log('\nNote: The following operations are NOT available in public mode:');
    console.log('- getTransactionHistory()');
    console.log('- getAccountWalletBalances()');

  } catch (error) {
    console.error('Error in public example:', error);
  }
}

// Run the example
publicExample().catch(console.error);

export default publicExample;
