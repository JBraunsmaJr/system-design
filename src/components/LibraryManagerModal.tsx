import { useState, useRef, useEffect, type ChangeEvent } from "react";
import {
  X,
  Upload,
  Download,
  Plus,
  Trash2,
  Package,
} from "lucide-react";
import {
  globalAssetLibraryManager,
  type AssetLibrary,
  type LibraryValidationResult,
} from "../domain/assetLibrary";
import type { IconDefinition } from "../domain/iconRegistry";
import { type ShapeDefinition, DEFAULT_CONNECTION_POINTS } from "../domain/shapeRegistry";
import { IconRenderer } from "./IconRenderer";
import { SvgShapeRenderer } from "./nodes/SvgShapeRenderer";

interface LibraryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LibraryManagerModal({ isOpen, onClose }: LibraryManagerModalProps) {
  const [libraries, setLibraries] = useState<AssetLibrary[]>([]);
  const [selectedLibId, setSelectedLibId] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<LibraryValidationResult | null>(null);

  // New Library form state
  const [isCreatingLib, setIsCreatingLib] = useState(false);
  const [newLibName, setNewLibName] = useState("");
  const [newLibDesc, setNewLibDesc] = useState("");
  const [newLibAuthor, setNewLibAuthor] = useState("");
  const [newLibLicense, setNewLibLicense] = useState("");

  // New Icon form state
  const [isAddingIcon, setIsAddingIcon] = useState(false);
  const [newIconName, setNewIconName] = useState("");
  const [newIconCategory, setNewIconCategory] = useState("");
  const [newIconTags, setNewIconTags] = useState("");
  const [newIconSvg, setNewIconSvg] = useState('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>');
  const [newIconAuthor, setNewIconAuthor] = useState("");
  const [newIconLicense, setNewIconLicense] = useState("");

  // New Shape form state
  const [isAddingShape, setIsAddingShape] = useState(false);
  const [newShapeName, setNewShapeName] = useState("");
  const [newShapeCategory, setNewShapeCategory] = useState("");
  const [newShapeTags, setNewShapeTags] = useState("");
  const [newShapeGeomType, setNewShapeGeomType] = useState<string>("rounded-rectangle");
  const [newShapeSvgPath, setNewShapeSvgPath] = useState("M 10 10 L 90 10 L 90 90 L 10 90 Z");
  const [newShapeWidth, setNewShapeWidth] = useState(140);
  const [newShapeHeight, setNewShapeHeight] = useState(90);
  const [newShapeColor, setNewShapeColor] = useState("#5B7CFA");
  const [newShapeIconId, setNewShapeIconId] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshLibraries = () => {
    const libs = globalAssetLibraryManager.getLibraries();
    setLibraries(libs);
    if (!selectedLibId && libs.length > 0) {
      setSelectedLibId(libs[0].library.id);
    }
  };

  useEffect(() => {
    if (isOpen) {
      refreshLibraries();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedLib = libraries.find((l) => l.library.id === selectedLibId);

  const handleToggleLibrary = (id: string, currentEnabled?: boolean) => {
    globalAssetLibraryManager.setLibraryEnabled(id, !currentEnabled);
    refreshLibraries();
  };

  const handleDeleteLibrary = (id: string) => {
    if (confirm("Are you sure you want to delete this custom library?")) {
      globalAssetLibraryManager.deleteLibrary(id);
      setSelectedLibId(null);
      refreshLibraries();
    }
  };

  const handleImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const result = globalAssetLibraryManager.importLibraryFromJson(content);
        setValidationResult(result);
        refreshLibraries();
        if (result.library) {
          setSelectedLibId(result.library.library.id);
        }
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleCreateLibrary = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLibName.trim()) return;

    const newId = `custom-lib-${Date.now()}`;
    const newLib: AssetLibrary = {
      format: "system-design-library",
      version: 1,
      library: {
        id: newId,
        name: newLibName.trim(),
        description: newLibDesc.trim() || undefined,
        version: 1,
        author: newLibAuthor.trim() || undefined,
        license: newLibLicense.trim() || undefined,
      },
      icons: [],
      shapes: [],
      enabled: true,
    };

    globalAssetLibraryManager.addOrUpdateLibrary(newLib);
    setIsCreatingLib(false);
    setNewLibName("");
    setNewLibDesc("");
    setNewLibAuthor("");
    setNewLibLicense("");
    setSelectedLibId(newId);
    refreshLibraries();
  };

  const handleCreateIcon = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLib || !newIconName.trim()) return;

