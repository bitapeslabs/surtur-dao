'use client';

/**
 * Toast — a transient top-center notice in the oa card style (below the
 * sticky header). Auto-dismisses after a few seconds; clicking it
 * dismisses immediately.
 */

import { useEffect, type ReactNode } from 'react';

const TOAST_MS = 4_000;

export default function Toast({
  children,
  onClose,
  shake = false,
}: {
  children: ReactNode;
  onClose: () => void;
  /** Jolt on entry — signals an error rather than a neutral notice. */
  shake?: boolean;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, TOAST_MS);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4">
      <button
        type="button"
        className={`oa-card oa-hoverable px-4 py-3 shadow-xl text-sm flex items-center gap-2 whitespace-nowrap ${
          shake ? 'oa-shake' : ''
        }`}
        onClick={onClose}
      >
        {children}
      </button>
    </div>
  );
}
