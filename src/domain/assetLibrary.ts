import { globalIconRegistry, sanitizeSvg, type IconDefinition } from "./iconRegistry";
import { globalShapeRegistry, type ShapeDefinition, DEFAULT_CONNECTION_POINTS } from "./shapeRegistry";

export interface LibraryMetadata {
  id: string;
  name: string;
  description?: string;
  version: number;
  author?: string;
  license?: string;
  attribution?: string;
  tags?: string[];
}

export interface AssetLibrary {
  format: "system-design-library";
  version: number;
  library: LibraryMetadata;
  icons: IconDefinition[];
  shapes: ShapeDefinition[];
  enabled?: boolean;
}

const LIBRARIES_STORAGE_KEY = "system-design-editor:custom-libraries";
const RECENT_ICONS_STORAGE_KEY = "system-design-editor:recent-icons";
const FAVORITE_ICONS_STORAGE_KEY = "system-design-editor:favorite-icons";

const MAX_ASSET_SIZE_BYTES = 512 * 1024; // 512 KB per asset definition
const MAX_RECENT_ICONS = 30;

export interface LibraryValidationResult {
  valid: boolean;
  library?: AssetLibrary;
  importedShapesCount: number;
  importedIconsCount: number;
  errors: string[];
}

export function validateAssetLibrary(raw: unknown): LibraryValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== "object") {
    return { valid: false, importedShapesCount: 0, importedIconsCount: 0, errors: ["Invalid JSON object format."] };
  }

  const data = raw as Partial<AssetLibrary>;

  if (data.format !== "system-design-library") {
    errors.push("Invalid library format identifier. Expected 'system-design-library'.");
  }

  if (!data.library || typeof data.library !== "object") {
    errors.push("Missing library metadata.");
    return { valid: false, importedShapesCount: 0, importedIconsCount: 0, errors };
  }

  const libMeta: LibraryMetadata = {
    id: typeof data.library.id === "string" && data.library.id.trim() ? data.library.id.trim() : `lib-${Date.now()}`,
    name: typeof data.library.name === "string" && data.library.name.trim() ? data.library.name.trim() : "Untitled Library",
    description: typeof data.library.description === "string" ? data.library.description : undefined,
    version: typeof data.library.version === "number" && !isNaN(data.library.version) ? data.library.version : 1,
    author: typeof data.library.author === "string" ? data.library.author : undefined,
    license: typeof data.library.license === "string" ? data.library.license : undefined,
    attribution: typeof data.library.attribution === "string" ? data.library.attribution : undefined,
    tags: Array.isArray(data.library.tags) ? data.library.tags.filter((t) => typeof t === "string") : [],
  };

  const validIcons: IconDefinition[] = [];
  if (Array.isArray(data.icons)) {
    for (const item of data.icons) {
      if (!item || typeof item !== "object") {
        errors.push("Skipped malformed icon entry.");
        continue;
      }

      if (!item.id || !item.name || !item.source) {
        errors.push(`Icon entry missing required fields (id, name, or source): ${JSON.stringify(item.id || item.name || "unknown")}`);
        continue;
      }

      const rawJson = JSON.stringify(item);
      const byteLength = new TextEncoder().encode(rawJson).length;
      if (byteLength > MAX_ASSET_SIZE_BYTES) {
        errors.push(`Icon "${item.name}" exceeds maximum allowed size of 512KB.`);
        continue;
      }

      let source = item.source;
      if (source.type === "svg") {
        const sanitized = sanitizeSvg(source.data);
        if (!sanitized) {
          errors.push(`Icon "${item.name}" contains unsafe or invalid SVG content.`);
          continue;
        }
        source = { type: "svg", data: sanitized };
      }

      validIcons.push({
        id: String(item.id).trim(),
        name: String(item.name).trim(),
        category: typeof item.category === "string" ? item.category : libMeta.name,
        tags: Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === "string") : [],
        version: typeof item.version === "number" ? item.version : 1,
        source,
        attribution: item.attribution && typeof item.attribution === "object" ? {
          author: typeof item.attribution.author === "string" ? item.attribution.author : undefined,
          license: typeof item.attribution.license === "string" ? item.attribution.license : undefined,
          source: typeof item.attribution.source === "string" ? item.attribution.source : undefined,
        } : undefined,
        libraryId: libMeta.id,
      });
    }
  }

  const validShapes: ShapeDefinition[] = [];
  if (Array.isArray(data.shapes)) {
    for (const item of data.shapes) {
      if (!item || typeof item !== "object") {
        errors.push("Skipped malformed shape entry.");
        continue;
      }

      if (!item.id || !item.name || !item.geometry) {
        errors.push(`Shape entry missing required fields (id, name, or geometry): ${JSON.stringify(item.id || item.name || "unknown")}`);
        continue;
      }

      const rawJson = JSON.stringify(item);
      const byteLength = new TextEncoder().encode(rawJson).length;
      if (byteLength > MAX_ASSET_SIZE_BYTES) {
        errors.push(`Shape "${item.name}" exceeds maximum allowed size of 512KB.`);
        continue;
      }

      const width = typeof item.defaults?.width === "number" && item.defaults.width > 0 ? item.defaults.width : 120;
      const height = typeof item.defaults?.height === "number" && item.defaults.height > 0 ? item.defaults.height : 100;

      validShapes.push({
        id: String(item.id).trim(),
        name: String(item.name).trim(),
        description: typeof item.description === "string" ? item.description : undefined,
        category: typeof item.category === "string" ? item.category : libMeta.name,
        tags: Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === "string") : [],
        version: typeof item.version === "number" ? item.version : 1,
        geometry: item.geometry,
        defaults: {
          width,
          height,
          style: item.defaults?.style,
          label: typeof item.defaults?.label === "string" ? item.defaults.label : undefined,
          color: typeof item.defaults?.color === "string" ? item.defaults.color : "#5B7CFA",
        },
        constraints: item.constraints,
        connectionPoints: Array.isArray(item.connectionPoints) && item.connectionPoints.length > 0
          ? item.connectionPoints
          : DEFAULT_CONNECTION_POINTS,
        properties: Array.isArray(item.properties) ? item.properties : undefined,
        iconId: typeof item.iconId === "string" ? item.iconId : undefined,
        libraryId: libMeta.id,
      });
    }
  }

  const library: AssetLibrary = {
    format: "system-design-library",
    version: typeof data.version === "number" ? data.version : 1,
    library: libMeta,
    icons: validIcons,
    shapes: validShapes,
    enabled: data.enabled !== false,
  };

  return {
    valid: errors.length === 0 || validIcons.length > 0 || validShapes.length > 0,
    library,
    importedShapesCount: validShapes.length,
    importedIconsCount: validIcons.length,
    errors,
  };
}

