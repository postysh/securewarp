"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import Image01Icon from "@hugeicons/core-free-icons/Image01Icon";
import CodeIcon from "@hugeicons/core-free-icons/CodeIcon";
import Table01Icon from "@hugeicons/core-free-icons/Table01Icon";
import MusicNote01Icon from "@hugeicons/core-free-icons/MusicNote01Icon";
import Video01Icon from "@hugeicons/core-free-icons/Video01Icon";
import Archive01Icon from "@hugeicons/core-free-icons/Archive01Icon";
import Pdf01Icon from "@hugeicons/core-free-icons/Pdf01Icon";
import Presentation01Icon from "@hugeicons/core-free-icons/Presentation01Icon";
import FileEditIcon from "@hugeicons/core-free-icons/FileEditIcon";

export type FileKind =
  | "folder" | "document" | "image" | "code" | "spreadsheet"
  | "audio" | "video" | "archive" | "pdf" | "presentation"
  | "page" | "other";

const iconMap: Record<FileKind, { icon: typeof Folder01Icon; color: string }> = {
  folder:       { icon: Folder01Icon,       color: "var(--accent-blue-primary)" },
  document:     { icon: File01Icon,         color: "var(--accent-dark-blue-primary)" },
  image:        { icon: Image01Icon,        color: "var(--accent-pink-primary)" },
  code:         { icon: CodeIcon,           color: "var(--accent-orange-primary)" },
  spreadsheet:  { icon: Table01Icon,        color: "var(--accent-yellow-primary)" },
  audio:        { icon: MusicNote01Icon,     color: "var(--accent-pink-primary)" },
  video:        { icon: Video01Icon,        color: "var(--accent-red-primary)" },
  archive:      { icon: Archive01Icon,      color: "var(--accent-yellow-primary)" },
  pdf:          { icon: Pdf01Icon,          color: "var(--accent-red-primary)" },
  presentation: { icon: Presentation01Icon, color: "var(--accent-orange-primary)" },
  page:         { icon: FileEditIcon,       color: "var(--accent-dark-blue-primary)" },
  other:        { icon: File01Icon,         color: "var(--icon-tertiary)" },
};

export function FileIcon({ type, size = 18 }: { type: FileKind; size?: number }) {
  const cfg = iconMap[type] || iconMap.other;

  return (
    <div className={`flex h-8 w-8 items-center justify-center ${type === "folder" ? "rounded-lg" : "rounded-md"} bg-bg-side`}>
      <HugeiconsIcon icon={cfg.icon} size={size} color={cfg.color} />
    </div>
  );
}
