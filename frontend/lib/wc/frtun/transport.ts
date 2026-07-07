/**
 * Browser frtun-pair transport — the LISTEN side of the /v1/pair
 * bridge handshake, using the browser's native `WebSocket`.
 *
 * This is the browser port of subfrost-mobile's
 * `ts-sdk/src/frtun-transport.ts` (which is Node-only — it imports the
 * `ws` package + `node:events`). The wire behavior is identical; only
 * the text-vs-binary discrimination differs:
 *
 *   - node `ws`: the `'message'` handler gets `(data, isBinary)`.
 *   - browser `WebSocket`: `event.data` is a `string` for text frames
 *     and an `ArrayBuffer` for binary frames (with `binaryType =
 *     'arraybuffer'`).
 *
 * Handshake (LISTEN role — the webapp/dapp side):
 *   1. open WSS to `wss://wss-tls.subfrost.io/v1/pair`
 *   2. send `listenFrame(selfPeer)`  (TEXT)
 *   3. await `{event:'ready'}`        → now safe to render the QR
 *   4. await `{event:'incoming',peer}`→ the phone dialed in
 *   5. data phase: the phone's FIRST binary frame is its X25519 pub
 *      (43-char base64url utf-8); subsequent binary frames are
 *      `{ciphertextB64,nonceB64}` JSON envelopes.
 *
 * Source: reference/subfrost-mobile/ts-sdk/src/frtun-transport.ts +
 * reference/alkanes-rs-develop-wc/vendor/frtun-pair/src/{protocol,
 * handshake,client_native}.rs.
 */

import { listenFrame, parseServerFrame } from './frames';

export const DEFAULT_BRIDGE_URL = 'wss://wss-tls.subfrost.io/v1/pair';

export class FrtunPairError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`frtun-pair:${code} ${message}`);
    this.name = 'FrtunPairError';
  }
}

/** A bidirectional binary frame stream over the post-handshake bridge
 *  socket. One `send()` / one inbound `'message'` == one WS binary frame
 *  (the bridge forwards frames verbatim, no length prefix). Post-
 *  handshake text frames are a protocol violation and are ignored.
 *
 *  Inbound frames are FIFO-queued and matched to FIFO `next()` waiters,
 *  so no frame is ever dropped or double-delivered regardless of arrival
 *  timing (the phone's mobilePub frame can arrive in the same tick as
 *  construction and is still queued). `next()` also settles on socket
 *  close/error so a request never hangs to its timeout on a dead socket. */
export class FrtunStream {
  /** Frames received with no waiter yet (FIFO). */
  private readonly inbox: Uint8Array[] = [];
  /** Pending `next()` waiters (FIFO). */
  private readonly waiters: Array<{
    resolve: (chunk: Uint8Array) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout> | null;
  }> = [];
  private closedErr: Error | null = null;

  constructor(
    private readonly ws: WebSocket,
    public readonly remotePeer: string,
    /** Frames that were buffered during the handshake handoff, before
     *  this stream owned the socket. Replayed FIFO so the phone's first
     *  binary frame is never lost. */
    prebuffered: Uint8Array[] = [],
  ) {
    for (const b of prebuffered) this.inbox.push(b);
    this.ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') return; // ignore post-handshake text
      this.deliver(new Uint8Array(ev.data as ArrayBuffer));
    };
    this.ws.onclose = () => this.fail(new FrtunPairError('internal', 'bridge closed'));
    this.ws.onerror = () => this.fail(new FrtunPairError('internal', 'ws error'));
    // a waiter may already be flushable from prebuffered frames
    this.pump();
  }

  private deliver(chunk: Uint8Array): void {
    this.inbox.push(chunk);
    this.pump();
  }

  /** Match queued frames to queued waiters, FIFO. */
  private pump(): void {
    while (this.inbox.length && this.waiters.length) {
      const w = this.waiters.shift()!;
      if (w.timer) clearTimeout(w.timer);
      w.resolve(this.inbox.shift()!);
    }
  }

  /** Reject every pending waiter on socket death; subsequent next()
   *  calls reject immediately. */
  private fail(err: Error): void {
    if (!this.closedErr) this.closedErr = err;
    while (this.waiters.length) {
      const w = this.waiters.shift()!;
      if (w.timer) clearTimeout(w.timer);
      w.reject(err);
    }
  }

  /** Await exactly the next inbound binary frame (FIFO). Rejects on
   *  timeout or socket close/error. */
  next(timeoutMs = 5 * 60_000): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      if (this.closedErr) { reject(this.closedErr); return; }
      const w = { resolve, reject, timer: null as ReturnType<typeof setTimeout> | null };
      w.timer = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new FrtunPairError('internal', 'timed out waiting for frame'));
      }, timeoutMs);
      this.waiters.push(w);
      this.pump();
    });
  }

  send(bytes: Uint8Array): void {
    // copy into a fresh ArrayBuffer-backed view so we never hand the WS
    // a SharedArrayBuffer-backed slice.
    this.ws.send(bytes.slice().buffer);
  }

  close(): void {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

function openWs(url: string): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new FrtunPairError('internal', `cannot open ${url}`));
  });
}

