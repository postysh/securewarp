import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, middleware } from "./middleware";
import { MAINTENANCE_HEADER } from "@/lib/maintenance";

function request(url: string, init: { method?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = { host: new URL(url).host };
  if (init.cookie) headers.cookie = init.cookie;
  return new NextRequest(url, { method: init.method ?? "GET", headers });
}

// NextResponse.next() marks the response instead of returning a body.
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("middleware — maintenance mode on", () => {
  it.each([
    "https://securewarp.com/",
    "https://securewarp.com/login",
    "https://securewarp.com/signup",
    "https://securewarp.com/drive",
    "https://securewarp.com/admin/flags",
    "https://securewarp.com/share/abc",
    "https://securewarp.com/pricing",
    "https://pdf.securewarp.com/viewer",
  ])("serves the maintenance page for %s", async (url) => {
    vi.stubEnv("MAINTENANCE_MODE", "on");
    const res = await middleware(request(url));
    expect(res.status).toBe(503);
    expect(res.headers.get(MAINTENANCE_HEADER)).toBe("1");
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("shuts out users who already have a session", async () => {
    vi.stubEnv("MAINTENANCE_MODE", "on");
    const res = await middleware(
      request("https://securewarp.com/drive", { cookie: "securewarp_session=anything" }),
    );
    expect(res.status).toBe(503);
  });

  it.each([
    ["POST", "https://securewarp.com/api/auth/login-init"],
    ["POST", "https://securewarp.com/api/auth/register"],
    ["GET", "https://securewarp.com/api/files/list"],
    ["GET", "https://securewarp.com/api/version"],
  ])("returns 503 JSON for %s %s", async (method, url) => {
    vi.stubEnv("MAINTENANCE_MODE", "on");
    const res = await middleware(request(url, { method }));
    expect(res.status).toBe(503);
    expect(res.headers.get(MAINTENANCE_HEADER)).toBe("1");
    expect(await res.json()).toMatchObject({ code: "maintenance" });
  });

  it.each([
    "https://securewarp.com/api/billing/webhook",
    "https://www.securewarp.com/api/billing/webhook",
    "https://securewarp.com/api/cron/expire-trash",
    "https://securewarp.com/api/admin/cleanup-stale",
  ])("keeps %s open", async (url) => {
    vi.stubEnv("MAINTENANCE_MODE", "on");
    const res = await middleware(request(url, { method: "POST" }));
    expect(passedThrough(res)).toBe(true);
  });

  it("still canonicalizes www before serving the maintenance page", async () => {
    vi.stubEnv("MAINTENANCE_MODE", "on");
    const res = await middleware(request("https://www.securewarp.com/login"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://securewarp.com/login");
  });
});

describe("middleware — maintenance mode off", () => {
  it.each([
    "https://securewarp.com/",
    "https://securewarp.com/signup",
    "https://securewarp.com/api/files/list",
  ])("passes %s through", async (url) => {
    const res = await middleware(request(url));
    expect(passedThrough(res)).toBe(true);
  });

  it("still sends signed-out users from protected routes to /login", async () => {
    const res = await middleware(request("https://securewarp.com/drive"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://securewarp.com/login");
  });

  it("treats an explicit off value as off", async () => {
    vi.stubEnv("MAINTENANCE_MODE", "off");
    const res = await middleware(request("https://securewarp.com/"));
    expect(passedThrough(res)).toBe(true);
  });
});

describe("middleware matcher", () => {
  it.each([
    "https://securewarp.com/",
    "https://securewarp.com/login",
    "https://securewarp.com/signup",
    "https://securewarp.com/pricing",
    "https://securewarp.com/share/3f2a9c1e-0000-4000-8000-000000000000",
    "https://securewarp.com/drive/folder/abc",
    "https://securewarp.com/api/auth/login-init",
    "https://securewarp.com/api/files/list",
    "https://www.securewarp.com/api/files/list",
    "https://pdf.securewarp.com/viewer",
  ])("runs on %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  it.each([
    "https://securewarp.com/_next/static/chunks/main.js",
    "https://securewarp.com/_next/image",
    "https://securewarp.com/fonts/Chillax-Variable.woff2",
    "https://securewarp.com/icon.svg",
    "https://securewarp.com/robots.txt",
  ])("skips static file %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });
});
