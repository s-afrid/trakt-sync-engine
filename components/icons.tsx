import React from "react";

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  className?: string;
}

export function TraktLogo({ size = 24, className = "", ...props }: IconProps) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <title>Trakt</title>
      <path d="m15.082 15.107-.73-.73 9.578-9.583a4.499 4.499 0 0 0-.115-.575L13.662 14.382l1.08 1.08-.73.73-1.81-1.81L23.422 3.144c-.075-.15-.155-.3-.25-.44L11.508 14.377l2.154 2.155-.73.73-7.193-7.199.73-.73 4.309 4.31L22.546 1.86A5.618 5.618 0 0 0 18.362 0H5.635A5.637 5.637 0 0 0 0 5.634V18.37A5.632 5.632 0 0 0 5.635 24h12.732C21.477 24 24 21.48 24 18.37V6.19l-8.913 8.918zm-4.314-2.155L6.814 8.988l.73-.73 3.954 3.96zm1.075-1.084-3.954-3.96.73-.73 3.959 3.96zm9.853 5.688a4.141 4.141 0 0 1-4.14 4.14H6.438a4.144 4.144 0 0 1-4.139-4.14V6.438A4.141 4.141 0 0 1 6.44 2.3h10.387v1.04H6.438c-1.71 0-3.099 1.39-3.099 3.1V17.55c0 1.71 1.39 3.105 3.1 3.105h11.117c1.71 0 3.1-1.395 3.1-3.105v-1.754h1.04v1.754z" />
    </svg>
  );
}

export function MalLogo({ size = 24, className = "", ...props }: IconProps) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <title>MyAnimeList</title>
      <path d="M14.921 6.479c-.82 0-3.683 0-4.947 3.156-.662 1.652-.986 4.812.876 7.886l1.934-1.41s-.767-1.095-1.083-3.191h2.897l.022 3.19h2.604V8.835h-2.581v2.043l-2.46-.023s.413-2.408 2.877-2.336h2.454l-.572-2.04ZM0 6.528v9.624h2.348v-5.84l2.031 2.664 2.047-2.652v5.828h2.336V6.528H6.437L4.368 9.474 2.31 6.528Zm18.447.022v9.583h5.022L24 14.09h-3.232V6.55Z" />
    </svg>
  );
}

export function LetterboxdLogo({ size = 24, className = "", ...props }: IconProps) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <title>Letterboxd</title>
      {/* Orange circle */}
      <circle cx="5" cy="12" r="4.5" fill="#FF8000" />
      {/* Green circle */}
      <circle cx="12" cy="12" r="4.5" fill="#00E054" />
      {/* Blue circle */}
      <circle cx="19" cy="12" r="4.5" fill="#40BCF4" />
    </svg>
  );
}

export function LetterboxdMonochromeLogo({ size = 24, className = "", ...props }: IconProps) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <title>Letterboxd</title>
      <path d="M8.224 14.352a4.447 4.447 0 0 1-3.775 2.092C1.992 16.444 0 14.454 0 12s1.992-4.444 4.45-4.444c1.592 0 2.988.836 3.774 2.092-.427.682-.673 1.488-.673 2.352s.246 1.67.673 2.352zM15.101 12c0-.864.247-1.67.674-2.352-.786-1.256-2.183-2.092-3.775-2.092s-2.989.836-3.775 2.092c.427.682.674 1.488.674 2.352s-.247 1.67-.674 2.352c.786 1.256 2.183 2.092 3.775 2.092s2.989-.836 3.775-2.092A4.42 4.42 0 0 1 15.1 12zm4.45-4.444a4.447 4.447 0 0 0-3.775 2.092c.427.682.673 1.488.673 2.352s-.246 1.67-.673 2.352a4.447 4.447 0 0 0 3.775 2.092C22.008 16.444 24 14.454 24 12s-1.992-4.444-4.45-4.444z" />
    </svg>
  );
}

/** Harbor's sail mark — same geometry as the app boot logo in index.html. */
export function HarborMark({ size = 24, className = "", ...props }: IconProps) {
  return (
    <svg
      role="img"
      viewBox="0 0 700 642.88"
      width={size}
      height={size}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <title>Harbor</title>
      <g transform="matrix(0.13333333,0,0,-0.13333333,0,642.88)">
        <path d="m 72.0781,1534.27 c 0,0 1127.5819,922.03 1526.9319,2636.89 0,0 463.95,-1274.4 17.61,-2625.15 L 72.0781,1534.27" />
        <path d="M 3975.59,2945.05 2812.18,2222.26 c -36.68,-22.79 -84.13,3.59 -84.13,46.78 v 1391.45 c 0,42.35 45.8,68.85 82.51,47.75 l 1163.41,-668.68 c 36.11,-20.75 37,-72.53 1.62,-94.51 z M 2021.85,4821.57 V 1438.84 l 2818.94,416.96 c 0,0 252.54,2501.82 -2818.94,2965.77" />
        <path d="m 615.313,4.40234 c 0,0 -364.817,308.39866 -604.4224,706.25766 -28.3125,47.012 1.4922,107.77 55.8555,115.281 L 5090.13,1520.12 c 57.31,7.92 102.66,-47.69 82.95,-102.09 C 5065.81,1122 4746.77,351.742 4222.68,0 L 615.313,4.40234" />
      </g>
    </svg>
  );
}

/** Lockup used in the dashboard header: amber mark + Harbor wordmark. */
export function HarborLogo({
  markSize = 26,
  className = "",
}: {
  markSize?: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <HarborMark
        size={markSize}
        className="text-accent animate-harbor-bob shrink-0"
      />
      <span className="harbor-wordmark text-lg font-semibold tracking-tight text-ink">
        Harbor
      </span>
    </span>
  );
}

/** Compact status chip that mirrors Harbor's sidebar sync indicator. */
export function HarborMarkBadge({
  size = 16,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md bg-accent/15 p-1 text-accent ${className}`}
    >
      <HarborMark size={size} />
    </span>
  );
}

