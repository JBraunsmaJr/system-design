import * as Icons from "lucide-react";

export interface IconAttribution {
  author?: string;
  license?: string;
  source?: string;
}

export type IconSource =
  | {
      type: "builtin";
      key: string;
    }
  | {
      type: "svg";
      data: string;
    }
  | {
      type: "image";
      data: string;
      mimeType: string;
    };

export interface IconDefinition {
  id: string;
  name: string;
  category?: string;
  tags?: string[];
  version: number;
  source: IconSource;
  attribution?: IconAttribution;
  libraryId?: string;
}

// Extract valid Lucide icon names
export const BUILTIN_LUCIDE_NAMES = Object.keys(Icons)
  .filter((name) => /^[A-Z]/.test(name) && !name.endsWith("Icon") && !name.startsWith("Lucide"))
  .sort();

// Categorization helper for built-in icons
function getBuiltinCategory(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("server") || n.includes("cpu") || n.includes("harddrive") || n.includes("zap") || n.includes("terminal") || n.includes("chip")) {
    return "Compute & Hardware";
  }
  if (n.includes("database") || n.includes("table") || n.includes("layers") || n.includes("file") || n.includes("folder") || n.includes("archive")) {
    return "Data & Storage";
  }
  if (n.includes("network") || n.includes("globe") || n.includes("wifi") || n.includes("radio") || n.includes("router") || n.includes("signal") || n.includes("share")) {
    return "Networking";
  }
  if (n.includes("lock") || n.includes("key") || n.includes("shield") || n.includes("user") || n.includes("fingerprint")) {
    return "Security & Identity";
  }
  if (n.includes("mail") || n.includes("message") || n.includes("bell") || n.includes("send") || n.includes("inbox")) {
    return "Messaging";
  }
  if (n.includes("chart") || n.includes("activity") || n.includes("gauge") || n.includes("eye") || n.includes("search")) {
    return "Observability";
  }
  if (n.includes("git") || n.includes("code") || n.includes("branch") || n.includes("commit") || n.includes("workflow") || n.includes("play")) {
    return "Development & Logic";
  }
  return "General";
}

// Generate tags for built-in icons
function getBuiltinTags(name: string): string[] {
  const tags: string[] = [name.toLowerCase()];
  // Split camelCase
  const parts = name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(" ");
  for (const part of parts) {
    if (!tags.includes(part)) tags.push(part);
  }
  return tags;
}

const ALLOWED_SVG_TAGS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "line",
  "rect",
  "polygon",
  "polyline",
  "text",
  "tspan",
  "defs",
  "clippath",
  "mask",
  "pattern",
  "lineargradient",
  "radialgradient",
  "stop",
  "use",
  "symbol",
]);

const ALLOWED_SVG_ATTRS = new Set([
  "id",
  "class",
  "viewbox",
  "xmlns",
  "version",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "transform",
  "clip-path",
  "clip-rule",
  "mask",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientunits",
  "gradienttransform",
  "spreadmethod",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "dx",
  "dy",
  "href",
  "xlink:href",
  "xml:space",
]);

const ACTIVE_CONTAINER_TAGS = new Set([
  "script",
  "style",
  "foreignobject",
]);

const ALLOWED_TEXT_TAGS = new Set([
  "text",
  "tspan",
]);

function isDangerousHref(val: string): boolean {
  if (!val || typeof val !== "string") return false;
  const trimmed = val.trim().toLowerCase();
  return (
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("vbscript:") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("file:") ||
    trimmed.startsWith("blob:")
  );
}

function escapeAttributeValue(val: string): string {
  return val
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}


/**
 * Tokenizes raw SVG content and reconstructs it using only allowed tags and attributes.
 * Disallowed tags and active blocks (script, style, foreignObject, iframe, etc.) and comments are skipped.
 */
