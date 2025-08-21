import { Icpay } from '../src';

async function debugExample() {
  console.log('=== ICPay SDK Debug Configuration Example ===\n');

  // Example 1: Debug disabled (default behavior)
  console.log('1. Creating SDK with debug: false (default)');
  const sdkNoDebug = new Icpay({
    publishableKey: 'pk_test_example',
    debug: false
  });
  console.log('   SDK created - no debug messages should appear above\n');

  // Example 2: Debug enabled
  console.log('2. Creating SDK with debug: true');
  const sdkWithDebug = new Icpay({
    publishableKey: 'pk_test_example',
    debug: true
  });
  console.log('   SDK created - debug messages should appear above\n');

  // Example 3: Debug not specified (should default to false)
  console.log('3. Creating SDK without debug specified');
  const sdkDefault = new Icpay({
    publishableKey: 'pk_test_example'
  });
  console.log('   SDK created - no debug messages should appear above\n');

  console.log('=== Debug Configuration Example Completed ===');
  console.log('\nKey points:');
  console.log('- When debug: false (or not set), no console.log messages are output');
  console.log('- When debug: true, all SDK operations will log detailed information');
  console.log('- This helps with development and troubleshooting without cluttering production logs');
}

// Run the example
debugExample().catch(console.error);
