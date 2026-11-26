// Clean line icons (stroke = currentColor) so they inherit color + size.
type P = { size?: number };
const base = (size = 22) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IconPlus = ({ size }: P) => (
  <svg {...base(size)}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
export const IconSend = ({ size }: P) => (
  <svg {...base(size)} fill="currentColor" stroke="none"><path d="M3 11l18-8-8 18-2-7-8-3z" /></svg>
);
export const IconMic = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" /><line x1="12" y1="18" x2="12" y2="21" />
  </svg>
);
export const IconStop = ({ size }: P) => (
  <svg {...base(size)} fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
);
export const IconImage = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.6" />
    <path d="M21 16l-5-5L5 20" />
  </svg>
);
export const IconDoc = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" />
    <line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="15" y2="17" />
  </svg>
);
export const IconPin = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
);
export const IconLive = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    <path d="M7.5 7.5a6 6 0 0 0 0 9M16.5 7.5a6 6 0 0 1 0 9" />
    <path d="M4.5 4.5a10 10 0 0 0 0 15M19.5 4.5a10 10 0 0 1 0 15" />
  </svg>
);
export const IconSos = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
export const IconHome = ({ size }: P) => (
  <svg {...base(size)}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" /></svg>
);
export const IconExit = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 3v9" /><path d="M6.4 6.4a9 9 0 1 0 11.2 0" /></svg>
);
export const IconStar = ({ size, fill }: P & { fill?: boolean }) => (
  <svg {...base(size)} fill={fill ? "currentColor" : "none"}>
    <path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.98 6.2 21.08l1.1-6.47-4.7-4.58 6.5-.95z" />
  </svg>
);
export const IconPhone = ({ size }: P) => (
  <svg {...base(size)} fill="currentColor" stroke="none">
    <path d="M6.6 10.8a15.5 15.5 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z" />
  </svg>
);
export const IconVideo = ({ size }: P) => (
  <svg {...base(size)}><rect x="2.5" y="6" width="13" height="12" rx="2" /><path d="M15.5 10l6-3.5v11L15.5 14" /></svg>
);
export const IconMicOff = ({ size }: P) => (
  <svg {...base(size)}>
    <line x1="3" y1="3" x2="21" y2="21" />
    <path d="M9 9v2a3 3 0 0 0 4.5 2.6M15 9.3V5a3 3 0 0 0-5.7-1.3" />
    <path d="M5 11a7 7 0 0 0 10.3 6.1M19 11v0" /><line x1="12" y1="18" x2="12" y2="21" />
  </svg>
);
export const IconVideoOff = ({ size }: P) => (
  <svg {...base(size)}><line x1="3" y1="3" x2="21" y2="21" /><path d="M15.5 10l6-3.5v11M10 6h3.5a2 2 0 0 1 2 2v3M2.5 8v8a2 2 0 0 0 2 2H13" /></svg>
);
export const IconEndCall = ({ size }: P) => (
  <svg {...base(size)} fill="currentColor" stroke="none">
    <path d="M21 9.3c-.3-.3-.7-.4-1-.3-1 .3-2 .4-3.1.4V8c0-.5-.3-.9-.8-1a16.9 16.9 0 0 0-8.2 0c-.5.1-.8.5-.8 1v1.4c-1.1 0-2.1-.1-3.1-.4-.3-.1-.7 0-1 .3l-1.9 2a1 1 0 0 0 0 1.4 17 17 0 0 0 1.5 1.4 1 1 0 0 0 1.3 0l1.9-1.6c.3-.2.4-.5.4-.9v-1.5c2-.5 4.2-.5 6.2 0v1.5c0 .4.1.7.4.9l1.9 1.6a1 1 0 0 0 1.3 0 17 17 0 0 0 1.5-1.4 1 1 0 0 0 0-1.4z" />
  </svg>
);
export const IconRecord = ({ size, fill }: P & { fill?: boolean }) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="6" fill={fill ? "#ef4444" : "currentColor"} stroke="none" /></svg>
);
export const IconSpeaker = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M4 9v6h3l5 4V5L7 9H4z" fill="currentColor" stroke="none" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8 8 0 0 1 0 12" />
  </svg>
);
export const IconMore = ({ size }: P) => (
  <svg {...base(size)} fill="currentColor" stroke="none">
    <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
  </svg>
);
export const IconInfo = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><circle cx="12" cy="7.8" r="0.6" fill="currentColor" /></svg>
);
export const IconFlip = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="3" y="7" width="18" height="12" rx="2" />
    <path d="M9 11l-2 2 2 2M15 11l2 2-2 2M7 13h10" />
  </svg>
);
