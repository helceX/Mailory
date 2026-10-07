import sanitizeHtml from "sanitize-html";

/**
 * Allow-list sanitizer for the custom HTML block. Email clients ignore scripts anyway, but a stored
 * script would still run in our own preview and "view in browser" page, so it must never survive.
 * Only structural/typographic tags, a few safe inline styles, and http(s)/mailto/tel links.
 */
const SAFE_STYLES = {
  color: [/^#[0-9a-f]{3,6}$/i, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i],
  "background-color": [/^#[0-9a-f]{3,6}$/i],
  "font-size": [/^\d{1,2}(px|pt|em|%)$/],
  "font-weight": [/^(normal|bold|[1-9]00)$/],
  "font-style": [/^(normal|italic)$/],
  "text-align": [/^(left|right|center|justify)$/],
  "text-decoration": [/^(none|underline|line-through)$/],
  "line-height": [/^\d{1,3}(px|%|em)?(\.\d+)?$/],
  padding: [/^(\d{1,3}(px|%)?\s?){1,4}$/],
  margin: [/^(\d{1,3}(px|%)?\s?|auto\s?){1,4}$/],
  width: [/^\d{1,4}(px|%)$/],
  height: [/^\d{1,4}(px|%)$/],
  border: [/^\d{1,2}px (solid|dashed|dotted) #[0-9a-f]{3,6}$/i],
};

const ABSOLUTE_LINK = /^(https?:|mailto:|tel:)/i;
const SYSTEM_LINK_TOKEN = /^\{\{\s*(unsubscribe_url|view_in_browser_url)\s*\}\}$/i;

export function sanitizeHtmlBlock(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "a",
      "b",
      "strong",
      "i",
      "em",
      "u",
      "s",
      "p",
      "br",
      "hr",
      "ul",
      "ol",
      "li",
      "span",
      "div",
      "h1",
      "h2",
      "h3",
      "h4",
      "table",
      "thead",
      "tbody",
      "tr",
      "td",
      "th",
      "img",
      "blockquote",
      "small",
      "center",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      td: ["align", "valign", "colspan", "rowspan", "width", "style"],
      th: ["align", "valign", "colspan", "rowspan", "width", "style"],
      table: [
        "role",
        "width",
        "cellpadding",
        "cellspacing",
        "border",
        "align",
        "style",
      ],
      "*": ["style"],
    },
    allowedStyles: { "*": SAFE_STYLES },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      // An image with no absolute http(s) source is only a broken icon in the inbox. (exclusiveFilter is not
      // applied to void tags like <img>, so rename it to a tag that is not allowed and thus discarded.)
      img: (tag, attribs) =>
        /^https?:\/\//i.test((attribs.src ?? "").trim())
          ? { tagName: tag, attribs }
          : { tagName: "discarded-img", attribs: {} },
      // Only absolute http(s)/mailto/tel links (or our two system link tokens) survive; a relative href
      // would resolve against whatever host the email is opened on.
      a: (tag, attribs) => {
        const { href, ...rest } = attribs;
        const value = href?.trim() ?? "";
        const ok = ABSOLUTE_LINK.test(value) || SYSTEM_LINK_TOKEN.test(value);
        return {
          tagName: tag,
          attribs: {
            ...rest,
            ...(ok ? { href: value } : {}),
            rel: "noopener noreferrer nofollow",
          },
        };
      },
    },
  });
}
