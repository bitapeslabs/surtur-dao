'use client';

import { useEffect } from 'react';

/**
 * Browser wallet extensions fight over `window.ethereum`: Phantom's evmAsk.js
 * (re)defines it when a page wakes it up and throws "Cannot redefine property:
 * ethereum" when another extension (OKX, MetaMask, …) already owns the slot.
 * The throw happens inside the extension's own listener — nothing of Surtur
 * is on the stack and nothing of Surtur reads `window.ethereum` — but it
 * reaches `window`'s error event, and Next's dev overlay puts it on screen as
 * a runtime error every time the connect modal opens.
 *
 * This swallows exactly that: an error raised by an extension script about
 * the `ethereum` slot. Everything else still reaches the overlay.
 */
const EXTENSION_SCRIPT = /^(chrome|moz|safari-web)-extension:\/\//;
const ETHEREUM_SLOT = /Cannot redefine property: ethereum|Cannot set property ethereum/;

function fromExtensionAboutEthereum(event: ErrorEvent): boolean {
  const message = event.message || (event.error instanceof Error ? event.error.message : '');
  if (!ETHEREUM_SLOT.test(message)) return false;
  const stack = event.error instanceof Error ? event.error.stack ?? '' : '';
  return EXTENSION_SCRIPT.test(event.filename ?? '') || /-extension:\/\//.test(stack) || !event.filename;
}

export default function ExtensionErrorGuard() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (!fromExtensionAboutEthereum(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    // capture phase: at the window target, capturing listeners run before the
    // overlay's bubbling one whatever the registration order
    window.addEventListener('error', onError, true);
    return () => window.removeEventListener('error', onError, true);
  }, []);
  return null;
}