    const iconId = `${selectedLib.library.id}.${newIconName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const iconDef: IconDefinition = {
      id: iconId,
      name: newIconName.trim(),
      category: newIconCategory.trim() || selectedLib.library.name,
      tags: newIconTags.split(",").map((t) => t.trim()).filter(Boolean),
      version: 1,
      source: {
        type: "svg",
        data: newIconSvg,
      },
      attribution: (newIconAuthor || newIconLicense) ? {
        author: newIconAuthor.trim() || undefined,
        license: newIconLicense.trim() || undefined,
      } : undefined,
      libraryId: selectedLib.library.id,
    };

    const updatedLib: AssetLibrary = {
      ...selectedLib,
      icons: [...selectedLib.icons.filter((i) => i.id !== iconId), iconDef],
    };

    globalAssetLibraryManager.addOrUpdateLibrary(updatedLib);
    setIsAddingIcon(false);
    setNewIconName("");
    setNewIconCategory("");
    setNewIconTags("");
    setNewIconAuthor("");
    setNewIconLicense("");
    refreshLibraries();
  };

  const handleCreateShape = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLib || !newShapeName.trim()) return;

    const shapeId = `${selectedLib.library.id}.${newShapeName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

    let geom: ShapeDefinition["geometry"] = { type: "rounded-rectangle", radius: 8 };
    if (newShapeGeomType === "circle") geom = { type: "circle" };
    else if (newShapeGeomType === "rectangle") geom = { type: "rectangle" };
    else if (newShapeGeomType === "diamond") geom = { type: "diamond" };
    else if (newShapeGeomType === "cylinder") geom = { type: "cylinder" };
    else if (newShapeGeomType === "cloud") geom = { type: "cloud" };
    else if (newShapeGeomType === "actor") geom = { type: "actor" };
    else if (newShapeGeomType === "document") geom = { type: "document" };
    else if (newShapeGeomType === "hexagon") geom = { type: "hexagon" };
    else if (newShapeGeomType === "parallelogram") geom = { type: "parallelogram" };
    else if (newShapeGeomType === "path") geom = { type: "path", d: newShapeSvgPath };

    const shapeDef: ShapeDefinition = {
      id: shapeId,
      name: newShapeName.trim(),
      category: newShapeCategory.trim() || selectedLib.library.name,
      tags: newShapeTags.split(",").map((t) => t.trim()).filter(Boolean),
      version: 1,
      geometry: geom,
      defaults: {
        width: Number(newShapeWidth) || 140,
        height: Number(newShapeHeight) || 90,
        color: newShapeColor || "#5B7CFA",
        label: newShapeName.trim(),
      },
      connectionPoints: DEFAULT_CONNECTION_POINTS,
      iconId: newShapeIconId.trim() || undefined,
      libraryId: selectedLib.library.id,
    };

    const updatedLib: AssetLibrary = {
      ...selectedLib,
      shapes: [...selectedLib.shapes.filter((s) => s.id !== shapeId), shapeDef],
    };

    globalAssetLibraryManager.addOrUpdateLibrary(updatedLib);
    setIsAddingShape(false);
    setNewShapeName("");
    setNewShapeCategory("");
    setNewShapeTags("");
    setNewShapeIconId("");
    refreshLibraries();
  };

