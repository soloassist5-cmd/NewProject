/** Иконки набором инлайновых SVG — чтобы не тянуть библиотеку ради полутора десятков значков. */

interface IconProps {
  size?: number;
  className?: string;
}

function svgProps({ size = 18, className }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };
}

export const SearchIcon = (props: IconProps) => (
  <svg {...svgProps({ size: 16, ...props })}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const SendIcon = (props: IconProps) => (
  <svg {...svgProps(props)}>
    <path d="M4.5 12h13" />
    <path d="M4 5.5 20 12 4 18.5l2.5-6.5L4 5.5Z" />
  </svg>
);

export const PaperclipIcon = (props: IconProps) => (
  <svg {...svgProps(props)}>
    <path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10 17.5a2 2 0 0 1-3-3l7.5-7.5" />
  </svg>
);

export const ReplyIcon = (props: IconProps) => (
  <svg {...svgProps({ size: 16, ...props })}>
    <path d="M9 7 4 12l5 5" />
    <path d="M4 12h9a7 7 0 0 1 7 7v1" />
  </svg>
);

export const EditIcon = (props: IconProps) => (
  <svg {...svgProps({ size: 16, ...props })}>
    <path d="M4 20h4L19 9a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z" />
  </svg>
);

export const TrashIcon = (props: IconProps) => (
  <svg {...svgProps({ size: 16, ...props })}>
    <path d="M4 7h16M9.5 7V5h5v2M6 7l1 13h10l1-13" />
  </svg>
);

export const SmileIcon = (props: IconProps) => (
  <svg {...svgProps({ size: 16, ...props })}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 14a4.5 4.5 0 0 0 7 0" />
    <path d="M9.5 9.5h.01M14.5 9.5h.01" strokeWidth="2.4" />
  </svg>
);

export const BackIcon = (props: IconProps) => (
  <svg {...svgProps({ size: 20, ...props })}>
    <path d="M15 5 8 12l7 7" />
  </svg>
);

export const CloseIcon = (props: IconProps) => (
  <svg {...svgProps({ size: 18, ...props })}>
    <path d="M6 6 18 18M18 6 6 18" />
  </svg>
);

export const PlusIcon = (props: IconProps) => (
  <svg {...svgProps(props)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const UsersIcon = (props: IconProps) => (
  <svg {...svgProps(props)}>
    <circle cx="9.5" cy="8.5" r="3.5" />
    <path d="M3.5 20a6 6 0 0 1 12 0" />
    <path d="M16 5.5a3.5 3.5 0 0 1 0 6.9M17.5 14.5a6 6 0 0 1 3 5.5" />
  </svg>
);

export const SettingsIcon = (props: IconProps) => (
  <svg {...svgProps(props)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1v-.3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4.9Z" />
  </svg>
);

export const MoonIcon = (props: IconProps) => (
  <svg {...svgProps(props)}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </svg>
);

export const SunIcon = (props: IconProps) => (
  <svg {...svgProps(props)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </svg>
);

export const BellOffIcon = (props: IconProps) => (
  <svg {...svgProps({ size: 14, ...props })}>
    <path d="M18 8a6 6 0 0 0-9.3-5" />
    <path d="M6 9v4l-2 4h13" />
    <path d="M10.5 20a2 2 0 0 0 3 0" />
    <path d="m3 3 18 18" />
  </svg>
);

export const CheckIcon = (props: IconProps) => (
  <svg {...svgProps({ size: 14, ...props })}>
    <path d="m4 12.5 5 5L20 6.5" />
  </svg>
);

export const CheckDoubleIcon = (props: IconProps) => (
  <svg {...svgProps({ size: 15, ...props })} viewBox="0 0 24 24">
    <path d="m1.5 12.5 4.5 4.5L15 8" />
    <path d="m9 12.5 4 4L22 7.5" />
  </svg>
);

export const FileIcon = (props: IconProps) => (
  <svg {...svgProps({ size: 20, ...props })}>
    <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5L13.5 3Z" />
    <path d="M13.5 3v5.5H19" />
  </svg>
);

export const LogoutIcon = (props: IconProps) => (
  <svg {...svgProps({ size: 16, ...props })}>
    <path d="M14 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8" />
    <path d="M17 8.5 20.5 12 17 15.5M20 12H9.5" />
  </svg>
);

/** Щит — вход в админ-панель. */
export const ShieldIcon = (props: IconProps) => (
  <svg {...svgProps(props)}>
    <path d="M12 3.5 5 6v5.5c0 4 2.9 7.4 7 8.9 4.1-1.5 7-4.9 7-8.9V6z" />
  </svg>
);

/** Замок — заблокированный аккаунт. */
export const LockIcon = (props: IconProps) => (
  <svg {...svgProps({ size: 14, ...props })}>
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
    <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
  </svg>
);

/** Ключ — смена пароля. */
export const KeyIcon = (props: IconProps) => (
  <svg {...svgProps({ size: 16, ...props })}>
    <circle cx="8" cy="8" r="4.5" />
    <path d="m11.2 11.2 8 8M17 17l2-2M14.5 14.5l2-2" />
  </svg>
);
