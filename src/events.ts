export type IcpayEventName =
  | 'icpay-sdk-error'
  | 'icpay-sdk-transaction-created'
  | 'icpay-sdk-transaction-updated'
  | 'icpay-sdk-transaction-completed'
  | 'icpay-sdk-transaction-failed'
  | 'icpay-sdk-transaction-mismatched'
  | 'icpay-sdk-connect-wallet'
  | 'icpay-sdk-method-start'
  | 'icpay-sdk-method-success'
  | 'icpay-sdk-method-error';

type GenericEvent = { type: string; detail?: any };
type Listener = (event: GenericEvent) => void;

/**
 * Small, cross-environment event center.
 * - Uses DOM EventTarget when available (browser)
 * - Falls back to an in-memory emitter (Node or non-DOM envs)
 */
export class IcpayEventCenter {
  private target: EventTarget | null;
  private listeners: Map<string, Set<Listener>>;
  private wrapperMap: Map<string, Map<Listener, EventListener>>;

  constructor() {
    this.target = typeof globalThis !== 'undefined' && typeof (globalThis as any).EventTarget === 'function'
      ? new (globalThis as any).EventTarget()
      : null;
    this.listeners = new Map();
    this.wrapperMap = new Map();
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (this.target) {
      this.target.addEventListener(type, listener as EventListener);
    } else {
      const set = this.listeners.get(type) || new Set();
      const wrapped: Listener = (event) => {
        if (typeof listener === 'function') {
          (listener as EventListener)(event as unknown as Event);
        } else if (listener && typeof (listener as EventListenerObject).handleEvent === 'function') {
          (listener as EventListenerObject).handleEvent(event as unknown as Event);
        }
      };
      set.add(wrapped);
      this.listeners.set(type, set);
    }
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (this.target) {
      this.target.removeEventListener(type, listener as EventListener);
    } else {
      const set = this.listeners.get(type);
      if (!set) return;
      // On fallback path we cannot reliably match the exact wrapper created in addEventListener,
      // so we clear the whole set for this type if remove is called.
      this.listeners.delete(type);
    }
  }

  dispatchEvent(event: Event | GenericEvent): boolean {
    if (this.target && (event as Event).type) {
      return this.target.dispatchEvent(event as Event);
    }
    const e = event as GenericEvent;
    const set = this.listeners.get(e.type);
    if (set) {
      set.forEach(fn => {
        try { fn(e); } catch {}
      });
    }
    return true;
  }

  on(type: IcpayEventName | string, listener: (detail: any) => void): () => void {
    if (this.target) {
      const wrapper: EventListener = (e: any) => listener(e && typeof e === 'object' ? (e.detail ?? e) : e);
      if (!this.wrapperMap.has(type)) this.wrapperMap.set(type, new Map());
      this.wrapperMap.get(type)!.set(listener as unknown as Listener, wrapper);
      this.target.addEventListener(type, wrapper);
      return () => this.off(type, listener);
    }
    const set = this.listeners.get(type) || new Set();
    const wrapped: Listener = (e) => listener(e.detail);
    set.add(wrapped);
    this.listeners.set(type, set);
    return () => {
      const current = this.listeners.get(type);
      if (current) {
        current.delete(wrapped);
        if (current.size === 0) this.listeners.delete(type);
      }
    };
  }

  off(type: IcpayEventName | string, listener: (detail: any) => void): void {
    if (this.target) {
      const typeMap = this.wrapperMap.get(type);
      const wrapper = typeMap?.get(listener as unknown as Listener);
      if (wrapper) {
        this.target.removeEventListener(type, wrapper);
        typeMap!.delete(listener as unknown as Listener);
      }
      return;
    }
    const set = this.listeners.get(type);
    if (set) {
      // Fallback: cannot map back original, clear all
      this.listeners.delete(type);
    }
  }

  emit(type: IcpayEventName | string, detail?: any): void {
    if (this.target) {
      const CE = (globalThis as any).CustomEvent;
      if (typeof CE === 'function') {
        this.target.dispatchEvent(new CE(type, { detail }));
        return;
      }
      const Evt = (globalThis as any).Event;
      const e = typeof Evt === 'function' ? new Evt(type) : ({ type } as Event);
      try { (e as any).detail = detail; } catch {}
      this.target.dispatchEvent(e);
      return;
    }
    const evt: GenericEvent = { type, detail };
    const set = this.listeners.get(type);
    if (set) {
      set.forEach(fn => {
        try { fn(evt); } catch {}
      });
    }
  }
}


