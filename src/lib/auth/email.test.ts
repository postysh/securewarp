import { describe, it, expect, vi } from "vitest";

// `normalizeEmail` is a server-only module, so vitest's resolve.alias
// for `server-only` lets us import it straight. Stub it explicitly too
// just to be safe — the alias matters for the import graph when the
// test runs.
vi.mock("server-only", () => ({}));
import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("lowercases the local-part", () => {
    expect(normalizeEmail("Alice@example.com")).toBe("alice@example.com");
  });

  it("lowercases the domain", () => {
    expect(normalizeEmail("alice@EXAMPLE.COM")).toBe("alice@example.com");
  });

  it("trims whitespace", () => {
    expect(normalizeEmail("  alice@example.com  ")).toBe("alice@example.com");
    expect(normalizeEmail("\talice@example.com\n")).toBe("alice@example.com");
  });

  it("collapses case variants into a single canonical form", () => {
    // This is the property the rate-limit and user-lookup paths
    // actually rely on. If ANY of these produce different strings the
    // rate-limit bypass window reopens.
    const variants = [
      "alice@example.com",
      "Alice@example.com",
      "ALICE@example.com",
      "ALICE@EXAMPLE.COM",
      "alice@Example.Com",
    ];
    const normalized = variants.map(normalizeEmail);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe("alice@example.com");
  });
});
