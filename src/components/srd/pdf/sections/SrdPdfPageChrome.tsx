import { Text, View } from '@react-pdf/renderer';
import type { SrdDataContext, SrdTemplateConfig } from '../../../../domain/srd/srdTypes';
import { interpolateTokens } from '../../../../domain/srd/srdMarkdownExport';
import { useSrdPdfSlots } from '../template/context';

interface ChromeProps {
  data: SrdDataContext;
  config: SrdTemplateConfig;
}

/**
 * What repeats on every page: the classification banner, the running header
 * and the numbered footers. Every element is `fixed`, and each footer text is
 * its own fixed element - react-pdf evaluates a `render` callback (needed for
 * page numbers) only on a fixed node itself, not inside a fixed View.
 *
 * Must be placed outside the body (see the `body` slot): a line height on any
 * ancestor makes react-pdf drop the page numbers.
 */
export function SrdPdfPageChrome({ data, config }: ChromeProps) {
  const slots = useSrdPdfSlots();
  const hf = config.headersAndFooters;
  const text = (template: string | undefined) =>
    template ? interpolateTokens(template, data) : '';
  const footerRight = (pageNumber: number, totalPages: number) =>
    hf.footerRight
      ? interpolateTokens(hf.footerRight, data, { pageNumber, totalPages })
      : hf.showPageNumbers
        ? `Page ${pageNumber} of ${totalPages}`
        : '';

  return (
    <>
      {hf.classificationBanner && (
        <Text style={slots.banner} fixed>
          {text(hf.classificationBanner).toUpperCase()}
        </Text>
      )}
      {(hf.headerLeft || hf.headerRight) && (
        <View style={slots.runningHeader} fixed>
          <Text>{text(hf.headerLeft)}</Text>
          <Text>{text(hf.headerRight)}</Text>
        </View>
      )}
      <View style={slots.footerRule} fixed />
      <Text
        style={slots.footerLeft}
        fixed
        render={({ pageNumber, totalPages }) =>
          hf.footerLeft ? interpolateTokens(hf.footerLeft, data, { pageNumber, totalPages }) : ''
        }
      />
      <Text
        style={slots.footerRight}
        fixed
        render={({ pageNumber, totalPages }) => footerRight(pageNumber, totalPages)}
      />
    </>
  );
}

export function SrdPdfTitleBlock({ data }: { data: SrdDataContext }) {
  const slots = useSrdPdfSlots();
  const { metadata } = data;
  const entries: Array<[string, string]> = [
    ['Version', metadata.version],
    ['Date', metadata.generatedAt],
  ];
  if (metadata.organization) entries.push(['Organization', metadata.organization]);
  if (metadata.authors.length > 0) {
    entries.push([
      'Authors',
      metadata.authors.map((a) => (a.role ? `${a.name} (${a.role})` : a.name)).join(', '),
    ]);
  }
  return (
    <View wrap={false}>
      <Text style={slots.title}>{metadata.title}</Text>
      <View style={slots.metaGrid}>
        {entries.map(([label, value]) => (
          <Text key={label} style={slots.metaItem}>
            <Text style={slots.metaLabel}>{label}: </Text>
            {value}
          </Text>
        ))}
      </View>
    </View>
  );
}
