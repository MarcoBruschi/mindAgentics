import React from 'react';

export interface UsageRingProps {
  primaryFraction: number | null; // 0.0 to 1.0 (Outer ring, short-term) or null
  secondaryFraction?: number | null; // 0.0 to 1.0 (Inner ring, long-term) or null
  colorHex: string; // Base color (e.g. '#10B981', '#3B82F6', '#A855F7')
  size?: number; // Total diameter in px (default: 28)
  strokeWidth?: number; // Stroke thickness in px (default: 2.5)
  showDot?: boolean; // Accent terminal dot at top
  className?: string;
  title?: string;
}

export const UsageRing: React.FC<UsageRingProps> = ({
  primaryFraction,
  secondaryFraction,
  colorHex,
  size = 28,
  strokeWidth = 2.5,
  showDot = true,
  className = '',
  title
}) => {
  const center = size / 2;
  const gap = strokeWidth + 1.2;

  // Outer ring
  const hasPrimary = primaryFraction !== undefined && primaryFraction !== null;
  const outerR = Math.max(1, center - strokeWidth / 2 - 1);
  const outerCircumference = 2 * Math.PI * outerR;
  const clampedPrimary = hasPrimary ? Math.max(0, Math.min(1, primaryFraction)) : 0;
  const outerOffset = outerCircumference * (1 - clampedPrimary);

  // Inner ring
  const hasInner = secondaryFraction !== undefined && secondaryFraction !== null;
  const innerR = Math.max(1, outerR - gap);
  const innerCircumference = 2 * Math.PI * innerR;
  const clampedSecondary = hasInner ? Math.max(0, Math.min(1, secondaryFraction!)) : 0;
  const innerOffset = innerCircumference * (1 - clampedSecondary);

  // Accent dot coordinate on outer ring
  const dotX = center;
  const dotY = center - outerR;

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
      title={title}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-90 origin-center overflow-visible"
      >
        {/* Outer Ring Background */}
        <circle
          cx={center}
          cy={center}
          r={outerR}
          fill="none"
          stroke={colorHex}
          strokeWidth={strokeWidth}
          strokeOpacity={0.16}
        />

        {/* Outer Ring Progress */}
        <circle
          cx={center}
          cy={center}
          r={outerR}
          fill="none"
          stroke={colorHex}
          strokeWidth={strokeWidth}
          strokeDasharray={outerCircumference}
          strokeDashoffset={outerOffset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />

        {/* Inner Ring (if present) */}
        {hasInner && (
          <>
            {/* Inner Ring Background */}
            <circle
              cx={center}
              cy={center}
              r={innerR}
              fill="none"
              stroke={colorHex}
              strokeWidth={strokeWidth * 0.9}
              strokeOpacity={0.12}
            />

            {/* Inner Ring Progress */}
            <circle
              cx={center}
              cy={center}
              r={innerR}
              fill="none"
              stroke={colorHex}
              strokeWidth={strokeWidth * 0.9}
              strokeDasharray={innerCircumference}
              strokeDashoffset={innerOffset}
              strokeLinecap="round"
              strokeOpacity={0.85}
              className="transition-all duration-700 ease-out"
            />
          </>
        )}
      </svg>

      {/* Terminal Dot at the Apex */}
      {showDot && (
        <div
          className="absolute rounded-full pointer-events-none transition-all duration-500"
          style={{
            width: Math.max(3, strokeWidth + 0.5),
            height: Math.max(3, strokeWidth + 0.5),
            left: `${dotX}px`,
            top: `${dotY}px`,
            transform: 'translate(-50%, -50%)',
            backgroundColor: colorHex,
            boxShadow: `0 0 6px ${colorHex}88`
          }}
        />
      )}
    </div>
  );
};
