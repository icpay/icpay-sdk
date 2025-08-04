import { AuthClient } from '@dfinity/auth-client';
import { Identity } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { WalletInfo, Balance, WalletProvider, WalletConnectionResult } from './types';
import { IcpayError } from './errors';
import { HttpAgent } from '@dfinity/agent';
import { Actor } from '@dfinity/agent';
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
  private authClient: AuthClient | null = null;
  private identity: Identity | null = null;
  private principal: Principal | null = null;
  private connectedProvider: string | null = null;
  private externalWallet: any = null;
  private usePlugNPlay: boolean = false;
  private plugNPlayConfig: Record<string, any> = {};

  constructor(options?: { externalWallet?: any; usePlugNPlay?: boolean; plugNPlayConfig?: Record<string, any> }) {
    if (options?.externalWallet) {
      this.externalWallet = options.externalWallet;
    }
    if (options?.usePlugNPlay) {
      this.usePlugNPlay = true;
      this.plugNPlayConfig = options.plugNPlayConfig || {};
      // TODO: Initialize Plug N Play here
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
          throw new IcpayError({
            code: 'UNSUPPORTED_PROVIDER',
            message: `Unsupported wallet provider: ${providerId}`
          });
      }
    } catch (error) {
      throw new IcpayError({
        code: 'WALLET_CONNECTION_FAILED',
        message: `Failed to connect to ${providerId}`,
        details: error
      });
    }
  }

  /**
   * Connect to Internet Identity
   */
  private async connectInternetIdentity(): Promise<WalletConnectionResult> {
    // Initialize auth client
    this.authClient = await AuthClient.create();

    // Check if already authenticated
    if (await this.authClient.isAuthenticated()) {
      this.identity = this.authClient.getIdentity();
      this.principal = this.identity.getPrincipal();
      this.connectedProvider = 'internet-identity';
    } else {
      // Start authentication process
      await new Promise<void>((resolve, reject) => {
        this.authClient!.login({
          identityProvider: 'https://identity.ic0.app',
          onSuccess: () => {
            this.identity = this.authClient!.getIdentity();
            this.principal = this.identity.getPrincipal();
            this.connectedProvider = 'internet-identity';
            resolve();
          },
          onError: (error: string | undefined) => {
            reject(new Error(`Authentication failed: ${error || 'Unknown error'}`));
          },
        });
      });
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
      throw new Error('OISY wallet is not available');
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
        throw new Error('OISY connection was rejected');
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
   * Get the balance of the connected wallet
   */
  async getBalance(): Promise<Balance> {
    if (!this.isConnected()) {
      throw new IcpayError({
        code: 'WALLET_NOT_CONNECTED',
        message: 'Wallet is not connected'
      });
    }

    try {
      let principal: Principal | null = null;

      // Use external wallet if available
      if (this.externalWallet) {
        // For Plug N Play wallets, extract principal from the account object
        if (this.externalWallet.owner) {
          // Convert owner string to principal
          try {
            principal = Principal.fromText(this.externalWallet.owner);
          } catch (error) {
            console.warn('Failed to parse principal from owner:', error);
          }
        } else if (this.externalWallet.principal) {
          principal = this.externalWallet.principal;
        }
      } else {
        // Use internal principal
        principal = this.principal;
      }

      if (!principal) {
        throw new IcpayError({
          code: 'WALLET_NOT_CONNECTED',
          message: 'No valid principal found'
        });
      }

      // For Plug N Play wallets, we need to use anonymous actor for balance checking
      // since balance queries don't require signing
      const agent = new HttpAgent({
        host: 'https://ic0.app'
      });

      // Fetch ICP balance from the ICP ledger
      const icpLedgerId = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
      const icpLedger = Actor.createActor(ledgerIdl, {
        agent,
        canisterId: icpLedgerId
      });

      let icpBalance = 0;
      try {
        const icpAccount = {
          owner: principal,
          subaccount: []
        };
        const icpBalanceResult = await icpLedger.icrc1_balance_of(icpAccount);
        icpBalance = Number(icpBalanceResult);
      } catch (error) {
        console.warn('Failed to fetch ICP balance:', error);
      }

      // For now, return mock data for other tokens
      // TODO: Implement real balance fetching for other ledgers
      return {
        icp: icpBalance,
        icpayTest: 0 // Mock data for now
      };
    } catch (error) {
      throw new IcpayError({
        code: 'BALANCE_FETCH_FAILED',
        message: 'Failed to fetch wallet balance',
        details: error
      });
    }
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
    // If using an external wallet, check for various properties that indicate connection
    if (this.externalWallet) {
      // Check if it has a principal/owner property (Plug N Play style)
      if (this.externalWallet.owner || this.externalWallet.principal) {
        return true;
      }
      // Check if it has getPrincipal method
      if (typeof this.externalWallet.getPrincipal === 'function') {
        return true;
      }
      // Check for connected property
      if ('connected' in this.externalWallet) {
        return !!this.externalWallet.connected;
      }
      // If it's a non-null object, assume it's connected
      return this.externalWallet !== null && typeof this.externalWallet === 'object';
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