  return (
    <div className="modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        className="modal-content"
        style={{
          background: "var(--bg-panel, #1e222b)",
          color: "var(--text, #e7e9ee)",
          borderRadius: 8,
          width: 860,
          maxWidth: "95vw",
          height: 620,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          border: "1px solid var(--border, #2d3342)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border, #2d3342)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Package size={18} style={{ color: "var(--accent, #5B7CFA)" }} />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Shape & Icon Libraries</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Validation result banner */}
        {validationResult && (
          <div
            style={{
              padding: "10px 16px",
              background: validationResult.valid ? "rgba(15, 163, 107, 0.15)" : "rgba(240, 87, 140, 0.15)",
              borderBottom: "1px solid var(--border, #2d3342)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 13,
            }}
          >
            <div>
              <strong>{validationResult.valid ? "Import Successful" : "Import Failed"}</strong>:{" "}
              {validationResult.importedShapesCount} shape(s), {validationResult.importedIconsCount} icon(s) imported.
              {validationResult.errors.length > 0 && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  {validationResult.errors.join("; ")}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setValidationResult(null)}
              style={{ background: "transparent", border: "none", color: "var(--text)", cursor: "pointer", fontSize: 12 }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Main Body */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Left Sidebar: Library List */}
          <div
            style={{
              width: 260,
              borderRight: "1px solid var(--border, #2d3342)",
              display: "flex",
              flexDirection: "column",
              background: "rgba(0,0,0,0.1)",
            }}
          >
            <div style={{ padding: "10px 12px", display: "flex", gap: 6, borderBottom: "1px solid var(--border, #2d3342)" }}>
              <button
                type="button"
                className="btn-primary"
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  fontSize: 12,
                  padding: "6px 8px",
                  borderRadius: 4,
                  background: "var(--accent, #5B7CFA)",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                }}
                onClick={() => {
                  setIsCreatingLib(true);
                  setIsAddingIcon(false);
                  setIsAddingShape(false);
                }}
              >
                <Plus size={14} /> New Library
              </button>
              <button
                type="button"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "6px 10px",
                  fontSize: 12,
                  borderRadius: 4,
                  background: "var(--bg-field, #252a36)",
                  color: "var(--text)",
                  border: "1px solid var(--border, #2d3342)",
                  cursor: "pointer",
                }}
                title="Import Library (.json)"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={14} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                style={{ display: "none" }}
                onChange={handleImportFile}
              />
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "6px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", padding: "4px 6px" }}>
                Built-in Taxonomy
              </div>
              <div
                style={{
                  padding: "6px 8px",
                  borderRadius: 4,
                  fontSize: 13,
                  color: "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>Core System Design</span>
                <span style={{ fontSize: 11 }}>18 shapes / 1000+ icons</span>
              </div>

              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", padding: "8px 6px 4px 6px" }}>
                Custom Libraries ({libraries.length})
              </div>
              {libraries.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "6px 8px" }}>
                  No custom libraries installed. Click "New Library" or "Import" to add one.
                </div>
              ) : (
                libraries.map((lib) => {
                  const isSelected = lib.library.id === selectedLibId;
                  return (
                    <div
                      key={lib.library.id}
                      style={{
                        padding: "6px 8px",
                        borderRadius: 4,
                        fontSize: 13,
                        cursor: "pointer",
                        background: isSelected ? "var(--bg-active, #313848)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 2,
                      }}
                      onClick={() => {
                        setSelectedLibId(lib.library.id);
                        setIsCreatingLib(false);
                        setIsAddingIcon(false);
                        setIsAddingShape(false);
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                        <input
                          type="checkbox"
                          checked={lib.enabled !== false}
                          onChange={() => handleToggleLibrary(lib.library.id, lib.enabled)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {lib.library.name}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {lib.shapes.length}s / {lib.icons.length}i
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Content View */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", padding: 18 }}>
            {isCreatingLib ? (
              <form onSubmit={handleCreateLibrary} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <h4 style={{ margin: "0 0 8px 0" }}>Create New Custom Library</h4>
                <div>
                  <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "var(--text-muted)" }}>Library Name *</label>
                  <input
                    type="text"
                    required
                    style={{ width: "100%", padding: "6px 8px", background: "var(--bg-field)", border: "1px solid var(--border)", color: "#fff", borderRadius: 4 }}
                    value={newLibName}
                    onChange={(e) => setNewLibName(e.target.value)}
                    placeholder="e.g. Company Architecture"
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "var(--text-muted)" }}>Description</label>
                  <textarea
                    rows={2}
                    style={{ width: "100%", padding: "6px 8px", background: "var(--bg-field)", border: "1px solid var(--border)", color: "#fff", borderRadius: 4 }}
                    value={newLibDesc}
                    onChange={(e) => setNewLibDesc(e.target.value)}
                    placeholder="Describe the library contents..."
                  />
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "var(--text-muted)" }}>Author / Team</label>
                    <input
                      type="text"
                      style={{ width: "100%", padding: "6px 8px", background: "var(--bg-field)", border: "1px solid var(--border)", color: "#fff", borderRadius: 4 }}
                      value={newLibAuthor}
                      onChange={(e) => setNewLibAuthor(e.target.value)}
                      placeholder="e.g. Core Engineering"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "var(--text-muted)" }}>License</label>
                    <input
                      type="text"
                      style={{ width: "100%", padding: "6px 8px", background: "var(--bg-field)", border: "1px solid var(--border)", color: "#fff", borderRadius: 4 }}
                      value={newLibLicense}
                      onChange={(e) => setNewLibLicense(e.target.value)}
                      placeholder="e.g. MIT, Internal"
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button type="submit" style={{ padding: "6px 14px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
                    Create Library
                  </button>
                  <button type="button" onClick={() => setIsCreatingLib(false)} style={{ padding: "6px 14px", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 4, cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : isAddingIcon ? (
              <form onSubmit={handleCreateIcon} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <h4 style={{ margin: "0 0 8px 0" }}>Add Custom SVG Icon</h4>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "var(--text-muted)" }}>Icon Name *</label>
                    <input
                      type="text"
                      required
                      style={{ width: "100%", padding: "6px 8px", background: "var(--bg-field)", border: "1px solid var(--border)", color: "#fff", borderRadius: 4 }}
                      value={newIconName}
                      onChange={(e) => setNewIconName(e.target.value)}
                      placeholder="e.g. Auth Gateway"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "var(--text-muted)" }}>Category</label>
                    <input
                      type="text"
                      style={{ width: "100%", padding: "6px 8px", background: "var(--bg-field)", border: "1px solid var(--border)", color: "#fff", borderRadius: 4 }}
                      value={newIconCategory}
                      onChange={(e) => setNewIconCategory(e.target.value)}
                      placeholder="e.g. Security"
                    />
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "var(--text-muted)" }}>Search Tags (comma separated)</label>
                  <input
                    type="text"
                    style={{ width: "100%", padding: "6px 8px", background: "var(--bg-field)", border: "1px solid var(--border)", color: "#fff", borderRadius: 4 }}
                    value={newIconTags}
                    onChange={(e) => setNewIconTags(e.target.value)}
                    placeholder="e.g. auth, security, lock, login"
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "var(--text-muted)" }}>SVG Code *</label>
                  <textarea
                    rows={4}
                    required
                    style={{ width: "100%", padding: "6px 8px", background: "var(--bg-field)", border: "1px solid var(--border)", color: "#fff", borderRadius: 4, fontFamily: "monospace", fontSize: 12 }}
                    value={newIconSvg}
                    onChange={(e) => setNewIconSvg(e.target.value)}
                  />
                </div>
                {/* Preview */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: "var(--bg-field)", borderRadius: 4 }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Preview:</span>
                  <div style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center" }} dangerouslySetInnerHTML={{ __html: newIconSvg }} />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button type="submit" style={{ padding: "6px 14px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
                    Save Icon
                  </button>
                  <button type="button" onClick={() => setIsAddingIcon(false)} style={{ padding: "6px 14px", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 4, cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : isAddingShape ? (
              <form onSubmit={handleCreateShape} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <h4 style={{ margin: "0 0 8px 0" }}>Add Custom Shape</h4>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "var(--text-muted)" }}>Shape Name *</label>
                    <input
                      type="text"
                      required
                      style={{ width: "100%", padding: "6px 8px", background: "var(--bg-field)", border: "1px solid var(--border)", color: "#fff", borderRadius: 4 }}
                      value={newShapeName}
                      onChange={(e) => setNewShapeName(e.target.value)}
                      placeholder="e.g. Edge Node"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "var(--text-muted)" }}>Category</label>
                    <input
                      type="text"
                      style={{ width: "100%", padding: "6px 8px", background: "var(--bg-field)", border: "1px solid var(--border)", color: "#fff", borderRadius: 4 }}
                      value={newShapeCategory}
                      onChange={(e) => setNewShapeCategory(e.target.value)}
                      placeholder="e.g. Infrastructure"
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "var(--text-muted)" }}>Geometry Type</label>
                    <select
                      style={{ width: "100%", padding: "6px 8px", background: "var(--bg-field)", border: "1px solid var(--border)", color: "#fff", borderRadius: 4 }}
                      value={newShapeGeomType}
                      onChange={(e) => setNewShapeGeomType(e.target.value)}
                    >
                      <option value="rounded-rectangle">Rounded Rectangle</option>
                      <option value="rectangle">Rectangle</option>
                      <option value="circle">Circle / Ellipse</option>
                      <option value="cylinder">Cylinder (Database)</option>
                      <option value="diamond">Diamond (Decision)</option>
                      <option value="hexagon">Hexagon</option>
                      <option value="parallelogram">Parallelogram</option>
                      <option value="document">Document</option>
                      <option value="cloud">Cloud</option>
                      <option value="actor">Actor (User)</option>
                      <option value="path">Custom SVG Path</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "var(--text-muted)" }}>Shape Color</label>
                    <input
                      type="color"
                      style={{ width: "100%", height: 34, padding: "2px 4px", background: "var(--bg-field)", border: "1px solid var(--border)", borderRadius: 4 }}
                      value={newShapeColor}
                      onChange={(e) => setNewShapeColor(e.target.value)}
                    />
                  </div>
                </div>
                {newShapeGeomType === "path" && (
                  <div>
                    <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "var(--text-muted)" }}>SVG Path Data (d attribute)</label>
                    <input
                      type="text"
                      style={{ width: "100%", padding: "6px 8px", background: "var(--bg-field)", border: "1px solid var(--border)", color: "#fff", borderRadius: 4, fontFamily: "monospace" }}
                      value={newShapeSvgPath}
                      onChange={(e) => setNewShapeSvgPath(e.target.value)}
                    />
                  </div>
                )}
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "var(--text-muted)" }}>Default Width</label>
                    <input
                      type="number"
                      style={{ width: "100%", padding: "6px 8px", background: "var(--bg-field)", border: "1px solid var(--border)", color: "#fff", borderRadius: 4 }}
                      value={newShapeWidth}
                      onChange={(e) => setNewShapeWidth(Number(e.target.value))}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "var(--text-muted)" }}>Default Height</label>
                    <input
                      type="number"
                      style={{ width: "100%", padding: "6px 8px", background: "var(--bg-field)", border: "1px solid var(--border)", color: "#fff", borderRadius: 4 }}
                      value={newShapeHeight}
                      onChange={(e) => setNewShapeHeight(Number(e.target.value))}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: "var(--text-muted)" }}>Icon ID (optional)</label>
                    <input
                      type="text"
                      style={{ width: "100%", padding: "6px 8px", background: "var(--bg-field)", border: "1px solid var(--border)", color: "#fff", borderRadius: 4 }}
                      value={newShapeIconId}
                      onChange={(e) => setNewShapeIconId(e.target.value)}
                      placeholder="e.g. Server"
                    />
                  </div>
                </div>
                {/* Live Preview */}
                <div style={{ padding: "12px", background: "var(--bg-field)", borderRadius: 4, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Shape Preview:</span>
                  <div style={{ position: "relative", width: newShapeWidth, height: newShapeHeight }}>
                    <SvgShapeRenderer
                      geometry={
                        newShapeGeomType === "circle" ? { type: "circle" }
                        : newShapeGeomType === "rectangle" ? { type: "rectangle" }
                        : newShapeGeomType === "diamond" ? { type: "diamond" }
                        : newShapeGeomType === "cylinder" ? { type: "cylinder" }
                        : newShapeGeomType === "cloud" ? { type: "cloud" }
                        : newShapeGeomType === "actor" ? { type: "actor" }
                        : newShapeGeomType === "document" ? { type: "document" }
                        : newShapeGeomType === "hexagon" ? { type: "hexagon" }
                        : newShapeGeomType === "parallelogram" ? { type: "parallelogram" }
                        : newShapeGeomType === "path" ? { type: "path", d: newShapeSvgPath }
                        : { type: "rounded-rectangle", radius: 8 }
                      }
                      width={newShapeWidth}
                      height={newShapeHeight}
                      color={newShapeColor}
                      iconId={newShapeIconId || undefined}
                    />
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--text)" }}>
                      {newShapeName || "Preview"}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button type="submit" style={{ padding: "6px 14px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
                    Save Shape
                  </button>
                  <button type="button" onClick={() => setIsAddingShape(false)} style={{ padding: "6px 14px", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 4, cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : selectedLib ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Library details header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
                  <div>
                    <h3 style={{ margin: "0 0 4px 0", fontSize: 18 }}>{selectedLib.library.name}</h3>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {selectedLib.library.description || "No description provided."}
                    </div>
                    {(selectedLib.library.author || selectedLib.library.license) && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                        {selectedLib.library.author && <span>Author: {selectedLib.library.author} • </span>}
                        {selectedLib.library.license && <span>License: {selectedLib.library.license}</span>}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", fontSize: 12, background: "var(--bg-field)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}
                      onClick={() => globalAssetLibraryManager.exportLibrary(selectedLib.library.id)}
                      title="Export Library"
                    >
                      <Download size={13} /> Export
                    </button>
                    <button
                      type="button"
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", fontSize: 12, background: "rgba(240, 87, 140, 0.2)", color: "#f0578c", border: "1px solid rgba(240, 87, 140, 0.4)", borderRadius: 4, cursor: "pointer" }}
                      onClick={() => handleDeleteLibrary(selectedLib.library.id)}
                      title="Delete Library"
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </div>

                {/* Library Shapes Section */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Shapes ({selectedLib.shapes.length})</span>
                    <button
                      type="button"
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", fontSize: 11, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                      onClick={() => setIsAddingShape(true)}
                    >
                      <Plus size={12} /> Add Shape
                    </button>
                  </div>
                  {selectedLib.shapes.length === 0 ? (
                    <div style={{ padding: 12, background: "rgba(0,0,0,0.1)", borderRadius: 4, fontSize: 12, color: "var(--text-muted)" }}>
                      No custom shapes in this library yet. Click "Add Shape" to create one.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
                      {selectedLib.shapes.map((s) => (
                        <div
                          key={s.id}
                          style={{
                            padding: 8,
                            background: "var(--bg-field)",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <div style={{ width: 60, height: 40, position: "relative" }}>
                            <SvgShapeRenderer
                              geometry={s.geometry}
                              width={60}
                              height={40}
                              color={s.defaults.color || "#5B7CFA"}
                              iconId={s.iconId}
                            />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 500, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", width: "100%", whiteSpace: "nowrap" }}>
                            {s.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Library Icons Section */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Icons ({selectedLib.icons.length})</span>
                    <button
                      type="button"
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", fontSize: 11, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                      onClick={() => setIsAddingIcon(true)}
                    >
                      <Plus size={12} /> Add Icon
                    </button>
                  </div>
                  {selectedLib.icons.length === 0 ? (
                    <div style={{ padding: 12, background: "rgba(0,0,0,0.1)", borderRadius: 4, fontSize: 12, color: "var(--text-muted)" }}>
                      No custom icons in this library yet. Click "Add Icon" to create one.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 6 }}>
                      {selectedLib.icons.map((icon) => (
                        <div
                          key={icon.id}
                          style={{
                            padding: 6,
                            background: "var(--bg-field)",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 4,
                          }}
                          title={icon.name}
                        >
                          <IconRenderer iconDefinition={icon} size={22} />
                          <span style={{ fontSize: 10, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", width: "100%", whiteSpace: "nowrap" }}>
                            {icon.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)" }}>
                <Package size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
                <p>Select a library from the left sidebar or create a new one.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
