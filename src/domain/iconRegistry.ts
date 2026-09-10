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

function isDangerousHref(val: string): boolean {
  const trimmed = val.trim().toLowerCase();
  return (
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("vbscript:") ||
    trimmed.startsWith("data:text/html")
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
 * Sanitizes an SVG string using a strict whitelist approach for both tags and attributes.
 * Strips all script tags, foreignObject, iframe, embed, object, inline event handlers,
 * and dangerous hrefs, handling nested evasions and arbitrary whitespace.
 */
export function sanitizeSvg(svgContent: string): string {
  if (!svgContent || typeof svgContent !== "string") return "";

  let cleaned = svgContent;

  // Multi-pass iterative sanitization loop to reach a safe fixed-point
  let previous: string;
  let iterations = 0;
  const MAX_ITERATIONS = 20;

  do {
    previous = cleaned;
    iterations++;

    // Remove XML declaration, doctype, and comments
    cleaned = cleaned.replace(/<\?xml[\s\S]*?\?>/gi, "");
    cleaned = cleaned.replace(/<!DOCTYPE[\s\S]*?>/gi, "");
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/gi, "");

    // Remove block-level active content tags and anything inside them (including variations with whitespace)
    cleaned = cleaned.replace(/<\s*script\b[\s\S]*?<\/\s*script\s*>/gi, "");
    cleaned = cleaned.replace(/<\s*style\b[\s\S]*?<\/\s*style\s*>/gi, "");
    cleaned = cleaned.replace(/<\s*foreignobject\b[\s\S]*?<\/\s*foreignobject\s*>/gi, "");
    cleaned = cleaned.replace(/<\s*(?:object|embed|iframe|applet|link|meta|form|input|button|base|frame|frameset)\b[\s\S]*?<\/\s*(?:object|embed|iframe|applet|link|meta|form|input|button|base|frame|frameset)\s*>/gi, "");

    // Tokenize and filter all remaining tags against the SVG element and attribute whitelists
    cleaned = cleaned.replace(/<(\/)?([a-zA-Z0-9_:-]+)((?:\s+[^>]*)?)\/?>/gi, (match, isClosing, tagName, rawAttrs) => {
      const lowerTag = tagName.toLowerCase();
      if (!ALLOWED_SVG_TAGS.has(lowerTag)) {
        return "";
      }

      if (isClosing) {
        return `</${lowerTag}>`;
      }

      const isSelfClosing = match.trimEnd().endsWith("/>");
      const cleanAttrs: string[] = [];

      if (rawAttrs) {
        const attrRegex = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        let attrMatch: RegExpExecArray | null;
        while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
          const name = attrMatch[1];
          const lowerName = name.toLowerCase();
          const val = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "";

          // Reject inline event handlers (on*) or non-whitelisted attributes
          if (lowerName.startsWith("on")) continue;
          if (!ALLOWED_SVG_ATTRS.has(lowerName) && !lowerName.startsWith("data-")) continue;

          // Reject dangerous URI schemes in href / xlink:href / src
          if ((lowerName === "href" || lowerName === "xlink:href" || lowerName === "src") && isDangerousHref(val)) {
            continue;
          }

          cleanAttrs.push(`${name}="${escapeAttributeValue(val)}"`);
        }
      }

      return `<${lowerTag}${cleanAttrs.length > 0 ? " " + cleanAttrs.join(" ") : ""}${isSelfClosing ? " />" : ">"}`;
    });
  } while (cleaned !== previous && iterations < MAX_ITERATIONS);

  // If running in DOM environment (browser), apply DOMParser sanitization for full defense-in-depth
  if (typeof DOMParser !== "undefined" && typeof XMLSerializer !== "undefined") {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(cleaned, "image/svg+xml");
      if (!doc.querySelector("parsererror")) {
        const allElements = Array.from(doc.querySelectorAll("*"));
        for (const el of allElements) {
          const tag = el.tagName.toLowerCase();
          if (!ALLOWED_SVG_TAGS.has(tag)) {
            el.remove();
            continue;
          }

          const toRemove: string[] = [];
          for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i];
            const name = attr.name.toLowerCase();
            const val = attr.value.trim().toLowerCase();
            if (name.startsWith("on") || (!ALLOWED_SVG_ATTRS.has(name) && !name.startsWith("data-"))) {
              toRemove.push(attr.name);
            } else if ((name === "href" || name === "xlink:href" || name === "src") && isDangerousHref(val)) {
              toRemove.push(attr.name);
            }
          }
          for (const attrName of toRemove) {
            el.removeAttribute(attrName);
          }
        }

        cleaned = new XMLSerializer().serializeToString(doc.documentElement || doc);
      }
    } catch {
      // Fallback to tokenizer-cleaned result
    }
  }

  return cleaned.trim();
}

/**
 * Validates whether an SVG string is valid and safe.
 */
export function isValidSvg(svg: string): boolean {
  if (!svg || typeof svg !== "string") return false;
  const trimmed = svg.trim();
  if (!trimmed.toLowerCase().startsWith("<svg") || !trimmed.toLowerCase().endsWith("</svg>")) {
    return false;
  }
  // Check for script tag remnants, active content, or event handlers
  if (
    /<\s*\/?\s*script/i.test(trimmed) ||
    /<\s*\/?\s*iframe/i.test(trimmed) ||
    /<\s*\/?\s*object/i.test(trimmed) ||
    /<\s*\/?\s*embed/i.test(trimmed) ||
    /<\s*\/?\s*foreignobject/i.test(trimmed) ||
    /\bon[a-z0-9_-]+\s*=/i.test(trimmed)
  ) {
    return false;
  }
  return true;
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

  public registerIcons(definitions: IconDefinition[]): void {
    for (const def of definitions) {
      if (def.source.type === "svg") {
        def.source.data = sanitizeSvg(def.source.data);
      }
      this.icons.set(def.id, { ...def });
    }
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
      if (icon.tags && icon.tags.some((tag) => tag.toLowerCase().includes(q))) return true;
      return false;
    });
  }

  public resetToBuiltins() {
    this.icons.clear();
    this.registerBuiltinIcons();
    this.notify();
  }
}

export const globalIconRegistry = new IconRegistry();
