import Link from "next/link";
import { notFound } from "next/navigation";

import {
  MarketingShell,
  TEXT,
  TEXT_MUTED,
  BORDER,
  GREEN,
  BRAND_SANS,
  BRAND_MONO,
} from "@/components/marketing-shell";
import { Templates, type TemplateName } from "@/lib/email/templates";
import { EMAIL_PREVIEW_FIXTURES } from "@/lib/email/preview-fixtures";
import { SendTestButton } from "./send-test-button";

/**
 * Renders a single transactional email template with fixture data.
 * HTML goes into an iframe with `srcDoc` so the template's own
 * doctype / inline styles don't inherit anything from the app
 * chrome. Plain-text rendering is shown below in a pre block so
 * the raw copy can be eyeballed alongside.
 */

function isKnownTemplate(name: string): name is TemplateName {
  return name in Templates;
}

export default async function EmailPreview({
  params,
}: {
  params: Promise<{ template: string }>;
}) {
  const { template } = await params;
  if (!isKnownTemplate(template)) notFound();

  const renderFn = Templates[template] as (d: unknown) => {
    subject: string;
    html: string;
    text: string;
  };
  const { subject, html, text } = renderFn(EMAIL_PREVIEW_FIXTURES[template]);

  return (
    <MarketingShell>
      <section style={{ padding: "48px 32px 24px" }}>
        <Link
          href="/dev/emails"
          style={{
            fontSize: 11,
            fontFamily: BRAND_MONO,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: TEXT_MUTED,
            textDecoration: "none",
            marginBottom: 16,
            display: "inline-block",
          }}
        >
          ← All templates
        </Link>
        <p
          style={{
            fontSize: 11,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: GREEN,
            fontFamily: BRAND_MONO,
            margin: "8px 0 10px",
          }}
        >
          {template}
        </p>
        <h1
          style={{
            fontSize: "clamp(1.6rem, 3vw, 2.2rem)",
            lineHeight: 1.1,
            color: TEXT,
            fontFamily: BRAND_SANS,
            fontWeight: 400,
            letterSpacing: -0.5,
            margin: "0 0 18px",
          }}
        >
          {subject}
        </h1>
        <p
          style={{
            fontSize: 13,
            color: TEXT_MUTED,
            margin: 0,
            fontFamily: BRAND_SANS,
          }}
        >
          Subject shown above. HTML and plain-text renderings below use fixture
          data — see <code style={{ fontFamily: BRAND_MONO }}>src/app/dev/emails/[template]/page.tsx</code>.
        </p>
      </section>

      <section style={{ padding: "0 32px 20px" }}>
        <SendTestButton template={template} />
      </section>

      <section style={{ padding: "0 32px 16px" }}>
        <p
          style={{
            fontSize: 11,
            fontFamily: BRAND_MONO,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: TEXT_MUTED,
            margin: "0 0 10px",
          }}
        >
          HTML
        </p>
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            overflow: "hidden",
            background: "#0a0a0a",
          }}
        >
          <iframe
            title={`${template} email preview`}
            srcDoc={html}
            style={{
              width: "100%",
              height: 720,
              border: "none",
              display: "block",
              background: "#faf8f4",
            }}
          />
        </div>
      </section>

      <section style={{ padding: "16px 32px 64px" }}>
        <p
          style={{
            fontSize: 11,
            fontFamily: BRAND_MONO,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: TEXT_MUTED,
            margin: "0 0 10px",
          }}
        >
          Plain text
        </p>
        <pre
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            padding: 20,
            fontFamily: BRAND_MONO,
            fontSize: 12,
            lineHeight: 1.6,
            color: TEXT,
            background: "rgba(0,0,0,0.02)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: 0,
          }}
        >
          {text}
        </pre>
      </section>
    </MarketingShell>
  );
}
