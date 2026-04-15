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

export const Templates = {
  welcome: welcomeTemplate,
} as const;

export type TemplateName = keyof typeof Templates;

export type TemplateData = {
  welcome: WelcomeData;
};
