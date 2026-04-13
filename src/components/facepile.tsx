"use client";

import { Tooltip } from "./tooltip";

export interface FacepileUser {
  initials: string;
  name: string;
  bg: string;
}

const COLORS = [
  "var(--accent-blue-primary)",
  "var(--accent-green-primary)",
  "var(--accent-orange-primary)",
  "var(--accent-pink-primary)",
  "var(--accent-dark-blue-primary)",
  "var(--accent-yellow-primary)",
  "var(--accent-red-primary)",
];

export function colorForEmail(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = ((hash << 5) - hash + email.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

const MAX_DISPLAYED = 3;
const AVATAR_SIZE = 28;
const OVERLAP = Math.round(AVATAR_SIZE / 3);

export function Facepile({
  members = [],
  onOverflowClick,
  onClick,
}: {
  members?: FacepileUser[];
  onOverflowClick?: () => void;
  onClick?: () => void;
}) {
  if (members.length === 0) return null;

  const visible = members.slice(0, MAX_DISPLAYED);
  const overflow = members.length - MAX_DISPLAYED;

  return (
    <div className="group/facepile flex items-center mr-1" onClick={onClick}>
      {visible.map((user, i) => (
        <Tooltip key={`${user.initials}-${i}`} label={user.name} side="bottom" delay={200}>
          <div
            className="relative flex items-center justify-center text-[10px] font-bold text-white cursor-pointer transition-all duration-200 ease-out hover:z-20 hover:scale-110 hover:-translate-y-0.5 group-hover/facepile:ml-[2px]"
            style={{
              width: AVATAR_SIZE,
              height: AVATAR_SIZE,
              marginLeft: i === 0 ? 0 : -OVERLAP,
              zIndex: visible.length - i,
              borderRadius: 6,
              padding: 2,
              background: "var(--bg-main-container)",
            }}
          >
            <div
              className="w-full h-full rounded-[5px] flex items-center justify-center"
              style={{ backgroundColor: user.bg }}
            >
              {user.initials}
            </div>
          </div>
        </Tooltip>
      ))}
      {overflow > 0 && (
        <Tooltip label={`${overflow} more`} side="bottom" delay={200}>
          <button
            onClick={onOverflowClick}
            className="relative flex items-center justify-center text-[10px] font-medium text-text-tertiary cursor-pointer transition-all duration-200 ease-out hover:z-20 hover:scale-110 hover:-translate-y-0.5 hover:text-text-secondary group-hover/facepile:ml-[2px]"
            style={{
              width: AVATAR_SIZE,
              height: AVATAR_SIZE,
              marginLeft: -OVERLAP,
              zIndex: 0,
              borderRadius: 6,
              padding: 2,
              background: "var(--bg-main-container)",
            }}
          >
            <div className="w-full h-full rounded-[5px] flex items-center justify-center bg-bg-l3">
              +{overflow}
            </div>
          </button>
        </Tooltip>
      )}
    </div>
  );
}
