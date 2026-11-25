// Logos ronds des opérateurs Mobile Money (pied de page public). Dessins simplifiés, sur fond plein : le cercle est découpé par le CSS (.sf-op).
export const OPERATOR_LOGOS = {
  orange: (
    <svg aria-hidden="true" focusable="false" viewBox="-4 0 68 64" width="30" height="30">
      <rect x="-4" width="68" height="64" fill="#000" />
      <path d="M10 42 26 26M15 24h11v11" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M44 22 28 38M39 40H28V29" stroke="#ff7900" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  ),
  moov: (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 64 64" width="30" height="30">
      <rect width="64" height="64" fill="#0060a9" />
      <rect x="15" y="15" width="34" height="34" rx="4" transform="rotate(45 32 32)" fill="#f07c00" />
      <text x="32" y="38" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="900" fontStyle="italic" fontSize="17" fill="#fff">M</text>
    </svg>
  ),
  wave: (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 512 512" width="30" height="30">
      <rect width="512" height="512" fill="#1dc8f2" />
      <path d="M140 168c10-8 22-6 30 2l26 24c6-52 30-96 74-96 40 0 68 32 72 68l30 230c4 40-30 52-60 52H222c-36 0-50-30-46-62l2-28c-14-6-24-16-36-30l-24-24c-16-18-14-42 0-54Z" fill="#000" />
      <ellipse cx="273" cy="312" rx="53" ry="88" fill="#fff" />
      <circle cx="250" cy="130" r="10" fill="#fff" /><circle cx="298" cy="130" r="10" fill="#fff" />
      <path d="M236 162c24-14 52-14 76 0-10 16-26 22-38 22s-28-6-38-22Z" fill="#f5821f" />
      <path d="M180 446c0-26 18-40 42-40s40 14 40 40Zm106 0c0-26 18-40 42-40s40 14 40 40Z" fill="#f5821f" />
    </svg>
  ),
}
