import { describe, expect, it } from "vitest";
import { isAllowedLinkHref, sanitizeInlineHtml, sanitizePasteHtml } from "./sanitize";

describe("sanitizeInlineHtml", () => {
  it("preserves whitelisted inline formatting tags", () => {
    expect(sanitizeInlineHtml("<strong>bold</strong>")).toBe("<strong>bold</strong>");
    expect(sanitizeInlineHtml("<em>i</em><b>b</b><s>s</s><code>c</code>")).toBe(
      "<em>i</em><b>b</b><s>s</s><code>c</code>",
    );
  });

  it("strips <script> tags but keeps inner text content", () => {
    const out = sanitizeInlineHtml(`hello <script>alert(1)</script>world`);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert");
    expect(out).toContain("hello");
    expect(out).toContain("world");
  });

  it("removes event-handler attributes like onerror, onclick", () => {
    const out = sanitizeInlineHtml(`<span onclick="alert(1)" onerror="alert(2)">click</span>`);
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toMatch(/onerror/i);
    expect(out).toContain("click");
  });

  it("strips <img> tags entirely from inline html (not whitelisted)", () => {
    const out = sanitizeInlineHtml(`<img src=x onerror="alert(1)">`);
    expect(out).not.toContain("<img");
    expect(out).not.toMatch(/onerror/i);
  });

  it("blocks javascript: hrefs on anchors", () => {
    const out = sanitizeInlineHtml(`<a href="javascript:alert(1)">x</a>`);
    expect(out).not.toMatch(/javascript:/i);
  });

  it("blocks data: URIs on anchors", () => {
    const out = sanitizeInlineHtml(`<a href="data:text/html,<script>alert(1)</script>">x</a>`);
    expect(out).not.toContain("data:");
  });

  it("keeps http(s) and mailto and fragment hrefs", () => {
    expect(sanitizeInlineHtml(`<a href="https://example.com">x</a>`)).toContain('href="https://example.com"');
    expect(sanitizeInlineHtml(`<a href="http://example.com">x</a>`)).toContain('href="http://example.com"');
    expect(sanitizeInlineHtml(`<a href="mailto:a@b.com">x</a>`)).toContain('href="mailto:a@b.com"');
    expect(sanitizeInlineHtml(`<a href="#section-1">x</a>`)).toContain('href="#section-1"');
  });

  it("strips block tags (p, div, h1, etc.) from inline content but keeps text", () => {
    const out = sanitizeInlineHtml(`<p>hi</p><h1>title</h1>`);
    expect(out).not.toContain("<p>");
    expect(out).not.toContain("<h1>");
    expect(out).toContain("hi");
    expect(out).toContain("title");
  });
});

describe("sanitizePasteHtml", () => {
  it("keeps block structure (p, ul, li, table) since paste needs it", () => {
    const out = sanitizePasteHtml(`<p>hello</p><ul><li>a</li><li>b</li></ul>`);
    expect(out).toContain("<p>");
    expect(out).toContain("<ul>");
    expect(out).toContain("<li>");
  });

  it("still strips <script> from pasted content", () => {
    const out = sanitizePasteHtml(`<p>safe</p><script>alert(1)</script>`);
    expect(out).not.toContain("<script");
    expect(out).toContain("safe");
  });

  it("strips event handlers from pasted block tags", () => {
    const out = sanitizePasteHtml(`<p onclick="alert(1)">click me</p>`);
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain("click me");
  });

  it("blocks javascript: hrefs in pasted anchors", () => {
    const out = sanitizePasteHtml(`<a href="javascript:alert(1)">x</a>`);
    expect(out).not.toMatch(/javascript:/i);
  });
});

describe("isAllowedLinkHref", () => {
  it.each([
    ["https://example.com", true],
    ["http://example.com", true],
    ["mailto:foo@bar.com", true],
    ["#anchor", true],
    ["/relative/path", true],
    ["javascript:alert(1)", false],
    ["JAVASCRIPT:alert(1)", false],
    [" javascript:alert(1)", false],
    ["data:text/html,<script>", false],
    ["vbscript:msgbox(1)", false],
    ["file:///etc/passwd", false],
    ["", false],
    ["   ", false],
  ])("returns %o for %s", (href, expected) => {
    expect(isAllowedLinkHref(href as string)).toBe(expected);
  });
});
