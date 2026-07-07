/**
 * Surtur logo — torch silhouette from agent-context/svgs/torch-silhouette.svg,
 * rendered pure white per the brand direction, tilted slightly left.
 */
export default function SurturLogo({
  size = 22,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      className={`-rotate-12 ${className}`}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="#ffffff"
        d="M32 4 C26 12 18.5 19 18.5 27.5 A13.5 13.5 0 0 0 45.5 27.5 C45.5 19 38 12 32 4 Z M32 17 C29 21 25.5 24.5 25.5 29 A6.5 6.5 0 0 0 38.5 29 C38.5 24.5 35 21 32 17 Z"
      />
      <path
        fill="#ffffff"
        d="M21 42 L43 42 L39 52 L25 52 Z M29 52 L35 52 L33.4 61 L30.6 61 Z"
      />
    </svg>
  );
}
