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

/**
 * Sanitizes an SVG string to prevent XSS / arbitrary script execution.
 * Removes <script> tags, inline javascript event handlers (e.g. onload, onclick),
 * javascript: hrefs, and dangerous elements like <object>, <embed>, <iframe>.
 */
export function sanitizeSvg(svgContent: string): string {
  if (!svgContent || typeof svgContent !== "string") return "";

  let cleaned = svgContent;

  // Multi-pass iterative sanitization loop to prevent incomplete multi-character evasion
  let previous: string;
  let iterations = 0;
  const MAX_ITERATIONS = 20;

  do {
    previous = cleaned;
    iterations++;

    // Remove XML declaration and doctype if present
    cleaned = cleaned.replace(/<\?xml[\s\S]*?\?>/gi, "");
    cleaned = cleaned.replace(/<!DOCTYPE[\s\S]*?>/gi, "");
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/gi, "");

    // Remove script tags and their content (handling whitespace in closing tags like </script >)
    cleaned = cleaned.replace(/<script\b[\s\S]*?<\/\s*script\s*>/gi, "");
    cleaned = cleaned.replace(/<\/?\s*script\b[^>]*>/gi, "");

    // Remove dangerous tags and their content
    cleaned = cleaned.replace(/<(object|embed|iframe|applet|link|meta|foreignObject|style|form|input|button|base|frame|frameset)\b[\s\S]*?<\/\s*\1\s*>/gi, "");
    cleaned = cleaned.replace(/<\/?\s*(object|embed|iframe|applet|link|meta|foreignObject|style|form|input|button|base|frame|frameset)\b[^>]*>/gi, "");

    // Remove inline event handlers: on*="..." or on*='...' or on*=...
    cleaned = cleaned.replace(/(?:[\s/])on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, " ");
    cleaned = cleaned.replace(/\bon[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

    // Remove href / xlink:href / src / formaction containing javascript:, vbscript:, or data:text/html
    cleaned = cleaned.replace(/\s+(?:xlink:)?href\s*=\s*(?:"\s*(?:javascript:[^"]*|vbscript:[^"]*|data:text\/html[^"]*)"|'\s*(?:javascript:[^']*|vbscript:[^']*|data:text\/html[^']*)|(?:javascript:[^\s>]*|vbscript:[^\s>]*|data:text\/html[^\s>]*))/gi, "");
    cleaned = cleaned.replace(/\s+src\s*=\s*(?:"\s*(?:javascript:[^"]*|vbscript:[^"]*|data:text\/html[^"]*)"|'\s*(?:javascript:[^']*|vbscript:[^']*|data:text\/html[^']*)|(?:javascript:[^\s>]*|vbscript:[^\s>]*|data:text\/html[^\s>]*))/gi, "");
    cleaned = cleaned.replace(/\s+(?:action|formaction)\s*=\s*(?:"\s*(?:javascript:[^"]*|vbscript:[^"]*|data:text\/html[^"]*)"|'\s*(?:javascript:[^']*|vbscript:[^']*|data:text\/html[^']*)|(?:javascript:[^\s>]*|vbscript:[^\s>]*|data:text\/html[^\s>]*))/gi, "");
  } while (cleaned !== previous && iterations < MAX_ITERATIONS);

  // If running in DOM environment (browser), apply DOMParser sanitization for full defense-in-depth
  if (typeof DOMParser !== "undefined" && typeof XMLSerializer !== "undefined") {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(cleaned, "image/svg+xml");
      if (!doc.querySelector("parsererror")) {
        const dangerousElements = doc.querySelectorAll("script, object, embed, iframe, applet, link, meta, foreignObject, style, form, input, button, base, frame, frameset");
        dangerousElements.forEach((el) => el.remove());

        const allElements = doc.querySelectorAll("*");
        allElements.forEach((el) => {
          const toRemove: string[] = [];
          for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i];
            const name = attr.name.toLowerCase();
            const val = attr.value.trim().toLowerCase();
            if (name.startsWith("on")) {
              toRemove.push(attr.name);
            } else if ((name === "href" || name === "xlink:href" || name === "src" || name === "action" || name === "formaction") &&
                       (val.startsWith("javascript:") || val.startsWith("data:text/html") || val.startsWith("vbscript:"))) {
              toRemove.push(attr.name);
            }
          }
          for (const attrName of toRemove) {
            el.removeAttribute(attrName);
          }
        });

        cleaned = new XMLSerializer().serializeToString(doc.documentElement || doc);
      }
    } catch {
      // Fallback to regex-cleaned result
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
  // Check for script tag remnants or dangerous elements
  if (/<script/i.test(trimmed) || /<iframe/i.test(trimmed) || /<object/i.test(trimmed) || /<embed/i.test(trimmed) || /\bon[a-z0-9_-]+/i.test(trimmed)) {
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
