# subfrost-connect

Vendor-side SDK for connecting external apps to a SUBFROST wallet. Wraps the
`window.open` + `postMessage` popup flow so any dapp can:

1. **Connect** — open the SUBFROST `/request/wallets` popup, let the user
   unlock their keystore and pick an account, and receive the selected
   taproot address + public key.
2. **Sign** — open the SUBFROST `/request/sign` popup with an unsigned PSBT,
   let the user review the transaction overview and sign, and receive the
   signed PSBT back. The vendor app finalizes and broadcasts it.

## Usage

```ts
import {
  SubfrostConnector,
  SubfrostConnectError,
  saveSession,
  loadSession,
  clearSession,
} from 'subfrost-connect';

const connector = new SubfrostConnector({
  subfrostOrigin: 'http://localhost:3000', // or https://app.subfrost.io
});

// Connect
const session = await connector.connect();
saveSession(session); // optional persistence helper
console.log(session.account.address, session.account.publicKey, session.network);

// Request a signature for an unsigned PSBT you built
try {
  const { signedPsbtBase64 } = await connector.signPsbt({
    psbtBase64: unsignedPsbtBase64,
    label: 'Send 0.001 BTC',
  });
  // finalize + broadcast signedPsbtBase64 yourself
} catch (e) {
  if (e instanceof SubfrostConnectError && e.code === 'POPUP_CLOSED') {
    // user closed the popup — treat as cancelled
  }
}

// Disconnect (vendor-side only; no popup involved)
clearSession();
```

## Error codes

| Code | Meaning |
|---|---|
| `POPUP_BLOCKED` | `window.open` returned null — call from a user gesture |
| `POPUP_CLOSED` | User closed the popup before responding (cancellation) |
| `USER_REJECTED` | User clicked reject inside SUBFROST |
| `TIMEOUT` | No response within `timeoutMs` (default 5 min) |

## Protocol

See `src/protocol.ts`. The SUBFROST app keeps a synced copy at
`subfrost-app/lib/connect/protocol.ts`. Security notes:

- The popup identifies the vendor by the browser-set `event.origin` on the
  `init` message, not by any payload field.
- The vendor accepts popup messages only when `event.origin` matches the
  configured SUBFROST origin **and** `event.source` is the opened popup.
- Popup-close is polled so a closed popup rejects the pending promise.
