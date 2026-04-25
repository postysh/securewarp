"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MarketingShell,
  TEXT,
  TEXT_MUTED,
  BORDER,
  GREEN,
  BRAND_SANS,
  BRAND_MONO,
} from "@/components/marketing-shell";

type Category = "feature" | "improvement" | "fix" | "security";

interface Entry {
  id: string;
  title: string;
  body: string;
  category: Category;
  published_at: string;
}

const CATEGORY_LABEL: Record<Category, string> = {
  feature: "New",
  improvement: "Improved",
  fix: "Fixed",
  security: "Security",
};

const CATEGORY_COLOR: Record<Category, string> = {
  feature: GREEN,
  improvement: "#2f7dff",
  fix: "#0a0a0a",
  security: "#c43c3c",
};

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatMonthHeader(iso: string): string {
  return new Date(iso)
    .toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    })
    .toUpperCase();
}

function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()).padStart(2, "0")}`;
}

interface Group {
  key: string;
  label: string;
  entries: Entry[];
}

function groupByMonth(entries: Entry[]): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  for (const entry of entries) {
    const key = monthKey(entry.published_at);
    if (!current || current.key !== key) {
      current = { key, label: formatMonthHeader(entry.published_at), entries: [] };
      groups.push(current);
    }
    current.entries.push(entry);
  }
  return groups;
}

export default function ChangelogPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/changelog")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data: { entries: Entry[] }) => {
        if (!cancelled) setEntries(data.entries);
      })
      .catch(() => {
        if (!cancelled) setError("We couldn't load the changelog right now.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => (entries ? groupByMonth(entries) : null), [entries]);

  return (
    <MarketingShell>
      <HeroBlock />
      <DottedSpacer />
      <ListBlock groups={groups} error={error} />
    </MarketingShell>
  );
}

function DottedSpacer() {
  return (
    <div
      aria-hidden
      style={{
        height: 72,
        borderTop: `1px solid ${BORDER}`,
        borderBottom: `1px solid ${BORDER}`,
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='12' cy='12' r='1' fill='%23000' fill-opacity='0.1'/></svg>\")",
        backgroundSize: "24px 24px",
      }}
    />
  );
}

function HeroBlock() {
  return (
    <section style={{ padding: "96px 32px 64px", textAlign: "center" }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: GREEN,
          fontFamily: BRAND_MONO,
        }}
      >
        Changelog
      </span>
      <h1
        style={{
          marginTop: 12,
          fontSize: "clamp(2.5rem, 5vw, 3.5rem)",
          lineHeight: 1.05,
          color: TEXT,
          fontFamily: BRAND_SANS,
          fontWeight: 400,
          letterSpacing: -1,
          margin: "12px auto 20px",
          maxWidth: 720,
        }}
      >
        What&apos;s <span style={{ color: GREEN }}>new</span>.
      </h1>
      <p
        style={{
          fontSize: 17,
          lineHeight: 1.6,
          maxWidth: 560,
          margin: "0 auto",
          color: TEXT_MUTED,
          fontFamily: BRAND_SANS,
          textWrap: "pretty",
        }}
      >
        Every meaningful update we ship to SecureWarp. Features, improvements,
        fixes, and security work, in chronological order.
      </p>
    </section>
  );
}

function ListBlock({
  groups,
  error,
}: {
  groups: Group[] | null;
  error: string | null;
}) {
  return (
    <section style={{ padding: "0 0 96px" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 32px" }}>
        {error ? (
          <EmptyState message={error} />
        ) : groups === null ? (
          <EmptyState message="Loading…" mono />
        ) : groups.length === 0 ? (
          <EmptyState message="Nothing published yet. Check back soon." />
        ) : (
          <div className="changelog-stack">
            {groups.map((group) => (
              <GroupBlock key={group.key} group={group} />
            ))}
          </div>
        )}
      </div>
      <style jsx>{`
        .changelog-stack {
          display: flex;
          flex-direction: column;
        }
      `}</style>
    </section>
  );
}

function EmptyState({ message, mono }: { message: string; mono?: boolean }) {
  return (
    <p
      style={{
        fontSize: mono ? 12 : 14,
        color: TEXT_MUTED,
        textAlign: "center",
        fontFamily: mono ? BRAND_MONO : BRAND_SANS,
        textTransform: mono ? "uppercase" : "none",
        letterSpacing: mono ? "0.14em" : "normal",
        padding: "80px 0",
      }}
    >
      {message}
    </p>
  );
}

function GroupBlock({ group }: { group: Group }) {
  return (
    <section style={{ paddingTop: 48, paddingBottom: 8 }}>
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          paddingBottom: 24,
          borderBottom: `1px solid ${BORDER}`,
          marginBottom: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: BRAND_MONO,
            color: GREEN,
            letterSpacing: "0.16em",
            fontWeight: 500,
          }}
        >
          {group.label}
        </span>
        <span
          aria-hidden
          style={{
            flex: 1,
            height: 1,
            background: BORDER,
            transform: "translateY(-3px)",
          }}
        />
        <span
          style={{
            fontSize: 11,
            fontFamily: BRAND_MONO,
            color: TEXT_MUTED,
            letterSpacing: "0.14em",
          }}
        >
          {group.entries.length} update{group.entries.length === 1 ? "" : "s"}
        </span>
      </header>

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {group.entries.map((entry, i) => (
          <li
            key={entry.id}
            style={{
              borderBottom:
                i === group.entries.length - 1 ? "none" : `1px solid ${BORDER}`,
            }}
          >
            <EntryRow entry={entry} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function EntryRow({ entry }: { entry: Entry }) {
  const color = CATEGORY_COLOR[entry.category];
  return (
    <article className="changelog-row">
      <aside className="changelog-meta">
        <time
          dateTime={entry.published_at}
          style={{
            fontSize: 11,
            fontFamily: BRAND_MONO,
            color: TEXT_MUTED,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            display: "block",
          }}
        >
          {formatDay(entry.published_at)}
        </time>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color,
            fontFamily: BRAND_MONO,
            padding: "3px 9px",
            border: `1px solid ${color}`,
            borderRadius: 999,
            lineHeight: 1,
            marginTop: 12,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              background: color,
              display: "inline-block",
            }}
          />
          {CATEGORY_LABEL[entry.category]}
        </span>
      </aside>

      <div className="changelog-body">
        <h2
          style={{
            margin: "0 0 10px",
            fontSize: "clamp(1.25rem, 2.2vw, 1.5rem)",
            lineHeight: 1.2,
            color: TEXT,
            fontFamily: BRAND_SANS,
            fontWeight: 500,
            letterSpacing: -0.3,
          }}
        >
          {entry.title}
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 15,
            lineHeight: 1.65,
            color: TEXT_MUTED,
            fontFamily: BRAND_SANS,
            whiteSpace: "pre-wrap",
            textWrap: "pretty",
          }}
        >
          {entry.body}
        </p>
      </div>

      <style jsx>{`
        .changelog-row {
          display: grid;
          grid-template-columns: 140px 1fr;
          gap: 36px;
          padding: 28px 0;
        }
        .changelog-meta {
          padding-top: 4px;
        }
        @media (max-width: 720px) {
          .changelog-row {
            grid-template-columns: 1fr;
            gap: 14px;
            padding: 24px 0;
          }
          .changelog-meta {
            display: flex;
            align-items: center;
            gap: 12px;
            padding-top: 0;
          }
          .changelog-meta > :global(span) {
            margin-top: 0 !important;
          }
        }
      `}</style>
    </article>
  );
}
