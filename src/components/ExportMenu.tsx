import { useState } from "react";
import { ChevronDown, Download } from "lucide-react";

interface ExportMenuProps {
  onExportPng: () => void;
  onExportSvg: () => void;
  disabled?: boolean;
}

export function ExportMenu({ onExportPng, onExportSvg, disabled }: ExportMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="export-menu">
      <button type="button" disabled={disabled} onClick={() => setOpen((v) => !v)} title="Export">
        <Download size={14} />
        <span className="toolbar__label">Export</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="export-menu__dropdown">
          <button
            type="button"
            onClick={() => {
              onExportPng();
              setOpen(false);
            }}
          >
            Download PNG
          </button>
          <button
            type="button"
            onClick={() => {
              onExportSvg();
              setOpen(false);
            }}
          >
            Download SVG
          </button>
        </div>
      )}
    </div>
  );
}
