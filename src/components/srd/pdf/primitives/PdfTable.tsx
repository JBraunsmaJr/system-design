import type { ReactNode } from 'react';
import { Text, View } from '@react-pdf/renderer';
import { useSrdPdfSlots } from '../template/context';

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
}

/**
 * A table for react-pdf, which has none. The header row repeats on every
 * page the table spans, and a row never splits across pages - both proven
 * in srdPdfPagination.verify.tsx.
 */
export function PdfTable<Row>({ columns, rows, rowKey, showHeader = true }: PdfTableProps<Row>) {
  const slots = useSrdPdfSlots();
  return (
    <View style={slots.table}>
      {showHeader && (
        <View style={slots.tableHeaderRow} fixed>
          {columns.map((column) => (
            <Text key={column.header} style={[slots.tableHeaderCell, { flex: column.weight ?? 1 }]}>
              {column.header}
            </Text>
          ))}
        </View>
      )}
      {rows.map((row, index) => (
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
      ))}
    </View>
  );
}
