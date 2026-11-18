import { feedURL } from "../../../shared/utils/feed";

// Source markup is untrusted. Only these elements survive, and only the attributes rebuilt below.
const allowed = new Set([
    "a", "abbr", "b", "blockquote", "br", "caption", "cite", "code", "dd", "del", "div", "dl", "dt", "em", "figcaption", "figure",
    "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "s", "small", "span",
    "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul"
]);
// These are removed together with everything inside them; other unknown elements keep their text.
const dropped = new Set([
    "script", "style", "iframe", "object", "embed", "form", "input", "button", "select", "textarea", "svg", "math", "template",
    "noscript", "video", "audio", "canvas", "link", "meta", "base", "head", "title"
]);
const headings: Record<string, string> = { h1: "h3", h2: "h3", h3: "h4", h4: "h5", h5: "h6", h6: "h6" };

function address(value: string | null, base: string | undefined): string | null {
    try {
        return value ? feedURL(value.trim(), base) : null;
    }
    catch {
        return null;
    }
}

/** A tracking pixel or spacer, judged by the size the source declared. */
function tiny(image: Element): boolean {
    return ["width", "height"].some(name => {
        const size = Number.parseInt(image.getAttribute(name) ?? "", 10);
        return Number.isFinite(size) && size <= 2;
    });
}

function copy(source: Node, target: Node, document: Document, base: string | undefined): void {
    for (const node of source.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            target.appendChild(document.createTextNode(node.textContent ?? ""));
            continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const element = node as Element, name = element.localName;
        if (dropped.has(name)) continue;
        if (!allowed.has(name)) {
            copy(element, target, document, base);
            continue;
        }
        if (name === "img") {
            // The application only loads images over HTTPS.
            const src = address(element.getAttribute("src"), base)?.replace(/^http:/, "https:");
            if (!src || tiny(element)) continue;
            const image = document.createElement("img");
            // Set before the address, which starts the request.
            image.loading = "lazy";
            image.decoding = "async";
            // Sources do not learn which page of the application loaded their image.
            image.referrerPolicy = "no-referrer";
            image.alt = element.getAttribute("alt") ?? "";
            image.src = src;
            target.appendChild(image);
            continue;
        }
        // Article headings sit below the item's own title.
        const created = document.createElement(headings[name] ?? name);
        if (name === "a") {
            const href = address(element.getAttribute("href"), base);
            if (href) {
                created.setAttribute("href", href);
                created.setAttribute("target", "_blank");
                created.setAttribute("rel", "noopener noreferrer");
            }
        }
        else if (name === "td" || name === "th") {
            for (const span of ["colspan", "rowspan"]) {
                const value = Number.parseInt(element.getAttribute(span) ?? "", 10);
                if (value > 1 && value <= 100) created.setAttribute(span, String(value));
            }
        }
        copy(element, created, document, base);
        target.appendChild(created);
    }
}

/**
 * Converts an item's markup into nodes that are safe to show: scripts, styles, frames,
 * forms and event handlers are gone, and links and images are limited to web addresses.
 */
export function sanitizeContent(html: string, base?: string | null): DocumentFragment {
    // An inert document: nothing in it loads or runs while it is being read. Inline event handlers
    // would still be reported to the console as policy violations, so they are renamed inside tags first;
    // sample code shown as text is left as written. No attribute of the source is copied in any case.
    const quiet = html.replace(/<[a-zA-Z](?:[^>"']|"[^"]*"|'[^']*')*>/g, tag => tag.replace(/(\s)on(?=[a-z]+\s*=)/gi, "$1data-on"));
    const parsed = new DOMParser().parseFromString(quiet, "text/html");
    const fragment = document.createDocumentFragment();
    copy(parsed.body, fragment, document, base ?? undefined);
    return fragment;
}