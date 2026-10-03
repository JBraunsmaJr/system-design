import { Page, View } from '@react-pdf/renderer';
import { useSrdPdfSlots } from '../../template/context';
import type { SrdPdfLayoutProps } from '../../template/types';
import { SrdPdfPageChrome, SrdPdfTitleBlock } from '../../sections/SrdPdfPageChrome';
import { SrdPdfSection } from '../../sections/SrdPdfSections';

/**
 * Engineering's structure: each section on pages of its own, as chapters are
 * in a specification, the first opening with the title band.
 *
 * One <Page> per section rather than page breaks: react-pdf numbers pages
 * across the whole document either way, but a `break` could be dropped after
 * earlier page splits, leaving two sections on one page. Separate pages
 * cannot run together.
 */
export function EngineeringLayout({ data, config, sections }: SrdPdfLayoutProps) {
  const slots = useSrdPdfSlots();
  return (
    <>
      {sections.map((section, index) => (
        <Page
          key={section.id}
          size="LETTER"
          orientation={config.theme.pageOrientation}
          style={slots.page}
        >
          <SrdPdfPageChrome data={data} config={config} />
          <View style={slots.body}>
            {index === 0 && <SrdPdfTitleBlock data={data} />}
            <SrdPdfSection section={section} data={data} config={config} />
          </View>
        </Page>
      ))}
    </>
  );
}
