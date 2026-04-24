import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { WalletProvider, WalletConnectionResult } from './types';
import { IcpayError, createWalletError, ICPAY_ERROR_CODES } from './errors';
import { HttpAgent } from '@icp-sdk/core/agent';
import { Actor } from '@icp-sdk/core/agent';
import { idlFactory as ledgerIdl } from './declarations/icrc-ledger/ledger.did.js';

// Type declarations for browser APIs
declare global {
  interface Window {
    oisy?: {
      requestConnect(): Promise<{ connected: boolean; principal: string }>;
    };
    ic?: {
      plug?: {
        requestConnect(): Promise<boolean>;
        getPrincipal(): Promise<string>;
      };
    };
  }
}

export class IcpayWallet {
  private authClient: {
    isAuthenticated(): boolean;
    getIdentity(): Promise<Identity>;
    signIn(options?: { maxTimeToLive?: bigint; targets?: Principal[] }): Promise<Identity>;
    logout(options?: { returnTo?: string }): Promise<void>;
  } | null = null;
  private identity: Identity | null = null;
  private principal: Principal | null = null;
  private connectedProvider: string | null = null;
  private connectedWallet: any = null;

  constructor(options?: { connectedWallet?: any }) {
    if (options?.connectedWallet) {
      this.connectedWallet = options.connectedWallet;
    }
  }

  // Available wallet providers
  private readonly providers: WalletProvider[] = [
    {
      id: 'internet-identity',
      name: 'Internet Identity',
      icon: '🌐',
      description: 'Official Internet Computer identity provider'
    },
    {
      id: 'oisy',
      name: 'OISY',
      icon: '🔐',
      description: 'OISY wallet for Internet Computer'
    },
    {
      id: 'plug',
      name: 'Plug Wallet',
      icon: '🔌',
      description: 'Plug wallet extension'
    }
  ];

  private async createAuthClient() {
    const { AuthClient } = await import('@icp-sdk/auth/client');
    return new AuthClient();
  }

  /**
   * Get available wallet providers
   */
  getProviders(): WalletProvider[] {
    return this.providers;
  }

  /**
   * Check if a specific provider is available
   */
  isProviderAvailable(providerId: string): boolean {
    if (typeof window === 'undefined') return false;

    switch (providerId) {
      case 'internet-identity':
        return true; // Always available
      case 'oisy':
        return 'oisy' in window;
      case 'plug':
        return 'ic' in window && window.ic !== undefined && 'plug' in window.ic;
      default:
        return false;
    }
  }

  /**
   * Connect to a specific wallet provider
   */
  async connectToProvider(providerId: string): Promise<WalletConnectionResult> {
    try {
      switch (providerId) {
        case 'internet-identity':
          return await this.connectInternetIdentity();
        case 'oisy':
          return await this.connectOisy();
        case 'plug':
          return await this.connectPlug();
        default:
          throw createWalletError(ICPAY_ERROR_CODES.UNSUPPORTED_PROVIDER, `Unsupported wallet provider: ${providerId}`);
      }
    } catch (error) {
      // Check if it's a user cancellation
      if (error instanceof Error && (error.message.includes('rejected') || error.message.includes('cancelled'))) {
        throw createWalletError(ICPAY_ERROR_CODES.WALLET_USER_CANCELLED, `Connection to ${providerId} was cancelled by user`);
      }
      throw createWalletError(ICPAY_ERROR_CODES.WALLET_CONNECTION_FAILED, `Failed to connect to ${providerId}`, error);
    }
  }

  /**
   * Connect to Internet Identity
   */
  private async connectInternetIdentity(): Promise<WalletConnectionResult> {
    // Initialize auth client
    const authClient = await this.createAuthClient();
    this.authClient = authClient;

    // Check if already authenticated
    if (authClient.isAuthenticated()) {
      const identity = await authClient.getIdentity();
      this.identity = identity;
      this.principal = identity.getPrincipal();
      this.connectedProvider = 'internet-identity';
    } else {
      const identity = await authClient.signIn();
      this.identity = identity;
      this.principal = identity.getPrincipal();
      this.connectedProvider = 'internet-identity';
    }

    return {
      provider: 'internet-identity',
      principal: this.principal!.toText(),
      accountId: this.principal!.toText(),
      connected: true
    };
  }

