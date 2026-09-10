import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  hasDocumentation,
  computeDocumentationPopupPosition,
  type DiagramDocumentation,
} from "../../domain/diagramDocumentation";
import { DocumentationRenderer } from "./DocumentationRenderer";

export interface DocumentationPopupProps {
  documentation: DiagramDocumentation;
  title?: string;
  subtitle?: string;
  open: boolean;
  anchor?: { x: number; y: number } | null;
  onClose?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  className?: string;
}

export function DocumentationPopup({
  documentation,
  title,
  subtitle,
  open,
  anchor,
  onClose,
  onMouseEnter,
  onMouseLeave,
  className = "",
}: DocumentationPopupProps) {
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Requirement FR-003 & Acceptance criteria: Elements without meaningful doc do not display
  const isMeaningful = hasDocumentation(documentation);
  const shouldShow = open && isMeaningful;

  // Keyboard accessibility (FR-012, 6.2): Escape dismisses the popup
  useEffect(() => {
    if (!shouldShow) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [shouldShow, onClose]);

  // Compute position dynamically when anchor, documentation, or size changes (FR-009)
  useLayoutEffect(() => {
    if (!shouldShow || !anchor) {
      setPos(null);
      return;
    }

    if (!popupRef.current) {
      setPos({ top: anchor.y + 12, left: anchor.x + 12 });
      return;
    }

    const rect = popupRef.current.getBoundingClientRect();
    const viewport = {
      width: window.innerWidth || document.documentElement.clientWidth || 1920,
      height: window.innerHeight || document.documentElement.clientHeight || 1080,
    };

    const nextPos = computeDocumentationPopupPosition(
      anchor,
      { width: rect.width || 280, height: rect.height || 180 },
      viewport,
      12
    );

    setPos(nextPos);
  }, [shouldShow, anchor?.x, anchor?.y, documentation, title, subtitle]);

  if (!shouldShow) {
    return null;
  }

  const defaultTop = anchor ? anchor.y + 12 : 0;
  const defaultLeft = anchor ? anchor.x + 12 : 0;

  const content = (
    <div
      ref={popupRef}
      role="tooltip"
      aria-label={title ? `${title} documentation` : "Element documentation"}
      className={`doc-popup nodrag ${className}`.trim()}
      style={{
        position: "fixed",
        top: pos ? pos.top : defaultTop,
        left: pos ? pos.left : defaultLeft,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={(e) => {
        // Prevent canvas drag or selection when clicking inside popup
        e.stopPropagation();
      }}
    >
      <DocumentationRenderer
        documentation={documentation}
        title={title}
        subtitle={subtitle}
      />
    </div>
  );

  // In test / SSR environments where document.body might not be used with portals, render directly
  if (typeof document === "undefined" || !document.body) {
    return content;
  }

  return createPortal(content, document.body);
}
