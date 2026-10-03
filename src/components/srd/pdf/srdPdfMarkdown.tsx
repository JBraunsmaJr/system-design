import { Fragment, type ReactNode } from 'react';
import { Link, Text, View, type Styles } from '@react-pdf/renderer';
import type { Nodes, Parents, PhrasingContent, RootContent, Table } from 'mdast';
import { parseMarkdown } from './srdPdfMarkdownTree';

/**
 * Markdown for the react-pdf renderer.
 *
 * Parsed with the same remark plugins as the app's own Markdown (requirement bodies, docs) (GFM, and single
 * line breaks kept), then walked into react-pdf elements: block nodes become
 * Views, inline nodes nested Texts. Raw HTML is shown as its text, never
 * interpreted, and only http(s) and mailto links are made clickable.
 */

/** One react-pdf style, from the renderer's public types. */
export type PdfStyle = Styles[string];

/** How each kind of Markdown element is drawn; templates supply these. */
export interface PdfMarkdownStyles {
  root?: PdfStyle;
  paragraph: PdfStyle;
  heading: PdfStyle;
  strong: PdfStyle;
  emphasis: PdfStyle;
  strikethrough: PdfStyle;
  inlineCode: PdfStyle;
  codeBlock: PdfStyle;
  link: PdfStyle;
  blockquote: PdfStyle;
  list: PdfStyle;
  listItem: PdfStyle;
  listMarker: PdfStyle;
  listContent: PdfStyle;
  rule: PdfStyle;
  table: PdfStyle;
  tableRow: PdfStyle;
  tableHeaderCell: PdfStyle;
  tableCell: PdfStyle;
}

const SAFE_LINK = /^(https?:|mailto:)/i;

function plainText(node: Nodes): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  if ('children' in node) return (node.children as Nodes[]).map(plainText).join('');
  return '';
}

function renderInline(nodes: PhrasingContent[], styles: PdfMarkdownStyles): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return node.value;
      case 'strong':
        return (
          <Text key={i} style={styles.strong}>
            {renderInline(node.children, styles)}
          </Text>
        );
      case 'emphasis':
        return (
          <Text key={i} style={styles.emphasis}>
            {renderInline(node.children, styles)}
          </Text>
        );
      case 'delete':
        return (
          <Text key={i} style={styles.strikethrough}>
            {renderInline(node.children, styles)}
          </Text>
        );
      case 'inlineCode':
        return (
          <Text key={i} style={styles.inlineCode}>
            {node.value}
          </Text>
        );
      case 'break':
        return '\n';
      case 'link':
        return SAFE_LINK.test(node.url) ? (
          <Link key={i} src={node.url} style={styles.link}>
            {renderInline(node.children, styles)}
          </Link>
        ) : (
          <Fragment key={i}>{renderInline(node.children, styles)}</Fragment>
        );
      case 'image':
        // Images in descriptions would be fetched from anywhere; the alt
        // text keeps the meaning without that.
        return node.alt ? `[${node.alt}]` : '';
      default:
        return plainText(node);
    }
  });
}

function renderTable(node: Table, styles: PdfMarkdownStyles, key: number): ReactNode {
  return (
    <View key={key} style={styles.table}>
      {node.children.map((row, r) => (
        // A row never splits across pages.
        <View key={r} style={styles.tableRow} wrap={false}>
          {row.children.map((cell, c) => (
            <Text key={c} style={r === 0 ? styles.tableHeaderCell : styles.tableCell}>
              {renderInline(cell.children, styles)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function renderBlocks(
  parent: Parents,
  styles: PdfMarkdownStyles,
  ordered?: { start: number },
): ReactNode[] {
  return (parent.children as RootContent[]).map((node, i) => {
    switch (node.type) {
      case 'paragraph':
        return (
          <Text key={i} style={styles.paragraph}>
            {renderInline(node.children, styles)}
          </Text>
        );
      case 'heading':
        return (
          <Text key={i} style={styles.heading} minPresenceAhead={24}>
            {renderInline(node.children, styles)}
          </Text>
        );
      case 'list':
        return (
          <View key={i} style={styles.list}>
            {renderBlocks(node, styles, node.ordered ? { start: node.start ?? 1 } : undefined)}
          </View>
        );
      case 'listItem': {
        const marker =
          node.checked != null
            ? node.checked
              ? '[x]'
              : '[ ]'
            : ordered
              ? `${ordered.start + i}.`
              : '•';
        return (
          <View key={i} style={styles.listItem}>
            <Text style={styles.listMarker}>{marker}</Text>
            <View style={styles.listContent}>{renderBlocks(node, styles)}</View>
          </View>
        );
      }
      case 'blockquote':
        return (
          <View key={i} style={styles.blockquote}>
            {renderBlocks(node, styles)}
          </View>
        );
      case 'code':
        return (
          <Text key={i} style={styles.codeBlock}>
            {node.value}
          </Text>
        );
      case 'thematicBreak':
        return <View key={i} style={styles.rule} />;
      case 'table':
        return renderTable(node, styles, i);
      case 'html':
        return (
          <Text key={i} style={styles.paragraph}>
            {node.value}
          </Text>
        );
      default:
        return null;
    }
  });
}

interface PdfMarkdownProps {
  markdown: string;
  styles: PdfMarkdownStyles;
}

export function PdfMarkdown({ markdown, styles }: PdfMarkdownProps) {
  if (!markdown.trim()) return null;
  return <View style={styles.root}>{renderBlocks(parseMarkdown(markdown), styles)}</View>;
}
