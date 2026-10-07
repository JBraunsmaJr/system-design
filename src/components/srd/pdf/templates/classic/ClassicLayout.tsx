import {Page, View} from '@react-pdf/renderer';
import {useSrdPdfSlots} from '../../template/context';
import type {SrdPdfLayoutProps} from '../../template/types';
import {SrdPdfPageChrome, SrdPdfTitleBlock} from '../../sections/SrdPdfPageChrome';
import {SrdPdfSection} from '../../sections/SrdPdfSections';

/** Classic's structure: one column - the title block, then each section. */
export function ClassicLayout({ data, config, sections }: SrdPdfLayoutProps) {
  const slots = useSrdPdfSlots();
  return (
    <Page size="LETTER" orientation={config.theme.pageOrientation} style={slots.page}>
      <SrdPdfPageChrome data={data} config={config} />
      <View style={slots.body}>
        <SrdPdfTitleBlock data={data} />
        {sections.map((section) => (
          <SrdPdfSection key={section.id} section={section} data={data} config={config} />
        ))}
      </View>
    </Page>
  );
}