function sanitizeSvgTokens(svgContent: string): string {
  let pos = 0;
  const len = svgContent.length;
  const output: string[] = [];
  let openTextTagCount = 0;

  while (pos < len) {
    const nextLt = svgContent.indexOf("<", pos);
    if (nextLt === -1) {
      if (openTextTagCount > 0) {
        output.push(svgContent.slice(pos));
      }
      break;
    }

    // Preserve text only inside text/tspan elements
    if (nextLt > pos && openTextTagCount > 0) {
      output.push(svgContent.slice(pos, nextLt));
    }
    pos = nextLt;

    // 1. Skip comments: <!-- ... -->
    if (svgContent.startsWith("<!--", pos)) {
      const endComment = svgContent.indexOf("-->", pos + 4);
      pos = endComment === -1 ? len : endComment + 3;
      continue;
    }

    // 2. Skip XML declarations and DOCTYPE: <?...?> or <!DOCTYPE ...>
    if (svgContent.startsWith("<?", pos)) {
      const endDecl = svgContent.indexOf("?>", pos + 2);
      pos = endDecl === -1 ? len : endDecl + 2;
      continue;
    }
    if (svgContent.startsWith("<!", pos)) {
      const endDoc = svgContent.indexOf(">", pos + 2);
      pos = endDoc === -1 ? len : endDoc + 1;
      continue;
    }

    // 3. Parse tag: <(/)? tagName [attrs] (/)?>
    const tagMatch = /^<(\/)?([a-zA-Z0-9_:-]+)/.exec(svgContent.slice(pos));
    if (!tagMatch) {
      pos++;
      continue;
    }

    const isClosing = Boolean(tagMatch[1]);
    const rawTag = tagMatch[2];
    const lowerTag = rawTag.toLowerCase();

    // Find end of tag '>' but abort if nested unescaped '<' is encountered
    let tagEnd = pos + tagMatch[0].length;
    let inQuotes: string | null = null;
    let hitNestedLt = false;

    while (tagEnd < len) {
      const char = svgContent[tagEnd];
      if (inQuotes) {
        if (char === inQuotes) inQuotes = null;
      } else if (char === '"' || char === "'") {
        inQuotes = char;
      } else if (char === "<") {
        hitNestedLt = true;
        break;
      } else if (char === ">") {
        break;
      }
      tagEnd++;
    }

    if (hitNestedLt) {
      pos = tagEnd;
      continue;
    }

    if (tagEnd >= len) {
      break;
    }

    const fullTagContent = svgContent.slice(pos, tagEnd + 1);
    const isSelfClosing = fullTagContent.endsWith("/>") || fullTagContent.endsWith("/ >");
    const rawAttrs = svgContent.slice(pos + tagMatch[0].length, tagEnd - (isSelfClosing ? 1 : 0));
    pos = tagEnd + 1;

    // Handle closing tags
    if (isClosing) {
      if (ALLOWED_TEXT_TAGS.has(lowerTag) && openTextTagCount > 0) {
        openTextTagCount--;
      }
      if (ALLOWED_SVG_TAGS.has(lowerTag)) {
        output.push(`</${lowerTag}>`);
      }
      continue;
    }

    // If tag is active container (script, style, foreignObject), skip to closing tag
    if (ACTIVE_CONTAINER_TAGS.has(lowerTag)) {
      if (!isSelfClosing) {
        const closeTagRegex = new RegExp(`</\\s*${lowerTag}[^>]*>`, "i");
        const match = closeTagRegex.exec(svgContent.slice(pos));
        if (match) {
          pos = pos + match.index + match[0].length;
        } else {
          pos = len;
        }
      }
      continue;
    }

    if (!ALLOWED_SVG_TAGS.has(lowerTag)) {
      continue;
    }

    if (ALLOWED_TEXT_TAGS.has(lowerTag) && !isSelfClosing) {
      openTextTagCount++;
    }

    // Parse attributes
    const cleanAttrs: string[] = [];
    if (rawAttrs) {
      const attrRegex = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let attrMatch: RegExpExecArray | null;
      while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
        const attrName = attrMatch[1];
        const lowerName = attrName.toLowerCase();
        const attrVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";

        if (lowerName.startsWith("on")) continue;
        if (!ALLOWED_SVG_ATTRS.has(lowerName) && !lowerName.startsWith("data-")) continue;

        if ((lowerName === "href" || lowerName === "xlink:href" || lowerName === "src") && isDangerousHref(attrVal)) {
          continue;
        }

        cleanAttrs.push(`${attrName}="${escapeAttributeValue(attrVal)}"`);
      }
    }

    const attrsString = cleanAttrs.length > 0 ? " " + cleanAttrs.join(" ") : "";
    output.push(`<${lowerTag}${attrsString}${isSelfClosing ? " />" : ">"}`);
  }

  return output.join("").trim();
}

