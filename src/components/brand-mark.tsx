type BrandMarkProps = {
  className?: string;
};

export function BrandMark({ className = "" }: BrandMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="38" height="38" rx="12" fill="var(--lime)" />
      <path d="M10 12h15M10 19h15M10 26h8" stroke="#11150c" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="28" cy="27" r="6" fill="#11150c" />
      <path d="M25.5 27h5" stroke="var(--lime)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
