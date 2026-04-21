import type { TemplateName } from "./templates";

/**
 * Shared fixture data for the /dev/emails preview + the
 * /api/dev/send-email test-send endpoint. Kept plaintext-only in
 * the same spirit as the zero-knowledge rule the real send path
 * enforces — every field maps to something the server would
 * legitimately have (email, display name, Stripe invoice metadata,
 * user-typed support copy).
 */
export const EMAIL_PREVIEW_FIXTURES: Record<TemplateName, unknown> = {
  welcome: {
    displayName: "Jane Doe",
    driveUrl: "https://www.securewarp.com/drive",
  },
  "support-received": {
    fromEmail: "jane@example.com",
    fromName: "Jane Doe",
    subject: "Can't find a shared file",
    message:
      "Hi team, a colleague shared a folder with me last week and it isn't showing up in Shared with me. Am I missing something?\n\nThanks!\nJane",
  },
  "support-ack": {
    userName: "Jane",
    subject: "Can't find a shared file",
  },
  "billing-receipt": {
    displayName: "Jane Doe",
    planLabel: "Plus",
    amountFormatted: "$4.99",
    invoicePdfUrl: "https://pay.stripe.com/invoice/acct_demo/test_abc/pdf",
    nextRenewalDate: "May 20, 2026",
    portalUrl: "https://www.securewarp.com/drive",
  },
  "billing-payment-failed": {
    displayName: "Jane Doe",
    planLabel: "Pro",
    amountFormatted: "$9.99",
    portalUrl: "https://www.securewarp.com/drive",
    retryDate: "April 24, 2026",
  },
  "billing-renewal-reminder": {
    displayName: "Jane Doe",
    planLabel: "Plus",
    amountFormatted: "$4.99",
    renewalDate: "April 23, 2026",
    portalUrl: "https://www.securewarp.com/drive",
  },
};
