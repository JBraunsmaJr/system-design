import { createContext, useContext } from 'react';
import type { SrdPdfSlots, SrdPdfSlotsByPlacement, SrdPlacement } from './types';

export interface SrdPdfTemplateContextValue {
  slotsFor: SrdPdfSlotsByPlacement;
  placement: SrdPlacement;
}

export const SrdPdfTemplateContext = createContext<SrdPdfTemplateContextValue | null>(null);

/** The current template's slots, for where this content is placed. */
export function useSrdPdfSlots(): SrdPdfSlots {
  const context = useContext(SrdPdfTemplateContext);
  if (!context) throw new Error('SRD PDF content must be rendered inside a template');
  return context.slotsFor(context.placement);
}
