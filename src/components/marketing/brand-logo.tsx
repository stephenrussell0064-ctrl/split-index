export function BrandLogo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <clipPath id="logoLab">
          <path d="M0 0 H40 L24 64 H0 Z" />
        </clipPath>
        <clipPath id="logoEng">
          <path d="M40 0 H64 V64 H24 Z" />
        </clipPath>
      </defs>
      <g clipPath="url(#logoLab)">
        <rect width="64" height="64" rx="16" fill="#070908" />
        <circle cx="32" cy="32" r="17" fill="none" stroke="#3DFF6E" strokeWidth="7" />
      </g>
      <g clipPath="url(#logoEng)">
        <rect width="64" height="64" rx="16" fill="#F7FBFF" />
        <circle cx="32" cy="32" r="17" fill="none" stroke="#3BA6FF" strokeWidth="7" />
      </g>
      <line x1="40" y1="0" x2="24" y2="64" stroke="#fff" strokeWidth="2.5" opacity="0.9" />
    </svg>
  );
}

export function BrandWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-black text-sm tracking-[0.14em] ${className}`}>
      <span className="text-gym-accent">SPLIT</span>
      <span className="mx-0.5 font-medium text-white/35">/</span>
      <span className="text-cardio-accent">INDEX</span>
    </span>
  );
}
