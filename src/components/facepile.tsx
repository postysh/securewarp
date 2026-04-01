"use client";

import { Tooltip } from "./tooltip";

interface FacepileUser {
  initials: string;
  name: string;
  bg: string;
  online?: boolean;
}

const members: FacepileUser[] = [
  { initials: "JD", name: "John Doe", bg: "var(--accent-blue-primary)", online: true },
  { initials: "AM", name: "Alice Martin", bg: "var(--accent-green-primary)", online: true },
  { initials: "SK", name: "Sam Kim", bg: "var(--accent-orange-primary)", online: false },
  { initials: "LW", name: "Lisa Wang", bg: "var(--accent-pink-primary)", online: false },
  { initials: "RJ", name: "Ryan Johnson", bg: "var(--accent-dark-blue-primary)", online: true },
];

const MAX_DISPLAYED = 3;
const AVATAR_SIZE = 28;
const OVERLAP = Math.round(AVATAR_SIZE / 3);

export function Facepile({ onOverflowClick, onClick }: { onOverflowClick?: () => void; onClick?: () => void }) {
  // Sort: online users first
  const sorted = [...members].sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));
  const visible = sorted.slice(0, MAX_DISPLAYED);
  const overflow = members.length - MAX_DISPLAYED;

  return (
    <div className="group/facepile flex items-center mr-1" onClick={onClick}>
      {visible.map((user, i) => (
        <Tooltip key={user.initials} label={user.name} side="bottom" delay={200}>
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
            {/* Online indicator */}
            {user.online && (
              <div
                className="absolute -bottom-0.5 -right-0.5 w-[10px] h-[10px] rounded-full border-2"
                style={{ backgroundColor: "var(--accent-green-primary)", borderColor: "var(--bg-main-container)" }}
              />
            )}
          </div>
        </Tooltip>
      ))}
      {overflow > 0 && (
        <Tooltip label={`${overflow} more members`} side="bottom" delay={200}>
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
