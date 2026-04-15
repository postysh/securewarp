import { describe, it, expect } from "vitest";
import { tokenizeFilename, tokenizeFile, tokenizeQuery } from "./tokenize";

describe("tokenizeFilename", () => {
  it("emits whole-word and trigram tokens", () => {
    const tokens = tokenizeFilename("budget.xlsx");
    expect(tokens).toContain("w:budget");
    expect(tokens).toContain("w:xlsx");
    // budget → bud, udg, dge, get
    expect(tokens).toContain("g:bud");
    expect(tokens).toContain("g:get");
    // xlsx → xls, lsx
    expect(tokens).toContain("g:xls");
    expect(tokens).toContain("g:lsx");
  });

  it("strips diacritics and lowercases", () => {
    const tokens = tokenizeFilename("Café Résumé.PDF");
    expect(tokens).toContain("w:cafe");
    expect(tokens).toContain("w:resume");
    expect(tokens).toContain("w:pdf");
  });

  it("splits on punctuation and case boundaries", () => {
    const tokens = tokenizeFilename("Q4-Report_2024.docx");
    expect(tokens).toContain("w:q4");
    expect(tokens).toContain("w:report");
    expect(tokens).toContain("w:2024");
    expect(tokens).toContain("w:docx");
  });

  it("emits no trigrams for words shorter than 3 chars", () => {
    const tokens = tokenizeFilename("q4 ab xyz");
    expect(tokens).toContain("w:q4");
    expect(tokens).toContain("w:ab");
    expect(tokens).toContain("w:xyz");
    expect(tokens).toContain("g:xyz");
    // No trigrams for "q4" or "ab"
    expect(tokens.filter((t) => t.startsWith("g:"))).toEqual(["g:xyz"]);
  });

  it("dedupes repeated words", () => {
    const tokens = tokenizeFilename("test test test.txt");
    const wholeWord = tokens.filter((t) => t === "w:test");
    expect(wholeWord.length).toBe(1);
  });

  it("drops common stopwords", () => {
    const tokens = tokenizeFilename("the report of and to.pdf");
    expect(tokens).not.toContain("w:the");
    expect(tokens).not.toContain("w:of");
    expect(tokens).not.toContain("w:and");
    expect(tokens).not.toContain("w:to");
    expect(tokens).toContain("w:report");
  });
});

describe("tokenizeFile (filename + content)", () => {
  it("includes both filename and content tokens", () => {
    const tokens = tokenizeFile("notes.md", "Quarterly review meeting notes.");
    expect(tokens).toContain("w:notes");
    expect(tokens).toContain("w:quarterly");
    expect(tokens).toContain("w:review");
    expect(tokens).toContain("w:meeting");
  });

  it("truncates very long content", () => {
    const longContent = "a".repeat(200_000) + " RAREWORD";
    const tokens = tokenizeFile("big.txt", longContent);
    // Word past the 100k char cap should NOT appear.
    expect(tokens).not.toContain("w:rareword");
  });

  it("caps the unique token set per file", () => {
    // Generate 20k unique words; cap is 5k content tokens.
    const words: string[] = [];
    for (let i = 0; i < 20_000; i++) words.push(`uniqueword${i}`);
    const tokens = tokenizeFile("dump.txt", words.join(" "));
    // Filename tokens + capped content tokens
    expect(tokens.length).toBeLessThanOrEqual(5_010);
  });
});

describe("tokenizeQuery", () => {
  it("matches what tokenizeFilename produces for the same word", () => {
    const fileTokens = new Set(tokenizeFilename("budget.xlsx"));
    const queryTokens = tokenizeQuery("budget");
    for (const t of queryTokens) {
      expect(fileTokens.has(t)).toBe(true);
    }
  });

  it("substring queries match via trigrams", () => {
    const fileTokens = new Set(tokenizeFilename("rebudgeting.xlsx"));
    // Query "bud" produces only the trigram token (whole word "bud"
    // doesn't appear in the file's whole-word list, but the trigram
    // does — that's how substring search works).
    const queryTokens = tokenizeQuery("bud");
    const trigramHit = queryTokens.find((t) => t === "g:bud");
    expect(trigramHit).toBeDefined();
    expect(fileTokens.has("g:bud")).toBe(true);
  });

  it("returns empty list for empty query", () => {
    expect(tokenizeQuery("")).toEqual([]);
    expect(tokenizeQuery("   ")).toEqual([]);
  });
});
