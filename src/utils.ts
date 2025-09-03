/**
 * Debug logger utility
 * Only outputs console.log messages when debug is enabled
 * @param debug - Whether debug mode is enabled
 * @param message - The message to log
 * @param data - Optional data to log
 */
export function debugLog(debug: boolean, message: string, data?: any): void {
  if (debug) {
    if (data !== undefined) {
      console.log(`[ICPay SDK] ${message}`, data);
    } else {
      console.log(`[ICPay SDK] ${message}`);
    }
  }
}
