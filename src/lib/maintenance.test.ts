import { describe, expect, it } from "vitest";
import {
  MAINTENANCE_HEADER,
  isMaintenanceEnabled,
  isMaintenanceExempt,
  maintenanceResponse,
} from "./maintenance";

describe("isMaintenanceEnabled", () => {
  it.each(["1", "true", "on", "yes", " TRUE ", "On"])("treats %j as on", (v) => {
    expect(isMaintenanceEnabled(v)).toBe(true);
  });

  it.each([undefined, "", "0", "false", "off", "no", "maintenance"])("treats %j as off", (v) => {
    expect(isMaintenanceEnabled(v)).toBe(false);
  });
});

describe("isMaintenanceExempt", () => {
  it.each([
    "/api/billing/webhook",
    "/api/cron/expire-trash",
    "/api/cron/prune-versions",
    "/api/cron/status-check",
    "/api/admin/cleanup-stale",
  ])("keeps server-to-server route %s open", (p) => {
    expect(isMaintenanceExempt(p)).toBe(true);
  });

  it.each([
    "/",
    "/login",
    "/signup",
    "/drive",
    "/admin/flags",
    "/share/abc",
    "/api/auth/login-init",
    "/api/auth/register",
    "/api/billing/status",
    "/api/admin/flags",
    // Prefix lookalikes must not ride on an exemption.
    "/api/billing/webhookx",
    "/api/cronjob",
    "/api/admin/cleanup-stale-extra",
  ])("closes %s", (p) => {
    expect(isMaintenanceExempt(p)).toBe(false);
  });
});

describe("maintenanceResponse", () => {
  it("returns 503 JSON for API routes", async () => {
    const res = maintenanceResponse("/api/files/list");
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get(MAINTENANCE_HEADER)).toBe("1");
    expect(await res.json()).toMatchObject({ code: "maintenance" });
  });

  it("returns a self-contained 503 page for everything else", async () => {
    const res = maintenanceResponse("/");
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get(MAINTENANCE_HEADER)).toBe("1");
    expect(res.headers.get("retry-after")).toBe("3600");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    // The page ships no JS, and its CSP says so.
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("script-src");
    const html = await res.text();
    expect(html).not.toContain("<script");
    expect(html).toContain("mailto:hello@securewarp.com");
  });

  it("uses the configured support inbox and escapes it", async () => {
    const res = maintenanceResponse("/", `"><img src=x>@example.com`);
    const html = await res.text();
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&quot;&gt;&lt;img src=x&gt;@example.com");
  });
});
