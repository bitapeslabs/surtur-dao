/** Pulsing placeholder block; size it with width/height classes. */
export default function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`oa-skel ${className}`} aria-hidden="true" />;
}
