import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Download } from 'lucide-react';
import { useOutsideClick } from '../../common/hooks/useOutsideClick';
import { usePositionedDropdown } from '../../common/hooks/usePositionedDropdown';

interface ExportMenuProps {
  onExportPng: () => void;
  onExportSvg: () => void;
  onExportSrdMarkdown?: () => void;
  onExportSrdPrint?: () => void;
  disabled?: boolean;
}

const DROPDOWN_WIDTH = 190;

export function ExportMenu({
  onExportPng,
  onExportSvg,
  onExportSrdMarkdown,
  onExportSrdPrint,
  disabled,
}: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { position: dropdownPos } = usePositionedDropdown({
    triggerRef,
    dropdownRef,
    isOpen,
  });

  const close = () => {
    setIsOpen(false);
  };

  useOutsideClick({
    refs: [triggerRef, dropdownRef],
    isOpen,
    onClose: close,
  });

  return (
    <div className="export-menu">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        title="Export"
      >
        <Download size={14} />
        <span className="toolbar__label">Export</span>
        <ChevronDown size={12} />
      </button>
      {isOpen &&
        dropdownPos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="export-menu__dropdown"
            style={{
              position: 'fixed',
              top: dropdownPos.top,
              left: dropdownPos.left,
              minWidth: DROPDOWN_WIDTH,
            }}
          >
            <button
              type="button"
              onClick={() => {
                onExportPng();
                close();
              }}
            >
              Download PNG
            </button>
            <button
              type="button"
              onClick={() => {
                onExportSvg();
                close();
              }}
            >
              Download SVG
            </button>
            {onExportSrdMarkdown && (
              <button
                type="button"
                onClick={() => {
                  onExportSrdMarkdown();
                  close();
                }}
              >
                Export SRD (.md)
              </button>
            )}
            {onExportSrdPrint && (
              <button
                type="button"
                onClick={() => {
                  onExportSrdPrint();
                  close();
                }}
              >
                Export SRD (PDF / Print)
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
