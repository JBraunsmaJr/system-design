import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Info, AlertTriangle, AlertCircle, X } from "lucide-react";

export type ToastType = "success" | "info" | "warning" | "error";

export interface ToastProps {
  message: string;
  description?: string;
  type?: ToastType;
  duration?: number;
  onClose?: () => void;
  action?: {
    label: string;
    onClick: () => void;
  };
  icon?: ReactNode;
}

export function Toast({
  message,
  description,
  type = "success",
  duration = 3500,
  onClose,
  action,
  icon,
}: ToastProps) {
  useEffect(() => {
    if (!duration || duration <= 0 || !onClose) return;
    const timer = setTimeout(() => {
      onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const defaultIcon =
    type === "success" ? (
      <Check size={16} />
    ) : type === "error" ? (
      <AlertCircle size={16} />
    ) : type === "warning" ? (
      <AlertTriangle size={16} />
    ) : (
      <Info size={16} />
    );

  const content = (
    <div
      className={`app-toast app-toast--${type}`}
      role="status"
      aria-live="polite"
    >
      <span className="app-toast__icon" aria-hidden="true">
        {icon || defaultIcon}
      </span>
      <div className="app-toast__body">
        <div className="app-toast__message">{message}</div>
        {description && (
          <div className="app-toast__description">{description}</div>
        )}
      </div>
      {action && (
        <button
          type="button"
          className="app-toast__action-btn"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
      {onClose && (
        <button
          type="button"
          className="app-toast__close-btn"
          onClick={onClose}
          aria-label="Close notification"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );

  if (typeof document === "undefined" || !document.body) {
    return content;
  }

  return createPortal(
    <div className="app-toast-viewport">{content}</div>,
    document.body
  );
}
