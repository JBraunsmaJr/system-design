import { createContext, useContext } from 'react';
import type {
  SrdPdfSlots,
  SrdPdfSlotsByPlacement,
  SrdPdfTemplateFeatures,
  SrdPlacement,
} from './types';

export interface SrdPdfTemplateContextValue {
  slotsFor: SrdPdfSlotsByPlacement;
  placement: SrdPlacement;
  features: SrdPdfTemplateFeatures;
}

export const SrdPdfTemplateContext = createContext<SrdPdfTemplateContextValue | null>(null);

/** The current template's structural variations (see SrdPdfTemplateFeatures). */
export function useSrdPdfFeatures(): SrdPdfTemplateFeatures {
  const context = useContext(SrdPdfTemplateContext);
  if (!context) throw new Error('SRD PDF content must be rendered inside a template');
  return context.features;
}

/** The current template's slots, for where this content is placed. */
export function useSrdPdfSlots(): SrdPdfSlots {
  const context = useContext(SrdPdfTemplateContext);
  if (!context) throw new Error('SRD PDF content must be rendered inside a template');
  return context.slotsFor(context.placement);
}
