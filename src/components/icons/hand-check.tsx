interface HandCheckProps {
  size?: number;
  className?: string;
}

/**
 * A checkmark drawn the way a pen would: a short hesitant down-stroke, then one long
 * flick up and out that overshoots the corner. The two segments meet at a slightly
 * rounded point instead of a hard angle and the tail leans, so it reads as ticked by
 * hand rather than as a stock icon. Stroke-only, `currentColor`, round caps.
 */
export function HandCheck({ size = 16, className }: HandCheckProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M2 8.7c1.1.7 2.2 1.9 3.3 4 .3.6.6.5.9-.2C8 8.7 10.9 5.1 14.4 2.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
