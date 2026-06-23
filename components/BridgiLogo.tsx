// components/BridgiLogo.tsx
export function BridgiLogo({ size = 32, transparent = false }: { size?: number; transparent?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      {!transparent && <circle cx="20" cy="20" r="20" fill="#F3F4F6" />}
      <circle cx="20" cy="14" r="5" fill="#D26A3E" />
      <path 
        d="M9 34C9 27.268 13.925 22 20 22C26.075 22 31 27.268 31 34" 
        fill="none" 
        stroke="#1D4ED8" 
        strokeWidth="4" 
        strokeLinecap="round" 
      />
      <path d="M20 25.5C15 25.5 12 28 12 35H20V25.5Z" fill="#EAB308" />
      <path d="M20 25.5C25 25.5 28 28 28 35H20V25.5Z" fill="#16A34A" />
    </svg>
  );
}