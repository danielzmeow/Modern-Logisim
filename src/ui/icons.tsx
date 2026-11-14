import type { CompKind } from '../model/types';

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <div
      className="relative grid place-items-center rounded-[9px] bg-gradient-to-br from-[#7d8cff] to-[#4f63e8] shadow-[0_2px_6px_rgba(15,23,42,0.24)]"
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none">
        <path
          d="M4 6.5h8.2a5.5 5.5 0 0 1 0 11H4V6.5Z"
          stroke="white"
          strokeWidth="2.1"
          strokeLinejoin="round"
        />
        <path d="M4 12h6" stroke="white" strokeWidth="2.1" strokeLinecap="round" opacity="0.75" />
        <circle cx="20.5" cy="12" r="1.7" fill="white" />
        <path d="M16.9 12h2" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/** Small schematic icons for the component library. */
export function CompIcon({ kind, size = 24 }: { kind: CompKind; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (kind) {
    case 'input':
      return (
        <svg {...common}>
          <rect x="2.5" y="7.5" width="12" height="9" rx="2" />
          <path d="M14.5 12H22" />
          <path d="M18.5 10.2H19.4M19.4 10.2V13.8" strokeWidth="1.3" />
        </svg>
      );
    case 'output':
      return (
        <svg {...common}>
          <rect x="8.5" y="7.5" width="13" height="9" rx="2" />
          <path d="M2 12h6.5" />
          <circle cx="11.6" cy="12" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'button':
      return (
        <svg {...common}>
          <rect x="2.5" y="7.5" width="14" height="9" rx="2" />
          <circle cx="8" cy="12" r="2.1" />
          <path d="M16.5 12H22" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...common}>
          <rect x="2.5" y="7.5" width="14" height="9" rx="2" />
          <path d="M5.5 14v-4h3v4h3v-4h2.5" strokeWidth="1.4" />
          <path d="M16.5 12H22" />
        </svg>
      );
    case 'led':
      return (
        <svg {...common}>
          <path d="M2 12h7" />
          <circle cx="14" cy="12" r="4.6" />
          <path d="M14 4.5v1.2M20.2 6.4l-.9.9M22 12h-1.2M8.7 6.4l.9.9" strokeWidth="1.3" />
        </svg>
      );
    case 'constant':
      return (
        <svg {...common}>
          <rect x="2.5" y="7.5" width="14" height="9" rx="2" />
          <path d="M16.5 12H22" />
          <path d="M6 14.3 8.1 9.7M7.7 11.1H8.5" strokeWidth="1.3" />
        </svg>
      );
    case 'not':
      return (
        <svg {...common}>
          <path d="M2 12h5" />
          <path d="M7 7.5 14.5 12 7 16.5V7.5Z" />
          <circle cx="16.4" cy="12" r="1.7" />
          <path d="M18.1 12H22" />
        </svg>
      );
    case 'and':
    case 'nand':
      return (
        <svg {...common}>
          <path d="M2 12h5M20 12h2" />
          <path d="M7 6.5h3.5a5.5 5.5 0 0 1 0 11H7v-11Z" />
          {kind === 'nand' && <circle cx="18.2" cy="12" r="1.7" />}
          {kind === 'nand' && <path d="M19.9 12H22" />}
        </svg>
      );
    case 'or':
    case 'nor':
      return (
        <svg {...common}>
          <path d="M2 12h5M20 12h2" />
          <path d="M7 6.5c2.2 1.2 4.3 3 6 5.5-1.7 2.5-3.8 4.3-6 5.5 5.8-.2 9.8-2.3 12-5.5-2.2-3.2-6.2-5.3-12-5.5Z" />
          <path d="M7.6 6.8c1.6 1.6 2.4 3.4 2.4 5.2 0 1.8-.8 3.6-2.4 5.2" opacity="0.55" />
          {kind === 'nor' && <circle cx="19" cy="12" r="1.7" />}
          {kind === 'nor' && <path d="M20.7 12H22" />}
        </svg>
      );
    case 'xor':
    case 'xnor':
      return (
        <svg {...common}>
          <path d="M2 12h5M20 12h2" />
          <path d="M6 6.5c2 1.3 3.6 3.2 4.8 5.5-1.2 2.3-2.8 4.2-4.8 5.5" strokeWidth="1.2" />
          <path d="M8.8 6.5c2.1 1.2 4.1 3 5.8 5.5-1.7 2.5-3.7 4.3-5.8 5.5 5.6-.2 9.5-2.3 11.7-5.5-2.2-3.2-6.1-5.3-11.7-5.5Z" />
          {kind === 'xnor' && <circle cx="19" cy="12" r="1.7" />}
        </svg>
      );
    case 'split':
      return (
        <svg {...common}>
          <path d="M2 12h4" />
          <path d="M6 6.5h4l4 2.3v1.4L10 12l4 1.8v1.4L10 17.5H6V6.5Z" />
          <path d="M14 9.3h6M14 12h6M14 14.7h6" />
        </svg>
      );
    case 'merge':
      return (
        <svg {...common}>
          <path d="M2 9.3h5M2 12h5M2 14.7h5" />
          <path d="M7 6.5h4l5 2.3v1.4L11 12l5 1.8v1.4L11 17.5H7V6.5Z" transform="translate(4 0)" />
        </svg>
      );
    case 'tunnel':
      return (
        <svg {...common}>
          <path d="M2 12h4" />
          <path d="M6 12l3-4h10v8H9l-3-4Z" />
          <path d="M11.5 10.5v3M14.5 10.5v3" strokeWidth="1.2" />
        </svg>
      );
    case 'dff':
      return (
        <svg {...common}>
          <rect x="5" y="4.5" width="12" height="15" rx="2" />
          <path d="M2 8h3M2 16h3M17 8h4M17 16h4" />
          <path d="M5 13.5 7.5 15 5 16.5V13.5Z" strokeWidth="1.2" />
        </svg>
      );
    case 'mux':
      return (
        <svg {...common}>
          <path d="M2 6.5h4M2 11h4M2 15.5h4" />
          <path d="M6 4.5h3.5L16 7v10l-6.5 2.5H6V4.5Z" />
          <path d="M16 12h5" />
          <path d="M10 19.5v2" opacity="0.7" />
        </svg>
      );
    case 'buffer':
      return (
        <svg {...common}>
          <path d="M2 12h5M20 12h2" />
          <path d="M7 6.5 18 12 7 17.5V6.5Z" />
        </svg>
      );
    case 'odd':
    case 'even':
      return (
        <svg {...common}>
          <path d="M2 7h4M2 17h4M2 12h4" />
          <path d="M6 4.5h3.5L18 12l-8.5 7.5H6V4.5Z" />
          <path d="M6 4.5c2 2 3 4.5 3 7.5s-1 5.5-3 7.5" strokeWidth="1.2" />
          <path d="M20 12h2" />
        </svg>
      );
    case 'ctrlBuffer':
    case 'ctrlInverter':
      return (
        <svg {...common}>
          <path d="M2 11h4M2 17h4M14 11h8" />
          <path d="M6 6.5 14 11l-8 4.5V6.5Z" />
          {kind === 'ctrlInverter' && <circle cx="15.5" cy="11" r="1.6" />}
        </svg>
      );
    case 'probe':
      return (
        <svg {...common}>
          <path d="M2 12h4" />
          <rect x="6" y="7.5" width="14" height="9" rx="2" />
          <path d="M10 12h6" strokeWidth="1.2" />
          <circle cx="13" cy="12" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'power':
      return (
        <svg {...common}>
          <path d="M12 21V10M6 10h12" strokeWidth="1.8" />
          <path d="M9 4.5 12 7l3-2.5" opacity="0.6" />
        </svg>
      );
    case 'ground':
      return (
        <svg {...common}>
          <path d="M12 3v8M5 11h14M7.5 15h9M10 19h4" strokeWidth="1.6" />
        </svg>
      );
    case 'pull':
      return (
        <svg {...common}>
          <path d="M2 12h5M13 12h9" />
          <rect x="7" y="6.5" width="6" height="11" rx="1.5" />
          <path d="M10 15V9M8.4 10.6 10 9l1.6 1.6" strokeWidth="1.3" />
        </svg>
      );
    case 'extend':
      return (
        <svg {...common}>
          <path d="M2 8h5M2 16h5M13 8h9M13 16h9M7 8h6v8H7z" />
          <path d="M11 12h2" strokeWidth="1.2" />
        </svg>
      );
    case 'register':
      return (
        <svg {...common}>
          <rect x="4.5" y="4.5" width="15" height="15" rx="2" />
          <path d="M1.5 8h3M1.5 16h3M19.5 8h3M19.5 13h3" />
          <path d="M4.5 15.5 7 17.5 4.5 19.5V15.5Z" strokeWidth="1.1" />
        </svg>
      );
    case 'counter':
      return (
        <svg {...common}>
          <rect x="4.5" y="5.5" width="15" height="13" rx="2" />
          <path d="M1.5 9h3M1.5 15h3M19.5 9h3" />
          <path d="M8 12h5M8 9h4M8 15h6" strokeWidth="1.2" />
        </svg>
      );
    case 'ram':
    case 'rom':
      return (
        <svg {...common}>
          <rect x="4" y="4.5" width="16" height="15" rx="2" />
          <path d="M1 8h3M1 16h3M20 8h3M20 16h3" />
          <path d="M8 8.5h8M8 12h8M8 15.5h5" strokeWidth="1.1" />
        </svg>
      );
    case 'decoder':
    case 'demux':
      return (
        <svg {...common}>
          <path d="M2 8h4M2 16h4M2 12h4" />
          <path d="M6 5.5h3.5L17 8v8l-7.5 2.5H6V5.5Z" />
          <path d="M17 7h5M17 10h5M17 14h5M17 17h5" />
        </svg>
      );
    case 'priority':
      return (
        <svg {...common}>
          <path d="M2 7h4M2 11h4M2 15h4M2 18h4" />
          <path d="M6 4.5h4L18 12l-8 7.5H6V4.5Z" />
          <path d="M18 12h4" />
        </svg>
      );
    case 'bitSelect':
      return (
        <svg {...common}>
          <path d="M2 9h4M2 15h4M19 12h3" />
          <path d="M6 6.5h4L17 9v6l-7 2.5H6V6.5Z" />
          <path d="M10 19.5v1.5" />
        </svg>
      );
    case 'adder':
    case 'subtractor':
    case 'multiplier':
    case 'comparator':
    case 'shifter':
      return (
        <svg {...common}>
          <rect x="4" y="4.5" width="16" height="15" rx="2" />
          <path d="M1 8h3M1 16h3M20 9h3M20 15h3" />
          <path d="M8 12h8M12 8v8" strokeWidth="1.2" />
        </svg>
      );
    case 'sevenseg':
      return (
        <svg {...common}>
          <rect x="4" y="2.5" width="16" height="19" rx="2" />
          <path d="M8 7h8M8 12h8M8 17h8M8.5 7v5M15.5 7v5M8.5 12v5M15.5 12v5" strokeWidth="1.2" />
        </svg>
      );
    case 'sub':
      return (
        <svg {...common}>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
          <path d="M1 8h2.5M1 16h2.5M20.5 8H23M20.5 16H23" />
          <path d="M8 9h8M8 12h5M8 15h7" strokeWidth="1.1" />
        </svg>
      );
    case 'text':
      return (
        <svg {...common}>
          <path d="M5 6h14M12 6v13M8.5 19h7" strokeWidth="1.6" />
        </svg>
      );
    default:
      return null;
  }
}
