/**
 * Pagination behaviors the SRD depends on, proven against the real
 * renderer: react-pdf lays the document out, pdf.js reads each page back.
 *
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/srd/pdf/srdPdfPagination.verify.tsx
 */
import {Document, Page, pdf, StyleSheet, Text, View} from '@react-pdf/renderer';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`ok: ${message}`);
  else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const styles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 60, fontSize: 10 },
  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, textAlign: 'right' },
  heading: { fontSize: 16, marginTop: 12, marginBottom: 6 },
  headerRow: { flexDirection: 'row', backgroundColor: '#e2e8f0', paddingVertical: 4 },
  row: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderColor: '#cbd5e1' },
  cell: { flex: 1, paddingHorizontal: 4 },
  card: { borderWidth: 1, borderColor: '#94a3b8', padding: 8, marginBottom: 8, height: 150 },
});

const ROWS = 80;
const CARDS = 12;

/** `guarded` turns on the three features under test; off, it is the control
 * showing what each one prevents. */
function spikeDocument(guarded: boolean) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.heading}>Component Inventory</Text>
        {/* A table header marked `fixed` inside the wrapping table view repeats
            on every page that view spans - and only those pages. */}
        <View>
          <View style={styles.headerRow} fixed={guarded}>
            <Text style={styles.cell}>TABLE-HEADER Name</Text>
            <Text style={styles.cell}>Type</Text>
          </View>
          {Array.from({ length: ROWS }, (_, i) => (
            <View key={i} style={styles.row} wrap={false}>
              <Text style={styles.cell}>ROW-{i}</Text>
              <Text style={styles.cell}>Service</Text>
            </View>
          ))}
        </View>

        {/* Cards that must never split across pages. The section starts on a
            fresh page, and the spacer puts card 0 across the page boundary
            (content ends at 842 - 60 = 782pt; 40 + 18 + 680 + 150 > 782). */}
        <Text style={styles.heading} break>
          Requirements
        </Text>
        <View style={{ height: 680 }} />
        {Array.from({ length: CARDS }, (_, i) => (
          <View key={i} style={styles.card} wrap={!guarded}>
            <Text>CARD-{i}-START</Text>
            <Text>Body of requirement {i}</Text>
            <Text>CARD-{i}-END</Text>
          </View>
        ))}

        {/* On a fresh page, the spacer leaves room for the heading (~37pt with
            margins) but not for the line after it: without minPresenceAhead
            the heading is stranded at the bottom. */}
        <View break style={{ height: 700 }} />
        <Text style={styles.heading} minPresenceAhead={guarded ? 80 : 0}>
          STRANDED-HEADING Roadmap
        </Text>
        <Text>ROADMAP-BODY first line of the roadmap section</Text>

        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </Page>
    </Document>
  );
}

async function pagesText(guarded: boolean): Promise<string[]> {
  const blob = await pdf(spikeDocument(guarded)).toBlob();
  const data = new Uint8Array(await blob.arrayBuffer());
  // verbosity 0: text extraction needs no standard font data, so pdf.js's
  // warning about it is noise here.
  const doc = await getDocument({ data, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return pages;
}

const pages = await pagesText(true);
const control = await pagesText(false);
console.log(`(${pages.length} pages; control ${control.length})`);

const cardSplits = (texts: string[]) =>
  Array.from({ length: CARDS }, (_, i) => i).filter((i) => {
    const start = texts.findIndex((t) => t.includes(`CARD-${i}-START`));
    const end = texts.findIndex((t) => t.includes(`CARD-${i}-END`));
    return start === -1 || start !== end;
  });
const headingStranded = (texts: string[]) =>
  texts.findIndex((t) => t.includes('STRANDED-HEADING')) !==
  texts.findIndex((t) => t.includes('ROADMAP-BODY'));

console.log('=== 1. Table headers repeat on every page the table spans ===');
{
  const tablePages = pages.filter((t) => /ROW-\d+/.test(t));
  assert(tablePages.length >= 2, `the table spans several pages (${tablePages.length})`);
  assert(
    tablePages.every((t) => t.includes('TABLE-HEADER')),
    'every page with table rows starts with the header row',
  );
  assert(
    pages.filter((t) => t.includes('TABLE-HEADER')).length === tablePages.length,
    'the header does not appear on pages without the table',
  );
  const allRows = pages.join(' ').match(/ROW-\d+/g) ?? [];
  assert(allRows.length === ROWS, `no row is lost or duplicated (${allRows.length}/${ROWS})`);
}

console.log('=== 2. Requirement cards never split ===');
{
  const split = cardSplits(pages);
  assert(split.length === 0, `every card starts and ends on the same page (split: ${split})`);
}

console.log('=== 3. Headings are not stranded at the bottom of a page ===');
{
  assert(!headingStranded(pages), 'the heading moves with its content');
}

console.log('=== 4. Page numbers ===');
{
  const total = pages.length;
  assert(
    pages.every((t, i) => t.includes(`Page ${i + 1} of ${total}`)),
    `every page reads "Page n of ${total}"`,
  );
}

console.log('=== 5. Controls: without the features, each problem appears ===');
{
  // Proves the checks above test the features, not a lucky layout.
  const tablePages = control.filter((t) => /ROW-\d+/.test(t));
  assert(
    control.filter((t) => t.includes('TABLE-HEADER')).length === 1 && tablePages.length >= 2,
    'without `fixed`, the header appears on the first table page only',
  );
  assert(cardSplits(control).length > 0, 'without wrap={false}, some card splits');
  assert(headingStranded(control), 'without minPresenceAhead, the heading is stranded');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
