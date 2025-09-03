export type RequestHeaders = Record<string, string>;

export class HttpClient {
  private baseURL: string;
  private defaultHeaders: RequestHeaders;

  constructor(options: { baseURL: string; headers?: RequestHeaders }) {
    this.baseURL = options.baseURL.replace(/\/$/, '');
    this.defaultHeaders = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  }

  setHeader(name: string, value: string | undefined) {
    if (value === undefined) {
      delete this.defaultHeaders[name];
    } else {
      this.defaultHeaders[name] = value;
    }
  }

  async get<T = any>(path: string, headers?: RequestHeaders): Promise<T> {
    const url = this.resolve(path);
    const res = await fetch(url, {
      method: 'GET',
      headers: { ...this.defaultHeaders, ...(headers || {}) },
    } as RequestInit);
    return this.handleResponse<T>(res);
  }

  async post<T = any>(path: string, body?: any, headers?: RequestHeaders): Promise<T> {
    const url = this.resolve(path);
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.defaultHeaders, ...(headers || {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    } as RequestInit);
    return this.handleResponse<T>(res);
  }

  private resolve(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.baseURL}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    const text = await res.text();
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJson && text ? (JSON.parse(text) as T) : (text as unknown as T);
    if (!res.ok) {
      const err: any = new Error(`HTTP ${res.status}: ${res.statusText}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data as T;
  }
}


