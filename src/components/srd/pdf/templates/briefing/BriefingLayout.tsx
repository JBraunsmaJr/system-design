import {Page, View} from '@react-pdf/renderer';
import type {SrdSectionConfig} from '../../../../../domain/srd/srdTypes';
import {useSrdPdfSlots} from '../../template/context';
import type {SrdPdfLayoutProps} from '../../template/types';
import {Placement, PlacementScope} from '../../primitives/text';
import {SrdPdfPageChrome, SrdPdfTitleBlock} from '../../sections/SrdPdfPageChrome';
import {SrdPdfMetrics, SrdPdfSection} from '../../sections/SrdPdfSections';
import {PAGE_MARGIN} from '../shared';
import {SIDEBAR_WIDTH} from './briefingSlots';

const SIDEBAR_PADDING = 20;

/**
 * Briefing's structure: an opening page with a sidebar - the title, details
 * and scope metrics - beside the first section, then the remaining sections
 * on full-width pages, where a sidebar would only waste the space.
 *
 * Two page groups, because react-pdf cannot change a page's margins partway
 * through flowing content: if the first section runs long, its continuation
 * keeps the sidebar strip. Page numbers run on across both groups. The
 * metrics are drawn in the sidebar, so the executive summary leaves them out
 * (metricsInLayout).
 */
export function BriefingLayout({ data, config, sections }: SrdPdfLayoutProps) {
  const slots = useSrdPdfSlots();
  const [first, ...rest] = sections;
  return (
    <>
      <PlacementScope placement="opening">
        <OpeningPage data={data} config={config} section={first} />
      </PlacementScope>
      {rest.length > 0 && (
        <Page size="LETTER" orientation={config.theme.pageOrientation} style={slots.page}>
          <SrdPdfPageChrome data={data} config={config} />
          <View style={slots.body}>
            {rest.map((section) => (
              <SrdPdfSection key={section.id} section={section} data={data} config={config} />
            ))}
          </View>
        </Page>
      )}
    </>
  );
}

function OpeningPage({
  data,
  config,
  section,
}: Omit<SrdPdfLayoutProps, 'sections'> & { section: SrdSectionConfig | undefined }) {
  const slots = useSrdPdfSlots();
  return (
    <Page size="LETTER" orientation={config.theme.pageOrientation} style={slots.page}>
      {/* The strip: fixed, so drawn on every page of this group, behind the rest. */}
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
      {/* The first page only: placed out of the flow, inside the strip. */}
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
        {section && <SrdPdfSection section={section} data={data} config={config} />}
      </View>
    </Page>
  );
}
