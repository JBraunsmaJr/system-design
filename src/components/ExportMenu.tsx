import { useState } from "react";

interface ExportMenuProps {
  onExportPng: () => void;
  onExportSvg: () => void;
  disabled?: boolean;
}

export function ExportMenu({ onExportPng, onExportSvg, disabled }: ExportMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="export-menu">
      <button type="button" disabled={disabled} onClick={() => setOpen((v) => !v)}>
        Export ▾
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
