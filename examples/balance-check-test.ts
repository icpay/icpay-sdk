import Icpay from '../src/index';

// Test the enhanced balance functionality
async function testEnhancedBalanceFeatures() {
  const icpay = new Icpay({
    secretKey: 'your-secret-key',
    environment: 'development',
    apiUrl: 'http://localhost:6201',
    icHost: 'http://localhost:8080'
  });

  try {
    console.log('=== Testing Enhanced Balance Features ===\n');

    // 1. Test getting verified ledgers with price information
    console.log('1. Testing getVerifiedLedgers with prices...');
    const verifiedLedgers = await icpay.getVerifiedLedgers();
    console.log('Verified Ledgers:', verifiedLedgers.map(ledger => ({
      symbol: ledger.symbol,
      canisterId: ledger.canisterId,
      currentPrice: ledger.currentPrice,
      lastPriceUpdate: ledger.lastPriceUpdate
    })));

    // 2. Test getting all ledgers with prices
    console.log('\n2. Testing getAllLedgersWithPrices...');
    const allLedgersWithPrices = await icpay.getAllLedgersWithPrices();
    console.log('All Ledgers with Prices:', allLedgersWithPrices.map(ledger => ({
      symbol: ledger.symbol,
      canisterId: ledger.canisterId,
      currentPrice: ledger.currentPrice
    })));

    // 3. Test price calculation
    console.log('\n3. Testing price calculation...');
    const icpLedgerId = 'ryjl3-tyaaa-aaaaa-aaaba-cai'; // ICP ledger

    try {
      const priceCalculation = await icpay.calculateTokenAmountFromUSD({
        usdAmount: 100,
        ledgerCanisterId: icpLedgerId
      });
      console.log('Price Calculation Result:', {
        usdAmount: priceCalculation.usdAmount,
        ledgerSymbol: priceCalculation.ledgerSymbol,
        currentPrice: priceCalculation.currentPrice,
        tokenAmountHuman: priceCalculation.tokenAmountHuman,
        tokenAmountDecimals: priceCalculation.tokenAmountDecimals,
        priceTimestamp: priceCalculation.priceTimestamp
      });
    } catch (error) {
      console.log('Price calculation failed (expected if no price data):', error.message);
    }

    // 4. Test getting ledger info
    console.log('\n4. Testing getLedgerInfo...');
    try {
      const ledgerInfo = await icpay.getLedgerInfo(icpLedgerId);
      console.log('Ledger Info:', {
        name: ledgerInfo.name,
        symbol: ledgerInfo.symbol,
        canisterId: ledgerInfo.canisterId,
        currentPrice: ledgerInfo.currentPrice,
        lastPriceUpdate: ledgerInfo.lastPriceUpdate
      });
    } catch (error) {
      console.log('Ledger info failed:', error.message);
    }

    // 5. Test getting account wallet balances (from API)
    console.log('\n5. Testing getAccountWalletBalances...');
    try {
      const accountBalances = await icpay.getAccountWalletBalances();
      console.log('Account Wallet Balances:', {
        totalBalancesUSD: accountBalances.totalBalancesUSD,
        lastUpdated: accountBalances.lastUpdated,
        balances: accountBalances.balances.map(balance => ({
          symbol: balance.ledgerSymbol,
          balance: balance.formattedBalance,
          currentPrice: balance.currentPrice
        }))
      });
    } catch (error) {
      console.log('Account wallet balances failed:', error.message);
    }

    // 6. Test sendFundsUsd functionality
    console.log('\n6. Testing sendFundsUsd...');
    try {
      const usdTransaction = await icpay.sendFundsUsd({
        usdAmount: 5.61, // $5.61 USD
        ledgerCanisterId: icpLedgerId,
        metadata: { description: 'Test USD transaction' }
      });
      console.log('USD Transaction Result:', {
        transactionId: usdTransaction.transactionId,
        status: usdTransaction.status,
        amount: usdTransaction.amount,
        timestamp: usdTransaction.timestamp
      });
    } catch (error) {
      console.log('sendFundsUsd failed (expected if no wallet connected):', error.message);
    }

    // 7. Test transaction history (without filters)
    console.log('\n7. Testing getTransactionHistory...');
    try {
      const history = await icpay.getTransactionHistory({
        limit: 5,
        offset: 0
      });
      console.log('Transaction History:', {
        total: history.total,
        hasMore: history.hasMore,
        transactions: history.transactions.map(tx => ({
          id: tx.id,
          status: tx.status,
          amount: tx.amount,
          currency: tx.currency,
          ledgerSymbol: tx.ledgerSymbol
        }))
      });
    } catch (error) {
      console.log('Transaction history failed:', error.message);
    }

    console.log('\n=== Enhanced Balance Features Test Completed ===');

  } catch (error) {
    console.error('Error in enhanced balance test:', error);
  }
}

// Run the test
testEnhancedBalanceFeatures().catch(console.error);

export default testEnhancedBalanceFeatures;