/**
 * Sanitizes an SVG string using a strict whitelist approach for both tags and attributes.
 * Strips all script tags, foreignObject, iframe, embed, object, inline event handlers,
 * and dangerous hrefs, handling nested evasions and arbitrary whitespace.
 */
export function sanitizeSvg(svgContent: string): string {
  if (!svgContent || typeof svgContent !== "string") return "";
  // Avoid reparsing untrusted input with DOMParser; sanitize through strict token whitelist
  return sanitizeSvgTokens(svgContent);
}

/**
 * Validates whether an SVG string is valid and safe.
 */
export function isValidSvg(svg: string): boolean {
  if (!svg || typeof svg !== "string") return false;
  const trimmed = svg.trim();
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith("<svg") || !lower.endsWith("</svg>")) {
    return false;
  }
  const disallowed = [
    "script",
    "style",
    "foreignobject",
    "iframe",
    "object",
    "embed",
    "applet",
    "template",
    "meta",
    "link",
    "body",
    "html",
  ];
  for (const tag of disallowed) {
    if (lower.includes(`<${tag}`) || lower.includes(`</${tag}`)) {
      return false;
    }
  }
  return !/\bon[a-z0-9_-]+\s*=/i.test(trimmed);
}

export class IconRegistry {
  private icons: Map<string, IconDefinition> = new Map();
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.registerBuiltinIcons();
  }

  private registerBuiltinIcons() {
    for (const name of BUILTIN_LUCIDE_NAMES) {
      const def: IconDefinition = {
        id: name,
        name,
        category: getBuiltinCategory(name),
        tags: getBuiltinTags(name),
        version: 1,
        source: {
          type: "builtin",
          key: name,
        },
      };
      this.icons.set(name, def);
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public registerIcon(definition: IconDefinition): void {
    if (!definition.id || !definition.name) {
      throw new Error("Icon definition must have id and name");
    }

    if (definition.source.type === "svg") {
      definition.source.data = sanitizeSvg(definition.source.data);
    }

    this.icons.set(definition.id, { ...definition });
    this.notify();
  }

  public unregisterIcon(id: string): boolean {
    if (this.icons.has(id)) {
      const deleted = this.icons.delete(id);
      if (deleted) this.notify();
      return deleted;
    }
    return false;
  }

  public unregisterLibraryIcons(libraryId: string): void {
    let changed = false;
    for (const [id, def] of this.icons.entries()) {
      if (def.libraryId === libraryId) {
        this.icons.delete(id);
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  public getIcon(id: string): IconDefinition | undefined {
    return this.icons.get(id);
  }

  public getAllIcons(): IconDefinition[] {
    return Array.from(this.icons.values());
  }

  public getCategories(): string[] {
    const categories = new Set<string>();
    for (const icon of this.icons.values()) {
      if (icon.category) categories.add(icon.category);
    }
    return Array.from(categories).sort();
  }

  public getIconsByCategory(category: string): IconDefinition[] {
    return this.getAllIcons().filter((icon) => icon.category === category);
  }

  public searchIcons(query: string, categoryFilter?: string): IconDefinition[] {
    const q = query.trim().toLowerCase();
    let results = this.getAllIcons();

    if (categoryFilter && categoryFilter !== "all") {
      results = results.filter((icon) => icon.category === categoryFilter);
    }

    if (!q) return results;

    return results.filter((icon) => {
      if (icon.name.toLowerCase().includes(q)) return true;
      if (icon.id.toLowerCase().includes(q)) return true;
      if (icon.category && icon.category.toLowerCase().includes(q)) return true;
      if (icon.libraryId && icon.libraryId.toLowerCase().includes(q)) return true;
      return !!(icon.tags && icon.tags.some((tag) => tag.toLowerCase().includes(q)));
    });
  }
}

export const globalIconRegistry = new IconRegistry();
