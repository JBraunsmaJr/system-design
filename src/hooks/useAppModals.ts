import { useState, useCallback } from 'react';
import type { ToastType } from '../common/components/toast/Toast';

export interface ToastState {
  id?: number;
  message: string;
  description?: string;
  type?: ToastType;
}

export function useAppModals() {
  const [isDocumentManagerOpen, setIsDocumentManagerOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isLeaveGuardOpen, setIsLeaveGuardOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback(
    (message: string, type: ToastType = 'success', description?: string) => {
      setToast({ id: Date.now(), message, type, description });
    },
    [],
  );

  return {
    isDocumentManagerOpen,
    setIsDocumentManagerOpen,
    isLibraryOpen,
    setIsLibraryOpen,
    isLeaveGuardOpen,
    setIsLeaveGuardOpen,
    toast,
    setToast,
    showToast,
  };
}
