"use client";

import { useState, useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import AnalyticsUpIcon from "@hugeicons/core-free-icons/AnalyticsUpIcon";
import Share01Icon from "@hugeicons/core-free-icons/Share01Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Edit02Icon from "@hugeicons/core-free-icons/Edit02Icon";
import Move01Icon from "@hugeicons/core-free-icons/Move01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import Link04Icon from "@hugeicons/core-free-icons/Link04Icon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import UserRemove01Icon from "@hugeicons/core-free-icons/UserRemove01Icon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import { colorForEmail } from "./facepile";
import { Tooltip } from "./tooltip";

interface ActivityPageProps {
  workspaceId: string;
}

interface ActivityEvent {
  id: string;
  type: string;
  actorEmail: string | null;
  targetEmail: string | null;
  targetFileId: string | null;
  targetIsFolder: boolean | null;
  encryptedMetadata: string | null;
  encryptedSessionKeyByFile: string | null;
  sessionKeyNonce: string | null;
  publicHierarchicalKey: string | null;
  ownerPublicKey: string | null;
  detail: string | null;
  createdAt: string;
}

const EVENT_CONFIG: Record<string, { label: string; icon: typeof Share01Icon; color: string }> = {
  "files.share": { label: "shared", icon: Share01Icon, color: "var(--accent-blue-primary)" },
  "files.unshare": { label: "revoked access for", icon: UserRemove01Icon, color: "var(--accent-red)" },
  "files.leave": { label: "left", icon: UserRemove01Icon, color: "var(--accent-orange-primary)" },
  "files.permission_change": { label: "changed permissions on", icon: LockIcon, color: "var(--accent-yellow-primary)" },
  "files.delete": { label: "trashed", icon: Delete02Icon, color: "var(--accent-red)" },
  "files.rename": { label: "renamed", icon: Edit02Icon, color: "var(--accent-green-primary)" },
  "files.move": { label: "moved", icon: Move01Icon, color: "var(--accent-blue-primary)" },
  "files.restore": { label: "restored", icon: ArrowLeft01Icon, color: "var(--accent-green-primary)" },
  "files.purge": { label: "permanently deleted", icon: Delete02Icon, color: "var(--accent-red)" },
  "files.rotate": { label: "rotated keys on", icon: LockIcon, color: "var(--accent-yellow-primary)" },
  "link.create": { label: "created a link for", icon: Link04Icon, color: "var(--accent-blue-primary)" },
  "link.revoke": { label: "revoked a link for", icon: Link04Icon, color: "var(--accent-red)" },
  "workspace.invite": { label: "invited", icon: UserAdd01Icon, color: "var(--accent-green-primary)" },
  "workspace.remove": { label: "removed", icon: UserRemove01Icon, color: "var(--accent-red)" },
  "workspace.role_change": { label: "changed role for", icon: LockIcon, color: "var(--accent-yellow-primary)" },
  "workspace.leave": { label: "left the workspace", icon: UserRemove01Icon, color: "var(--accent-orange-primary)" },
};

function buildDescription(e: ActivityEvent, fileName: string | null): string {
  const actor = e.actorEmail?.split("@")[0] ?? "System";
  const targetUser = e.targetEmail?.split("@")[0];
  const name = fileName ? `"${fileName}"` : (e.targetIsFolder === true ? "a folder" : e.targetIsFolder === false ? "a file" : "");

  if (e.type === "workspace.invite" && targetUser) {
    const role = e.detail?.split(":")[0];
    return `${actor} invited ${targetUser}${role ? ` as ${role}` : ""}`;
  }
  if (e.type === "workspace.remove" && targetUser) return `${actor} removed ${targetUser}`;
  if (e.type === "workspace.role_change" && targetUser) {
    const role = e.detail?.split(":")[0];
    return `${actor} changed ${targetUser}'s role to ${role ?? "member"}`;
  }
  if (e.type === "workspace.leave") return `${actor} left the workspace`;
  if (e.type === "files.share" && targetUser) return `${actor} shared ${name} with ${targetUser}`;
  if (e.type === "files.unshare" && targetUser) return `${actor} revoked ${targetUser}'s access`;
  if (e.type === "files.permission_change" && e.detail?.startsWith("workspace.transfer") && targetUser) return `${actor} transferred ownership to ${targetUser}`;
  if (e.type === "link.create" && e.detail === "password") return `${actor} created a password-protected link`;

  const config = EVENT_CONFIG[e.type];
  const verb = config?.label || e.type;
  return `${actor} ${verb} ${name}`.trim();
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

async function decryptFileNames(
  events: ActivityEvent[]
): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  try {
    const keysStr = sessionStorage.getItem("securewarp_keys");
    if (!keysStr) return nameMap;
    const keys = JSON.parse(keysStr) as { encryptionPrivateKey: string };

    const { unwrapPrivateHierarchicalKey, unwrapSessionKeyFromFile, decryptMetadata } = await import("@/lib/crypto/file-crypto");

    // Dedupe by file ID
    const seen = new Set<string>();
    for (const e of events) {
      if (!e.targetFileId || !e.encryptedMetadata || !e.encryptedSessionKeyByFile || !e.sessionKeyNonce || !e.publicHierarchicalKey || !e.ownerPublicKey) continue;
      if (seen.has(e.targetFileId)) continue;
      seen.add(e.targetFileId);

      try {
        // The admin has a file_keys row on the workspace root, and the
        // activity endpoint returns the file's own session key wrapping.
        // We need the file's private hier key to unwrap the session key.
        // Since we only have the file's public hier key from the server,
        // we can't unwrap it directly. But the admin's file_keys row on
        // the root folder gives them transitive access via parent_keys_claim.
        // For now, try to unwrap using the root folder's private hier key
        // that should be cached. If it fails, skip gracefully.

        // Try direct download endpoint which handles inheritance
        const dlRes = await fetch(`/api/files/chunk-download?fileId=${e.targetFileId}`);
        if (!dlRes.ok) continue;
        const dlData = await dlRes.json();

        const privHier = unwrapPrivateHierarchicalKey(
          dlData.encryptedPrivateHierarchicalKey,
          dlData.wrappedByPublicKey,
          keys.encryptionPrivateKey
        );
        const sessionKey = unwrapSessionKeyFromFile(
          e.encryptedSessionKeyByFile,
          e.sessionKeyNonce,
          e.ownerPublicKey,
          privHier
        );
        const meta = decryptMetadata(JSON.parse(e.encryptedMetadata), sessionKey);
        sessionKey.fill(0);
        if (meta.name) nameMap.set(e.targetFileId, meta.name);
      } catch {
        // Decryption failed for this file — skip
      }
    }
  } catch {
    // No keys or crypto error — return empty
  }
  return nameMap;
}

export function WorkspaceActivityPage({ workspaceId }: ActivityPageProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fileNames, setFileNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    setLoading(true);
    setFileNames(new Map());
    fetch(`/api/workspaces/activity?workspaceId=${workspaceId}`)
      .then((r) => r.json())
      .then(async (d) => {
        if (d.events) {
          setEvents(d.events);
          // Decrypt file names in background
          const names = await decryptFileNames(d.events);
          setFileNames(names);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const isWorkspaceEvent = (type: string) => type.startsWith("workspace.");

  return (
    <div className="flex-1 flex flex-col overflow-y-auto px-3 md:px-5 pt-1 pb-4">
      {loading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center h-[56px] px-4 rounded-xl border border-border-tertiary">
              <div className="skeleton w-8 h-8 rounded-lg mr-3" style={{ animationDelay: `${i * 0.15}s` }} />
              <div className="flex-1">
                <div className="skeleton h-3 rounded-md" style={{ width: `${140 + i * 20}px`, animationDelay: `${i * 0.15 + 0.05}s` }} />
              </div>
              <div className="skeleton h-3 w-14 rounded-md ml-4" style={{ animationDelay: `${i * 0.15 + 0.1}s` }} />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-16">
          <div className="text-center">
            <div className="w-12 h-12 rounded-[12px] bg-bg-overlay-tertiary flex items-center justify-center mx-auto mb-3">
              <HugeiconsIcon icon={AnalyticsUpIcon} size={24} color="var(--icon-tertiary)" />
            </div>
            <p className="text-[14px] text-text-secondary font-medium mb-1">No activity yet</p>
            <p className="text-[12px] text-text-disabled">Events will appear here as members interact with the workspace</p>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {events.map((e) => {
            const config = EVENT_CONFIG[e.type] || { icon: AnalyticsUpIcon, color: "var(--icon-tertiary)" };
            const fileName = e.targetFileId ? fileNames.get(e.targetFileId) ?? null : null;
            const description = buildDescription(e, fileName);
            const wsEvent = isWorkspaceEvent(e.type);

            return (
              <div
                key={e.id}
                className="flex items-center h-[56px] px-4 rounded-xl border border-border-tertiary hover:border-border-secondary hover:bg-bg-overlay-tertiary transition-colors"
              >
                {/* Left icon — file/folder for file events, event icon for workspace events */}
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mr-3">
                  {wsEvent ? (
                    <HugeiconsIcon icon={config.icon} size={20} color={config.color} />
                  ) : (
                    <HugeiconsIcon
                      icon={e.targetIsFolder ? Folder01Icon : File01Icon}
                      size={20}
                      color={e.targetIsFolder ? "var(--accent-blue-primary)" : "var(--icon-tertiary)"}
                    />
                  )}
                </div>

                {/* Description */}
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] text-text-primary truncate block">{description}</span>
                </div>

                {/* Event type badge */}
                <div className="hidden md:flex w-[100px] justify-end">
                  <div className="flex items-center gap-1.5 h-5 px-1.5 rounded bg-bg-field">
                    <HugeiconsIcon icon={config.icon} size={11} color={config.color} />
                    <span className="text-[11px] font-mono uppercase text-text-disabled">
                      {e.type.split(".").pop()}
                    </span>
                  </div>
                </div>

                {/* Actor avatar */}
                <div className="hidden md:flex w-[100px] justify-end">
                  {e.actorEmail ? (
                    <Tooltip label={e.actorEmail}>
                      <div
                        className="w-6 h-6 rounded-[5px] flex items-center justify-center text-[9px] font-bold text-white"
                        style={{ backgroundColor: colorForEmail(e.actorEmail) }}
                      >
                        {e.actorEmail.charAt(0).toUpperCase()}
                      </div>
                    </Tooltip>
                  ) : (
                    <div className="w-6 h-6 rounded-[5px] bg-bg-overlay-tertiary" />
                  )}
                </div>

                {/* Time */}
                <div className="w-[80px] flex justify-end shrink-0">
                  <span className="text-[12px] text-text-disabled">{timeAgo(e.createdAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
