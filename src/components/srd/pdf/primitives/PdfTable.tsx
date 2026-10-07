import type {ReactNode} from 'react';
import {Text, View} from '@react-pdf/renderer';
import {useSrdPdfSlots} from '../template/context';

export interface PdfColumn<Row> {
  header: string;
  /** Share of the table's width, relative to the other columns. */
  weight?: number;
  /** The cell's text: a string, or Text elements for emphasis. */
  cell: (row: Row) => ReactNode;
}

interface PdfTableProps<Row> {
  columns: PdfColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  /** False for a key-value table with no header row. */
  showHeader?: boolean;
  /**
   * Drawn above the table, inside it, so the two always share a page: a
   * heading outside would be left behind when the table moves to the next
   * page. For a short table it joins an unsplittable group, so keep it short
   * (a long section introduction stays outside - see SrdPdfSections' Lead).
   */
  heading?: ReactNode;
}

/**
 * Above this many rows a table repeats its header row on every page it
 * spans; at or below it, the header, the heading and the first row are kept
 * together instead. react-pdf cannot do both: a repeating (`fixed`) header
 * stays on the page where the table starts even when no row fits after it,
 * stranding it at the page's bottom. Short tables - most in an SRD - rarely
 * span pages, so they get the guarantee; long ones get the repetition.
 */
export const REPEAT_HEADER_AFTER_ROWS = 12;

/**
 * A table for react-pdf, which has none. Rows never split across pages. A
 * short table starts with its heading, header row and first row together; a
 * long one repeats its header row on every page it spans (see
 * REPEAT_HEADER_AFTER_ROWS).
 */
export function PdfTable<Row>({
  columns,
  rows,
  rowKey,
  showHeader = true,
  heading,
}: PdfTableProps<Row>) {
  const slots = useSrdPdfSlots();
  const repeatHeader = rows.length > REPEAT_HEADER_AFTER_ROWS;
  const headerRow = showHeader && (
    <View style={slots.tableHeaderRow} fixed={repeatHeader}>
      {columns.map((column) => (
        <Text key={column.header} style={[slots.tableHeaderCell, { flex: column.weight ?? 1 }]}>
          {column.header}
        </Text>
      ))}
    </View>
  );
  const rowViews = rows.map((row, index) => (
    <View
      key={rowKey(row, index)}
      style={index % 2 === 1 ? [slots.tableRow, slots.tableRowAlt] : slots.tableRow}
      wrap={false}
    >
      {columns.map((column) => (
        <Text key={column.header} style={[slots.tableCell, { flex: column.weight ?? 1 }]}>
          {column.cell(row)}
        </Text>
      ))}
    </View>
  ));

  if (repeatHeader) {
    return (
      <View style={slots.table}>
        {heading}
        {headerRow}
        {rowViews}
      </View>
    );
  }
  return (
    <View style={slots.table}>
      <View wrap={false}>
        {heading}
        {headerRow}
        {rowViews[0]}
      </View>
      {rowViews.slice(1)}
    </View>
  );
}
