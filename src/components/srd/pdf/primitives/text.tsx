import { useContext, type ReactNode } from 'react';
import { Text, View } from '@react-pdf/renderer';
import { SrdPdfTemplateContext, useSrdPdfSlots } from '../template/context';
import type { PillVariant, SrdPlacement } from '../template/types';

/** Room a heading keeps for what follows it, so it never ends a page. */
export const HEADING_KEEP_WITH_NEXT = 60;

export function SubHeading({ children }: { children: ReactNode }) {
  const slots = useSrdPdfSlots();
  return (
    <Text style={slots.subHeading} minPresenceAhead={HEADING_KEEP_WITH_NEXT}>
      {children}
    </Text>
  );
}

/** What a section shows when it has nothing to list. */
export function EmptyNote({ children }: { children: ReactNode }) {
  const slots = useSrdPdfSlots();
  return <Text style={slots.emptyNote}>{children}</Text>;
}

export function Strong({ children }: { children: ReactNode }) {
  return <Text style={useSrdPdfSlots().strong}>{children}</Text>;
}

export function Code({ children }: { children: ReactNode }) {
  return <Text style={useSrdPdfSlots().code}>{children}</Text>;
}

export function Pill({ variant, children }: { variant: PillVariant; children: ReactNode }) {
  const slots = useSrdPdfSlots();
  return <Text style={slots.pill(variant)}>{children}</Text>;
}

/**
 * Renders its children with the slots of another placement, adding nothing
 * to the page: for whole pages (a template's opening page, say), which
 * cannot sit inside a View.
 */
export function PlacementScope({
  placement,
  children,
}: {
  placement: SrdPlacement;
  children: ReactNode;
}) {
  const context = useContext(SrdPdfTemplateContext);
  if (!context) throw new Error('PlacementScope must be rendered inside a template');
  return (
    <SrdPdfTemplateContext.Provider value={{ ...context, placement }}>
      {children}
    </SrdPdfTemplateContext.Provider>
  );
}

/** Renders its children with the slots of another placement, in a View of
 * their own - a template's sidebar column, say. */
export function Placement({
  placement,
  children,
}: {
  placement: SrdPlacement;
  children: ReactNode;
}) {
  return (
    <PlacementScope placement={placement}>
      <View>{children}</View>
    </PlacementScope>
  );
}
