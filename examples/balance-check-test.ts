import { Icpay } from '../src';

// Example demonstrating balance checking before sending funds
async function testBalanceChecking() {
  const icpay = new Icpay({
    accountId: 'your-account-id',
    secretKey: 'your-secret-key',
    environment: 'testnet'
  });

  try {
    // Connect wallet first
    await icpay.connectWallet('internet-identity');

    // Get current balance
    const balance = await icpay.getBalance();
    console.log('Current balance:', balance);

    // Try to send funds
    const transaction = await icpay.sendFunds({
      accountCanisterId: '123',
      ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai', // ICP ledger
      amount: '1000000000', // 1 ICP in e8s
      metadata: { description: 'Test transaction' }
    });

    console.log('Transaction successful:', transaction);
  } catch (error) {
    if (error.code === 'INSUFFICIENT_BALANCE') {
      console.error('❌ Insufficient balance error:', error.message);
      console.error('Details:', error.details);
    } else {
      console.error('❌ Other error:', error);
    }
  }
}

// Example showing how to handle insufficient balance errors
async function handleInsufficientBalance() {
  const icpay = new Icpay({
    accountId: 'your-account-id',
    secretKey: 'your-secret-key',
    environment: 'testnet'
  });

  try {
    await icpay.connectWallet('internet-identity');

    // Try to send more than available balance
    await icpay.sendFunds({
      accountCanisterId: '123',
      ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai',
      amount: '999999999999999', // Very large amount
      metadata: { description: 'This should fail' }
    });
  } catch (error) {
    if (error.code === 'INSUFFICIENT_BALANCE') {
      console.log('✅ Properly caught insufficient balance error');
      console.log('Error message:', error.message);
      console.log('Required amount:', error.details.required);
      console.log('Available amount:', error.details.available);

      // You can show this to the user
      const shortfall = error.details.required - error.details.available;
      console.log(`You need ${shortfall} more tokens to complete this transaction`);
    }
  }
}

// Run the examples
if (require.main === module) {
  console.log('Testing balance checking functionality...\n');

  testBalanceChecking().then(() => {
    console.log('\n---\n');
    return handleInsufficientBalance();
  }).catch(console.error);
}