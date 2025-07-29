export class IcpayError extends Error {
  public code: string;
  public details?: any;

  constructor(error: { code: string; message: string; details?: any }) {
    super(error.message);
    this.name = 'IcpayError';
    this.code = error.code;
    this.details = error.details;
  }
}