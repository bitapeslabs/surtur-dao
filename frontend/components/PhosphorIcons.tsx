/**
 * Phosphor Icons arrows (MIT © 2020 Phosphor Icons), inlined with
 * `currentColor` like the rest of the icon set.
 */

function PhIcon({ d, size, className }: { d: string; size: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export function PhArrowRight({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <PhIcon
      size={size}
      className={className}
      d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z"
    />
  );
}

export function PhArrowUpRight({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <PhIcon
      size={size}
      className={className}
      d="M200,64V168a8,8,0,0,1-16,0V83.31L69.66,197.66a8,8,0,0,1-11.32-11.32L172.69,72H88a8,8,0,0,1,0-16H192A8,8,0,0,1,200,64Z"
    />
  );
}

/** Phosphor "question" (fill) — question mark in a circle. */
export function PhQuestion({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <PhIcon
      size={size}
      className={className}
      d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,168a12,12,0,1,1,12-12A12,12,0,0,1,128,192Zm8-48.72V144a8,8,0,0,1-16,0v-8a8,8,0,0,1,8-8c13.23,0,24-9,24-20s-10.77-20-24-20-24,9-24,20v4a8,8,0,0,1-16,0v-4c0-19.85,17.94-36,40-36s40,16.15,40,36C168,125.38,154.24,139.93,136,143.28Z"
    />
  );
}

/** Phosphor "translate" (fill) — A / 文 language glyph. */
export function PhDeviceMobile({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill="currentColor"
      viewBox="0 0 256 256"
      className={className}
      aria-hidden
    >
      <path d="M176,16H80A24,24,0,0,0,56,40V216a24,24,0,0,0,24,24h96a24,24,0,0,0,24-24V40A24,24,0,0,0,176,16Zm8,200a8,8,0,0,1-8,8H80a8,8,0,0,1-8-8V40a8,8,0,0,1,8-8h96a8,8,0,0,1,8,8ZM140,60a12,12,0,1,1-12-12A12,12,0,0,1,140,60Z" />
    </svg>
  );
}

export function PhTranslate({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <PhIcon
      size={size}
      className={className}
      d="M239.15,212.42l-56-112a8,8,0,0,0-14.31,0l-21.71,43.43A88,88,0,0,1,100,126.93,103.65,103.65,0,0,0,127.69,64H152a8,8,0,0,0,0-16H96V32a8,8,0,0,0-16,0V48H24a8,8,0,0,0,0,16h87.63A87.76,87.76,0,0,1,88,116.35a87.74,87.74,0,0,1-19-31,8,8,0,1,0-15.08,5.34A103.63,103.63,0,0,0,76,127a87.55,87.55,0,0,1-52,17,8,8,0,0,0,0,16,103.46,103.46,0,0,0,64-22.08,104.18,104.18,0,0,0,51.44,21.31l-26.6,53.19a8,8,0,0,0,14.31,7.16L143.28,192h65.43l16.13,32.42a8,8,0,1,0,14.31-7.16ZM151.28,176,176,126.59,200.72,176Z"
    />
  );
}
