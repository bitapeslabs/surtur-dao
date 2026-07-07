'use client';

/**
 * TokenIcon — simplified port of subfrost-app's TokenIcon: local svgs for
 * BTC / frBTC / DIESEL, `cdn.subfrost.io/alkanes/{block}_{tx}` for other
 * alkanes, hash-picked gradient letter circle as fallback.
 */

import { useEffect, useState } from 'react';

const SIZE_MAP = {
  xs: 'h-3.5 w-3.5 text-[7px]',
  sm: 'h-5 w-5 text-[10px]',
  md: 'h-7 w-7 text-xs',
  lg: 'h-9 w-9 text-sm',
} as const;

// DIESEL (2:0) intentionally NOT local — it resolves to
// cdn.subfrost.io/alkanes/2_0, matching the subfrost app's icon.
const LOCAL_ICONS: Record<string, string> = {
  btc: '/tokens/btc.svg',
  '32:0': '/tokens/frbtc.svg',
};

const GRADIENTS = [
  'from-blue-400 to-blue-600',
  'from-purple-400 to-purple-600',
  'from-green-400 to-green-600',
  'from-orange-400 to-orange-600',
  'from-pink-400 to-pink-600',
  'from-indigo-400 to-indigo-600',
  'from-teal-400 to-teal-600',
  'from-red-400 to-red-600',
];

function gradientFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length];
}

function iconUrlFor(id: string): string | null {
  if (LOCAL_ICONS[id]) return LOCAL_ICONS[id];
  const [block, tx] = id.split(':');
  if (block && tx) return `https://cdn.subfrost.io/alkanes/${block}_${tx}`;
  return null;
}

export default function TokenIcon({
  id,
  symbol,
  size = 'md',
  className = '',
}: {
  /** 'btc' or alkane "block:tx". */
  id: string;
  symbol: string;
  size?: keyof typeof SIZE_MAP;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);

  const url = iconUrlFor(id);
  const sizeClass = SIZE_MAP[size];

  if (!url || failed) {
    return (
      <div
        className={`${sizeClass} ${className} inline-flex items-center justify-center rounded-full bg-gradient-to-br ${gradientFor(symbol || id)} font-bold text-white shrink-0`}
      >
        {(symbol || id).slice(0, 1).toUpperCase()}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={symbol}
      className={`${sizeClass} ${className} rounded-full object-cover shrink-0`}
      onError={() => setFailed(true)}
    />
  );
}
