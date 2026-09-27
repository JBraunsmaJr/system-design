import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

export interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  width?: number | string;
  maxWidth?: number | string;
  role?: 'dialog' | 'alertdialog';
  ariaLabel?: string;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
  padding?: number | string;
}

/**
 * Reusable zero-dependency Modal dialog wrapper.
 * Handles backdrop overlay, Escape key listener, and accessibility attributes.
 */
export function BaseModal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  className = '',
  width = 520,
  maxWidth = '92vw',
  role = 'dialog',
  ariaLabel,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  style,
  bodyStyle,
  padding,
}: BaseModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEscape, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (closeOnBackdropClick && e.target === e.currentTarget) {
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        ref={contentRef}
        className={`modal-content ${className}`.trim()}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        style={{
          background: 'var(--bg-panel, #1e222b)',
          color: 'var(--text, #e7e9ee)',
          borderRadius: 8,
          width,
          maxWidth,
          padding: padding !== undefined ? padding : '18px 20px',
          border: '1px solid var(--border, #2d3342)',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          boxSizing: 'border-box',
          ...style,
        }}
      >
        {title && <div style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 600 }}>{title}</div>}
        <div style={{ flex: 1, overflowY: 'auto', ...bodyStyle }}>{children}</div>
        {footer && (
          <div
            style={{
              marginTop: 16,
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
