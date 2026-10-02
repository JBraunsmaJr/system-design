import { Page, View } from '@react-pdf/renderer';
import { useSrdPdfSlots } from '../../template/context';
import type { SrdPdfLayoutProps } from '../../template/types';
import { Placement } from '../../primitives/text';
import { SrdPdfPageChrome, SrdPdfTitleBlock } from '../../sections/SrdPdfPageChrome';
import { SrdPdfMetrics, SrdPdfSection } from '../../sections/SrdPdfSections';
import { PAGE_MARGIN } from '../shared';
import { SIDEBAR_WIDTH } from './briefingSlots';

const SIDEBAR_PADDING = 20;

/**
 * Briefing's structure: a sidebar strip on every page, and on the first, in
 * the strip, the title, metadata and scope metrics; the sections
 * flow in the main column. The metrics are drawn here, so the executive
 * summary leaves them out (metricsInLayout).
 */
export function BriefingLayout({ data, config, sections }: SrdPdfLayoutProps) {
  const slots = useSrdPdfSlots();
  return (
    <Page size="LETTER" orientation={config.theme.pageOrientation} style={slots.page}>
      {/* The strip: fixed, so it is drawn on every page, behind the rest. */}
      <View
        fixed
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: SIDEBAR_WIDTH,
          backgroundColor: config.theme.primaryColor,
        }}
      />
      <SrdPdfPageChrome data={data} config={config} />
      {/* First page only: placed out of the flow, inside the strip. */}
      <View
        style={{
          position: 'absolute',
          top: PAGE_MARGIN,
          left: SIDEBAR_PADDING,
          width: SIDEBAR_WIDTH - SIDEBAR_PADDING * 2,
        }}
      >
        <Placement placement="sidebar">
          <SrdPdfTitleBlock data={data} />
          <SrdPdfMetrics data={data} />
        </Placement>
      </View>
      <View style={slots.body}>
        {sections.map((section) => (
          <SrdPdfSection key={section.id} section={section} data={data} config={config} />
        ))}
      </View>
    </Page>
  );
}
