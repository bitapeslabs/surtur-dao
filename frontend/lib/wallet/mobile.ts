/**
 * SubfrostFrtunAdapter — pairs the SUBFROST mobile app over frtun p2p.
 *
 * Ported from subfrost-app (lib/wallet/SubfrostFrtunAdapter.ts). Flow:
 * connect() generates a dapp X25519 keypair + a frtun peer identity + a
 * 6-char pairing code, surfaces the `subfrost://wc/<peer>.peer?...`
 * QR via onPairingUri, then LISTENs on the frtun /v1/pair bridge. The
 * phone's in-app scanner dials in; the adapter derives the symKey and
 * resolves with the wallet's addresses. Subsequent signMessage calls run
 * over the same open bridge stream.
 *
 * NOTE (Surtur policy): mobile sessions can sign MESSAGES (votes,
 * proposals, resolutions) but portfolio SEND is disabled — signPsbt is
 * present for interface parity yet never reached because the wallet
 * context reports `canSend: false` for mobile.
 *
 * The session's symKey lives in memory only — a page reload requires
 * re-pairing (sessions are deliberately not persisted).
 */

import { connect, type FrtunSession } from '@/lib/wc/frtun/client';

export interface SubfrostFrtunAdapterOpts {
  /** Override the frtun bridge (defaults to wss://wss-tls.subfrost.io/v1/pair). */
  bridgeUrl?: string;
  origin?: string;
}

export class SubfrostFrtunAdapter {
  readonly id = 'subfrost-mobile';
  readonly name = 'SUBFROST Mobile';

  private session: FrtunSession | null = null;
  private opts: SubfrostFrtunAdapterOpts;
  /** The 6-char pairing code for the in-flight pairing — shown near the
   *  QR so the user can visually confirm on the phone (anti-MITM). */
  private _pairingCode: string | null = null;

  constructor(opts: SubfrostFrtunAdapterOpts = {}) {
    this.opts = opts;
  }

  get pairingCode(): string | null {
    return this._pairingCode;
  }

  /** Open a pairing handshake. Surfaces the QR URI (and pairing code)
   *  via callbacks; resolves once the phone dials in over frtun. */
  async connect(
    onPairingUri?: (uri: string) => void,
    onPairingCode?: (code: string) => void,
  ): Promise<{ addresses: string[] }> {
    const pairing = connect({
      bridgeUrl: this.opts.bridgeUrl,
      origin: this.opts.origin,
    });
    this._pairingCode = pairing.pairingCode;
    onPairingUri?.(pairing.pairingUri);
    onPairingCode?.(pairing.pairingCode);
    this.session = await pairing.accepted;
    const addresses = await this.session.getAccounts();
    return { addresses };
  }

  async signPsbt(psbtHex: string): Promise<string> {
    this.requireSession();
    return this.session!.signPsbt(psbtHex, []);
  }

  async signMessage(message: string, address: string): Promise<string> {
    this.requireSession();
    return this.session!.signMessage(message, address);
  }

  async getAccounts(): Promise<string[]> {
    this.requireSession();
    return this.session!.getAccounts();
  }

  async disconnect(): Promise<void> {
    if (this.session) {
      await this.session.disconnect();
      this.session = null;
    }
  }

  private requireSession(): void {
    if (!this.session) {
      throw new Error('SUBFROST Mobile not connected — call connect() first');
    }
  }
}