export class AssetLibraryManager {
  private libraries: Map<string, AssetLibrary> = new Map();
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.loadFromStorage();
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

  public loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(LIBRARIES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const res = validateAssetLibrary(item);
          if (res.library) {
            this.libraries.set(res.library.library.id, res.library);
            if (res.library.enabled !== false) {
              this.syncToRegistries(res.library);
            }
          }
        }
      }
    } catch {
      // Ignore storage load errors
    }
    this.notify();
  }

  public saveToStorage(): void {
    try {
      const libs = Array.from(this.libraries.values());
      localStorage.setItem(LIBRARIES_STORAGE_KEY, JSON.stringify(libs));
    } catch {
      // Ignore storage save errors
    }
  }

  private syncToRegistries(library: AssetLibrary): void {
    for (const icon of library.icons) {
      globalIconRegistry.registerIcon({ ...icon, libraryId: library.library.id });
    }
    for (const shape of library.shapes) {
      globalShapeRegistry.registerShape({ ...shape, libraryId: library.library.id });
    }
  }

  private removeFromRegistries(libraryId: string): void {
    globalIconRegistry.unregisterLibraryIcons(libraryId);
    globalShapeRegistry.unregisterLibraryShapes(libraryId);
  }

  public getLibraries(): AssetLibrary[] {
    return Array.from(this.libraries.values());
  }

  public getLibrary(id: string): AssetLibrary | undefined {
    return this.libraries.get(id);
  }

  public addOrUpdateLibrary(library: AssetLibrary): void {
    this.libraries.set(library.library.id, library);
    this.removeFromRegistries(library.library.id);
    if (library.enabled !== false) {
      this.syncToRegistries(library);
    }
    this.saveToStorage();
    this.notify();
  }

  public setLibraryEnabled(id: string, enabled: boolean): void {
    const lib = this.libraries.get(id);
    if (!lib) return;
    lib.enabled = enabled;
    if (enabled) {
      this.syncToRegistries(lib);
    } else {
      this.removeFromRegistries(id);
    }
    this.saveToStorage();
    this.notify();
  }

  public deleteLibrary(id: string): boolean {
    const lib = this.libraries.get(id);
    if (!lib) return false;
    this.removeFromRegistries(id);
    const deleted = this.libraries.delete(id);
    this.saveToStorage();
    this.notify();
    return deleted;
  }

  public importLibraryFromJson(jsonContent: string): LibraryValidationResult {
    try {
      const parsed = JSON.parse(jsonContent);
      const validation = validateAssetLibrary(parsed);
      if (validation.library && (validation.importedIconsCount > 0 || validation.importedShapesCount > 0)) {
        this.addOrUpdateLibrary(validation.library);
      }
      return validation;
    } catch (err) {
      return {
        valid: false,
        importedShapesCount: 0,
        importedIconsCount: 0,
        errors: [(err as Error).message || "Invalid JSON syntax."],
      };
    }
  }

  public exportLibrary(libraryId: string): void {
    const lib = this.libraries.get(libraryId);
    if (!lib) return;
    const blob = new Blob([JSON.stringify(lib, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const safeName = lib.library.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    anchor.download = `${safeName || "custom-library"}.library.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}

export const globalAssetLibraryManager = new AssetLibraryManager();

// Recent & Favorite Icons Management
export function getRecentIcons(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_ICONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function addRecentIcon(iconId: string): void {
  if (!iconId) return;
  try {
    const current = getRecentIcons().filter((id) => id !== iconId);
    current.unshift(iconId);
    if (current.length > MAX_RECENT_ICONS) current.length = MAX_RECENT_ICONS;
    localStorage.setItem(RECENT_ICONS_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage errors
  }
}

export function getFavoriteIcons(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITE_ICONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function toggleFavoriteIcon(iconId: string): boolean {
  if (!iconId) return false;
  try {
    const favs = new Set(getFavoriteIcons());
    let isNowFav = false;
    if (favs.has(iconId)) {
      favs.delete(iconId);
      isNowFav = false;
    } else {
      favs.add(iconId);
      isNowFav = true;
    }
    localStorage.setItem(FAVORITE_ICONS_STORAGE_KEY, JSON.stringify(Array.from(favs)));
    return isNowFav;
  } catch {
    return false;
  }
}
