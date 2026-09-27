import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, FilePlus2 } from 'lucide-react';
import { useOutsideClick } from '../../common/hooks/useOutsideClick';
import { usePositionedDropdown } from '../../common/hooks/usePositionedDropdown';

interface FileMenuProps {
  /** Opens a new, empty document. The current one stays stored. */
  onNew: () => void;
  /** Opens the document manager (WS2-R3). */
  onOpenDocuments?: () => void;
  onLoadClick: () => void;
  onManageLibraries?: () => void;
  /** Whether a collaborative session is currently active. */
  isInSession: boolean;
}

const DROPDOWN_WIDTH = 150;

export function FileMenu({
  onNew,
  onOpenDocuments,
  onLoadClick,
  onManageLibraries,
  isInSession,
}: FileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { position: dropdownPos } = usePositionedDropdown({
    triggerRef,
    dropdownRef,
    isOpen,
  });

  useOutsideClick({
    refs: [triggerRef, dropdownRef],
    isOpen,
    onClose: () => setIsOpen(false),
  });

  return (
    <div className="export-menu">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (isOpen ? close() : open())}
        title="File"
      >
        <FilePlus2 size={14} />
        <span className="toolbar__label">File</span>
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
            {/*
              During a session the document on screen is the shared one. Open
              would replace it for everyone; New and Documents navigate this tab
              to another document, which ends the session.
            */}
            <button
              type="button"
              disabled={isInSession}
              title={
                isInSession
                  ? 'New is disabled during a collaborative session - opening another document would end it'
                  : undefined
              }
              onClick={() => {
                onNew();
                close();
              }}
            >
              New
            </button>
            {onOpenDocuments && (
              <button
                type="button"
                disabled={isInSession}
                title={
                  isInSession
                    ? 'Documents is disabled during a collaborative session - opening another document would end it'
                    : undefined
                }
                onClick={() => {
                  onOpenDocuments();
                  close();
                }}
              >
                Documents...
              </button>
            )}
            <button
              type="button"
              disabled={isInSession}
              title={
                isInSession
                  ? 'Open is disabled during a collaborative session - it would replace the diagram for everyone in it'
                  : undefined
              }
              onClick={() => {
                onLoadClick();
                close();
              }}
            >
              Open
            </button>
            {onManageLibraries && (
              <button
                type="button"
                onClick={() => {
                  onManageLibraries();
                  close();
                }}
              >
                Libraries...
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