  /**
   * Connect to OISY wallet
   */
  private async connectOisy(): Promise<WalletConnectionResult> {
    if (typeof window === 'undefined' || !window.oisy) {
      throw createWalletError(ICPAY_ERROR_CODES.WALLET_PROVIDER_NOT_AVAILABLE, 'OISY wallet is not available');
    }

    try {
      const result = await window.oisy.requestConnect();
      if (result.connected) {
        this.principal = Principal.fromText(result.principal);
        this.connectedProvider = 'oisy';

        return {
          provider: 'oisy',
          principal: result.principal,
          accountId: result.principal,
          connected: true
        };
      } else {
        throw createWalletError(ICPAY_ERROR_CODES.WALLET_USER_CANCELLED, 'OISY connection was rejected by user');
      }
    } catch (error) {
      throw new Error(`OISY connection failed: ${error}`);
    }
  }

  /**
   * Connect to Plug wallet
   */
  private async connectPlug(): Promise<WalletConnectionResult> {
    if (typeof window === 'undefined' || !window.ic?.plug) {
      throw new Error('Plug wallet is not available');
    }

    try {
      const connected = await window.ic.plug.requestConnect();
      if (connected) {
        const principal = await window.ic.plug.getPrincipal();
        this.principal = Principal.fromText(principal);
        this.connectedProvider = 'plug';

        return {
          provider: 'plug',
          principal: principal,
          accountId: principal,
          connected: true
        };
      } else {
        throw new Error('Plug connection was rejected');
      }
    } catch (error) {
      throw new Error(`Plug connection failed: ${error}`);
    }
  }

  /**
   * Show wallet connection modal
   */
  async showConnectionModal(): Promise<WalletConnectionResult> {
    // In a real implementation, this would show a modal UI
    // For now, we'll return the first available provider
    const availableProviders = this.providers.filter(provider =>
      this.isProviderAvailable(provider.id)
    );

    if (availableProviders.length === 0) {
      throw new IcpayError({
        code: 'NO_PROVIDERS_AVAILABLE',
        message: 'No wallet providers are available'
      });
    }

    // For demo purposes, use the first available provider
    return await this.connectToProvider(availableProviders[0].id);
  }

  /**
   * Get the connected wallet's account address
   */
  getAccountAddress(): string {
    if (!this.principal) {
      throw new IcpayError({
        code: 'WALLET_NOT_CONNECTED',
        message: 'Wallet is not connected'
      });
    }
    return this.principal.toText();
  }

  /**
   * Disconnect from the wallet
   */
  async disconnect(): Promise<void> {
    if (this.authClient) {
      await this.authClient.logout();
    }

    // Reset all state
    this.authClient = null;
    this.identity = null;
    this.principal = null;
    this.connectedProvider = null;
  }

  /**
   * Check if wallet is connected
   */
  isConnected(): boolean {
    // If using a connected wallet, check for various properties that indicate connection
    if (this.connectedWallet) {
      // Check if it has a principal/owner property (Plug N Play style)
      if (this.connectedWallet.owner || this.connectedWallet.principal) {
        return true;
      }
      // Check if it has getPrincipal method
      if (typeof this.connectedWallet.getPrincipal === 'function') {
        return true;
      }
      // Check for connected property
      if ('connected' in this.connectedWallet) {
        return !!this.connectedWallet.connected;
      }
      // If it's a non-null object, assume it's connected
      return this.connectedWallet !== null && typeof this.connectedWallet === 'object';
    }
    return this.identity !== null && this.principal !== null;
  }

  /**
   * Get the current identity
   */
  getIdentity(): Identity | null {
    return this.identity;
  }

  /**
   * Get the current principal
   */
  getPrincipal(): Principal | null {
    return this.principal;
  }

  /**
   * Get the connected provider
   */
  getConnectedProvider(): string | null {
    return this.connectedProvider;
  }
}