/** Resolve on the next inbound TEXT frame, skipping binary (pings). */
function firstTextFrame(ws: WebSocket): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') return; // skip binary
      cleanup();
      resolve(ev.data);
    };
    const onErr = () => { cleanup(); reject(new FrtunPairError('internal', 'ws error')); };
    const onClose = () => { cleanup(); reject(new FrtunPairError('internal', 'bridge closed before handshake')); };
    const cleanup = () => {
      ws.removeEventListener('message', onMsg as EventListener);
      ws.removeEventListener('error', onErr);
      ws.removeEventListener('close', onClose);
    };
    ws.addEventListener('message', onMsg as EventListener);
    ws.addEventListener('error', onErr);
    ws.addEventListener('close', onClose);
  });
}

export interface ListenOptions {
  bridgeUrl?: string;
  /** This peer's frtun `frtun1….peer` name (the LISTEN identity). */
  selfPeer: string;
  /** Fired once the bridge accepts the listen registration — the QR may
   *  now be published (the phone can dial in). */
  onReady?: () => void;
  /** How long to wait for the phone to dial in. Default 5 min. */
  incomingTimeoutMs?: number;
  /** Abort an in-flight listen (closes the socket + rejects). Lets the
   *  caller's cancel() tear down a pair-in-progress before the phone
   *  dials in, instead of leaking the WSS to the 5-min timeout. */
  signal?: AbortSignal;
}

/** LISTEN on the bridge for an inbound dial. Resolves once a peer dials
 *  in, returning the binary stream over the same socket. */
export async function listen(opts: ListenOptions): Promise<FrtunStream> {
  if (opts.signal?.aborted) throw new FrtunPairError('internal', 'aborted');
  const url = opts.bridgeUrl ?? DEFAULT_BRIDGE_URL;
  const ws = await openWs(url);
  // Tear the socket down on abort — closing it rejects the in-flight
  // firstTextFrame/waitForIncoming promise via their onClose handlers.
  const onAbort = () => { try { ws.close(); } catch { /* */ } };
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  // Capture any BINARY frame that arrives during the handshake (the
  // phone's first binary frame — its mobilePub — can be pipelined right
  // after the `incoming` text frame and would otherwise be lost in the
  // window between waitForIncoming's cleanup and FrtunStream taking over
  // `ws.onmessage`). These are replayed into the stream's inbox.
  const prebuffered: Uint8Array[] = [];
  const binCollector = (ev: MessageEvent) => {
    if (typeof ev.data !== 'string') prebuffered.push(new Uint8Array(ev.data as ArrayBuffer));
  };
  ws.addEventListener('message', binCollector as EventListener);

  try {
    ws.send(listenFrame(opts.selfPeer));

    const ready = parseServerFrame(await firstTextFrame(ws));
    if (ready.event !== 'ready') {
      throw ready.event === 'error'
        ? new FrtunPairError(ready.code ?? 'unknown', ready.msg ?? '')
        : new FrtunPairError('bad_frame', `expected ready, got ${ready.event}`);
    }
    opts.onReady?.();

    const incoming = await waitForIncoming(ws, opts.incomingTimeoutMs ?? 5 * 60_000);
    if (incoming.event !== 'incoming') {
      throw incoming.event === 'error'
        ? new FrtunPairError(incoming.code ?? 'unknown', incoming.msg ?? '')
        : new FrtunPairError('bad_frame', `expected incoming, got ${incoming.event}`);
    }
    // Detach the collector and hand its frames to the stream BEFORE any
    // new binary frame can be dispatched (synchronous — no await between).
    ws.removeEventListener('message', binCollector as EventListener);
    return new FrtunStream(ws, incoming.peer ?? '', prebuffered);
  } catch (e) {
    ws.removeEventListener('message', binCollector as EventListener);
    ws.close();
    throw e;
  }
}

function waitForIncoming(ws: WebSocket, timeoutMs: number): Promise<ReturnType<typeof parseServerFrame>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new FrtunPairError('internal', 'timed out waiting for phone to scan'));
    }, timeoutMs);
    const onMsg = (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') return;
      cleanup();
      try { resolve(parseServerFrame(ev.data)); } catch (e) { reject(e as Error); }
    };
    const onErr = () => { cleanup(); reject(new FrtunPairError('internal', 'ws error')); };
    const onClose = () => { cleanup(); reject(new FrtunPairError('internal', 'bridge closed waiting for dial')); };
    const cleanup = () => {
      clearTimeout(t);
      ws.removeEventListener('message', onMsg as EventListener);
      ws.removeEventListener('error', onErr);
      ws.removeEventListener('close', onClose);
    };
    ws.addEventListener('message', onMsg as EventListener);
    ws.addEventListener('error', onErr);
    ws.addEventListener('close', onClose);
  });
}
