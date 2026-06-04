import DOMPurify from "dompurify";

const INLINE_TAGS = ["b", "i", "u", "em", "strong", "code", "s", "a", "span", "br"];
const PASTE_TAGS = [
  ...INLINE_TAGS,
  "p", "div",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "blockquote", "pre",
  "hr",
  "table", "thead", "tbody", "tr", "th", "td",
  "img",
];

const ALLOWED_ATTR = ["href", "style", "src", "alt", "title", "colspan", "rowspan"];

// Allow only safe URL schemes for href/src. Blocks `javascript:` and `data:` etc.
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto):|#|\/)/i;

export function sanitizeInlineHtml(html: string): string {
  if (typeof window === "undefined") return "";
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: INLINE_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
  });
}

export function sanitizePasteHtml(html: string): string {
  if (typeof window === "undefined") return "";
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: PASTE_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
  });
}

// `^(https?:|mailto:|#|/)` — same scheme allow-list as `ALLOWED_URI_REGEXP`,
// exposed for explicit href validation (B22) before applying execCommand("createLink").
export function isAllowedLinkHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) return false;
  return ALLOWED_URI_REGEXP.test(trimmed);
}
