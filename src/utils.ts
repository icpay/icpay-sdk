function redactSecrets(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value !== 'object') return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    const shouldRedact =
      lower.includes('secret') ||
      lower.includes('token') ||
      lower.includes('authorization') ||
      lower.includes('api_key') ||
      lower.includes('apikey') ||
      lower.includes('password');
    redacted[key] = shouldRedact ? '[REDACTED]' : redactSecrets(nestedValue);
  }
  return redacted;
}

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
      console.log(`[ICPay SDK] ${message}`, redactSecrets(data));
    } else {
      console.log(`[ICPay SDK] ${message}`);
    }
  }
}
