import sanitizeHtml from "sanitize-html";

/**
 * Admin-authored rich text is cleaned once, when it is saved, so everything stored and served
 * is already safe. Allowlist only: no scripts, styles, images, iframes or inline event handlers.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["h2", "h3", "h4", "p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "blockquote", "a"],
  allowedAttributes: { a: ["href", "target", "rel"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: "noopener noreferrer nofollow", ...(attribs.target ? { target: "_blank" } : {}) }
    })
  }
};

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}
