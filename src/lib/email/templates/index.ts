/**
 * Template registry. Add a new template by:
 *   1. Creating `templates/<name>.ts` with a function that returns
 *      `{ subject, html, text }` from a typed data object.
 *   2. Adding it to `Templates` below.
 *
 * The discriminated union on `EmailPayload` (in ../send.ts) forces callers
 * to pass the right `data` shape for each template name — TypeScript is the
 * enforcement layer for the zero-knowledge rule (templates only accept the
 * plaintext fields they declare).
 */

import { welcomeTemplate, type WelcomeData } from "./welcome";
import { supportReceivedTemplate, type SupportReceivedData } from "./support-received";
import { supportAckTemplate, type SupportAckData } from "./support-ack";
import { billingReceiptTemplate, type BillingReceiptData } from "./billing-receipt";
import {
  billingPaymentFailedTemplate,
  type BillingPaymentFailedData,
} from "./billing-payment-failed";
import {
  billingRenewalReminderTemplate,
  type BillingRenewalReminderData,
} from "./billing-renewal-reminder";
import { abuseReportedTemplate, type AbuseReportedData } from "./abuse-reported";
import {
  recoveryEmailSetupTemplate,
  type RecoveryEmailSetupData,
} from "./recovery-email-setup";

export const Templates = {
  welcome: welcomeTemplate,
  "support-received": supportReceivedTemplate,
  "support-ack": supportAckTemplate,
  "billing-receipt": billingReceiptTemplate,
  "billing-payment-failed": billingPaymentFailedTemplate,
  "billing-renewal-reminder": billingRenewalReminderTemplate,
  "abuse-reported": abuseReportedTemplate,
  "recovery-email-setup": recoveryEmailSetupTemplate,
} as const;

export type TemplateName = keyof typeof Templates;

export type TemplateData = {
  welcome: WelcomeData;
  "support-received": SupportReceivedData;
  "support-ack": SupportAckData;
  "billing-receipt": BillingReceiptData;
  "billing-payment-failed": BillingPaymentFailedData;
  "billing-renewal-reminder": BillingRenewalReminderData;
  "abuse-reported": AbuseReportedData;
  "recovery-email-setup": RecoveryEmailSetupData;
};
