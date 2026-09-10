import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Star, Clock, Sparkles, Ban } from "lucide-react";
import { globalIconRegistry } from "../domain/iconRegistry";
import { IconRenderer } from "./IconRenderer";
import { computeFlippedPosition } from "../domain/popoverPosition";
import {
  addRecentIcon,
  getFavoriteIcons,
  getRecentIcons,
  toggleFavoriteIcon,
} from "../domain/assetLibrary";

const RESULT_LIMIT = 80;
const DROPDOWN_WIDTH = 340;

interface IconPickerProps {
  /** Current override, if any - undefined means "use defaultValue". */
  value: string | undefined;
  /** The node type's own default icon, shown when there's no override. */
  defaultValue?: string;
  onChange: (icon: string | undefined) => void;
}

export function IconPicker({ value, defaultValue, onChange }: IconPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"all" | "recent" | "favorites">("all");
  const [, setVersion] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Subscribe to registry changes
  useEffect(() => {
    return globalIconRegistry.subscribe(() => {
      setVersion((v) => v + 1);
    });
  }, []);

  const recentIconIds = useMemo(() => getRecentIcons(), [isOpen]);
  const favoriteIconIds = useMemo(() => new Set(getFavoriteIcons()), [isOpen]);

  const categories = useMemo(() => {
    return ["all", ...globalIconRegistry.getCategories()];
  }, []);

  const results = useMemo(() => {
    if (activeTab === "recent") {
      const icons = recentIconIds
        .map((id) => globalIconRegistry.getIcon(id) || {
          id,
          name: id,
          version: 1,
          source: { type: "builtin" as const, key: id },
        })
        .filter(Boolean);

      if (!query.trim()) return icons.slice(0, RESULT_LIMIT);
      const q = query.trim().toLowerCase();
      return icons.filter((i) => i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)).slice(0, RESULT_LIMIT);
    }

    if (activeTab === "favorites") {
      const favs = Array.from(favoriteIconIds)
        .map((id) => globalIconRegistry.getIcon(id) || {
          id,
          name: id,
          version: 1,
          source: { type: "builtin" as const, key: id },
        })
        .filter(Boolean);

      if (!query.trim()) return favs.slice(0, RESULT_LIMIT);
      const q = query.trim().toLowerCase();
      return favs.filter((i) => i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)).slice(0, RESULT_LIMIT);
    }

    const filtered = globalIconRegistry.searchIcons(query, selectedCategory === "all" ? undefined : selectedCategory);
    return filtered.slice(0, RESULT_LIMIT);
  }, [query, selectedCategory, activeTab, recentIconIds, favoriteIconIds]);

  const resolved = value !== undefined ? value : defaultValue;
  const isNone = !resolved || resolved === "none";
  const displayLabel = isNone ? "None" : (globalIconRegistry.getIcon(resolved)?.name || resolved);

  const open = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const pos = computeFlippedPosition(
      rect,
      { width: DROPDOWN_WIDTH, height: 420 },
      { width: window.innerWidth, height: window.innerHeight }
    );
    setDropdownPos(pos);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setQuery("");
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown) return;
    const triggerRect = trigger.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();
    const next = computeFlippedPosition(
      triggerRect,
      { width: dropdownRect.width, height: dropdownRect.height },
      { width: window.innerWidth, height: window.innerHeight }
    );
    setDropdownPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
  }, [isOpen, query, selectedCategory, activeTab, results.length]);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown) return;
    const triggerRect = trigger.getBoundingClientRect();
    const dropdownRect = dropdown.getBoundingClientRect();
    setDropdownPos(
      computeFlippedPosition(
        triggerRect,
        { width: dropdownRect.width, height: dropdownRect.height },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      close();
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [isOpen, reposition]);

  const handleSelectIcon = (iconId: string) => {
    addRecentIcon(iconId);
    onChange(iconId);
    close();
  };

  const handleToggleFavorite = (e: React.MouseEvent, iconId: string) => {
    e.stopPropagation();
    toggleFavoriteIcon(iconId);
    setVersion((v) => v + 1);
  };

  return (
    <label className="inspector__field">
      <span>Icon</span>
      <div className="icon-picker">
        <div className="icon-picker__row">
          <button
            ref={triggerRef}
            type="button"
            className="icon-picker__trigger"
            onClick={() => (isOpen ? close() : open())}
            aria-expanded={isOpen}
          >
            {isNone ? (
              <Ban size={15} style={{ opacity: 0.6 }} />
            ) : (
              <IconRenderer icon={resolved} size={15} />
            )}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {displayLabel}
            </span>
          </button>
          {value !== undefined && (
            <button
              type="button"
              className="color-field__reset"
              onClick={() => {
                onChange(undefined);
                close();
              }}
            >
              Reset
            </button>
          )}
        </div>

        {isOpen &&
          dropdownPos &&
          createPortal(
            <div
              ref={dropdownRef}
              className="icon-picker__panel"
              style={{
                position: "fixed",
                top: dropdownPos.top,
                left: dropdownPos.left,
                width: DROPDOWN_WIDTH,
                maxHeight: 420,
                display: "flex",
                flexDirection: "column",
                zIndex: 250,
              }}
            >
              <div style={{ padding: "8px 8px 4px 8px" }}>
                <input
                  className="icon-picker__search"
                  type="text"
                  placeholder="Search icons (name, tags, category)..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                />
              </div>

              <div
                className="icon-picker__tabs"
                style={{
                  display: "flex",
                  gap: 4,
                  padding: "0 8px 6px 8px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <button
                  type="button"
                  className={`icon-picker__tab-btn ${activeTab === "all" ? "is-active" : ""}`}
                  style={{
                    fontSize: 12,
                    padding: "3px 8px",
                    borderRadius: 4,
                    background: activeTab === "all" ? "var(--bg-active)" : "transparent",
                    color: activeTab === "all" ? "var(--accent)" : "var(--text-muted)",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                  onClick={() => setActiveTab("all")}
                >
                  <Sparkles size={12} /> All
                </button>
                <button
                  type="button"
                  className={`icon-picker__tab-btn ${activeTab === "recent" ? "is-active" : ""}`}
                  style={{
                    fontSize: 12,
                    padding: "3px 8px",
                    borderRadius: 4,
                    background: activeTab === "recent" ? "var(--bg-active)" : "transparent",
                    color: activeTab === "recent" ? "var(--accent)" : "var(--text-muted)",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                  onClick={() => setActiveTab("recent")}
                >
                  <Clock size={12} /> Recent
                </button>
                <button
                  type="button"
                  className={`icon-picker__tab-btn ${activeTab === "favorites" ? "is-active" : ""}`}
                  style={{
                    fontSize: 12,
                    padding: "3px 8px",
                    borderRadius: 4,
                    background: activeTab === "favorites" ? "var(--bg-active)" : "transparent",
                    color: activeTab === "favorites" ? "var(--accent)" : "var(--text-muted)",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                  onClick={() => setActiveTab("favorites")}
                >
                  <Star size={12} /> Favorites
                </button>
              </div>

              <div style={{ padding: "6px 8px 2px 8px" }}>
                <button
                  type="button"
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 8px",
                    borderRadius: 4,
                    background: isNone ? "var(--bg-active)" : "var(--bg-field)",
                    border: isNone ? "1px solid var(--accent)" : "1px solid var(--border)",
                    color: isNone ? "var(--accent)" : "var(--text-muted)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    onChange(defaultValue ? "none" : undefined);
                    close();
                  }}
                >
                  <Ban size={13} />
                  <span>No icon</span>
                </button>
              </div>

              {activeTab === "all" && categories.length > 1 && (
                <div style={{ padding: "6px 8px", overflowX: "auto", display: "flex", gap: 4, whiteSpace: "nowrap" }}>
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      style={{
                        fontSize: 11,
                        padding: "2px 6px",
                        borderRadius: 12,
                        background: selectedCategory === cat ? "var(--accent)" : "var(--bg-field)",
                        color: selectedCategory === cat ? "#fff" : "var(--text-muted)",
                        border: "1px solid var(--border)",
                        cursor: "pointer",
                      }}
                      onClick={() => setSelectedCategory(cat)}
                    >
                      {cat === "all" ? "All Categories" : cat}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px" }}>
                {results.length > 0 ? (
                  <div
                    className="icon-picker__grid"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(36px, 1fr))",
                      gap: 4,
                    }}
                  >
                    {results.map((item) => {
                      const isFav = favoriteIconIds.has(item.id);
                      const tooltip = [
                        item.name,
                        item.category ? `Category: ${item.category}` : null,
                        item.attribution?.author ? `Author: ${item.attribution.author}` : null,
                        item.attribution?.license ? `License: ${item.attribution.license}` : null,
                      ]
                        .filter(Boolean)
                        .join("\n");

                      return (
                        <div
                          key={item.id}
                          style={{ position: "relative" }}
                          className="icon-picker__item-wrapper"
                        >
                          <button
                            type="button"
                            className={`icon-picker__item${item.id === resolved ? " is-selected" : ""}`}
                            title={tooltip}
                            style={{
                              width: "100%",
                              height: 36,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: 4,
                              border: item.id === resolved ? "1px solid var(--accent)" : "1px solid transparent",
                              background: item.id === resolved ? "var(--bg-active)" : "var(--bg-field)",
                              cursor: "pointer",
                            }}
                            onClick={() => handleSelectIcon(item.id)}
                          >
                            <IconRenderer iconDefinition={item} icon={item.id} size={18} />
                          </button>
                          <button
                            type="button"
                            style={{
                              position: "absolute",
                              top: 2,
                              right: 2,
                              padding: 0,
                              margin: 0,
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                              color: isFav ? "#FFD700" : "rgba(255,255,255,0.2)",
                              opacity: isFav ? 1 : 0.4,
                            }}
                            title={isFav ? "Remove from Favorites" : "Add to Favorites"}
                            onClick={(e) => handleToggleFavorite(e, item.id)}
                          >
                            <Star size={10} fill={isFav ? "#FFD700" : "none"} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="icon-picker__empty" style={{ padding: 16, textAlign: "center", color: "var(--text-muted)" }}>
                    No icons found.
                  </p>
                )}
              </div>

              <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--text-muted)", borderTop: "1px solid var(--border)", textAlign: "center" }}>
                {results.length} icon(s) shown
              </div>
            </div>,
            document.body
          )}
      </div>
    </label>
  );
}
