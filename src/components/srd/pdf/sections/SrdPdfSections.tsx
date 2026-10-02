import { Fragment, type ReactNode } from 'react';
import { Image, Text, View } from '@react-pdf/renderer';
import type {
  RequirementItemViewModel,
  SrdDataContext,
  SrdSectionConfig,
  SrdTemplateConfig,
} from '../../../../domain/srd/srdTypes';
import { interpolateTokens } from '../../../../domain/srd/srdMarkdownExport';
import { PdfMarkdown } from '../srdPdfMarkdown';
import { useSrdPdfSlots } from '../template/context';
import { PdfTable } from '../primitives/PdfTable';
import {
  Code,
  EmptyNote,
  HEADING_KEEP_WITH_NEXT,
  Pill,
  Strong,
  SubHeading,
} from '../primitives/text';

/**
 * The SRD's sections, drawn once for every template.
 *
 * What each section shows, and in what order, lives here; how it looks comes
 * from the template's slots. Wording matches the HTML preview, so the two
 * renderers carry the same content (checked by SrdPdfSections.verify.tsx).
 */

/**
 * A section's heading and introduction. The body places it inside its first
 * block - a table (which may split) or an unsplittable group - so the two
 * always share a page: placed above them, it would be left behind at the
 * bottom of a page whenever that block moves on. An unsplittable group takes
 * it only when `short`, since a long introduction could make the group taller
 * than a page, which react-pdf would cut off.
 */
interface Lead {
  node: ReactNode;
  short: boolean;
}

/** Introductions up to this length go inside unsplittable groups. */
const SHORT_INTRO = 280;

interface SectionProps {
  lead: Lead;
  data: SrdDataContext;
  config: SrdTemplateConfig;
}

const dash = (value: string | undefined) => value || '-';

/**
 * IMAGES_IN_THE_BROWSER: react-pdf's browser build (unlike Node) once dropped
 * images and collapsed the following pages into the footer when the
 * architecture diagram sat in an unsplittable framed View that was pushed to
 * a new page - with the image sized from its file, and with a fixed height
 * alike. What is verified to work: an unsplittable View of text plus a
 * fixed-height image framed on the image itself - the diagram with its label,
 * and card heads with their snapshots. Keep images to those shapes, give every image a fixed height,
 * and treat the browser suite's checks - every shown image embedded, nothing
 * in the footer band - as the guard: they reproduce the failure.
 */

function ExecutiveSummary({ lead, data }: SectionProps) {
  const { requirements, architecture, roadmap, metadata } = data;
  const metrics: Array<[string, string]> = [
    ['Total Requirements & Scope Items', String(requirements.summaryStats.total)],
    ['Requirement Categories Defined', String(requirements.categories.length)],
    [
      'Total Estimated Scope / Effort',
      requirements.summaryStats.totalPoints > 0
        ? `${requirements.summaryStats.totalPoints} pts`
        : 'Unestimated',
    ],
    ['Architecture Components Defined', String(architecture.components.length)],
    ['Component Interfaces & Data Flows', String(architecture.connections.length)],
    ['Target Delivery Milestones', String(roadmap.milestones.length)],
    ['Planned Delivery Sprints', String(roadmap.sprints.length)],
  ];
  const slots = useSrdPdfSlots();
  return (
    <>
      {lead.node}
      {metadata.description && (
        <>
          <SubHeading>Scope & Objectives</SubHeading>
          <PdfMarkdown markdown={metadata.description} styles={slots.markdown} />
        </>
      )}
      <PdfTable
        heading={<SubHeading>Scope & Architecture Metrics</SubHeading>}
        rows={metrics}
        rowKey={([label]) => label}
        columns={[
          { header: 'Metric', weight: 3, cell: ([label]) => label },
          { header: 'Value', weight: 1, cell: ([, value]) => <Strong>{value}</Strong> },
        ]}
      />
    </>
  );
}

function Architecture({ lead, data, config }: SectionProps) {
  const slots = useSrdPdfSlots();
  // The lead goes into whichever block comes first.
  const first = data.architecture.diagramImageBase64
    ? 'diagram'
    : config.includeComponentTable
      ? 'components'
      : config.includeConnectionsTable
        ? 'connections'
        : 'none';
  // Every first block here is unsplittable at its start (a diagram group,
  // or a table's opening group), so a long introduction stays outside it.
  const leadFor = (block: typeof first) => (first === block && lead.short ? lead.node : null);
  const { diagramImageBase64, components, connections } = data.architecture;
  return (
    <>
      {diagramImageBase64 && (
        // The label travels with the diagram in one unsplittable group, or
        // a diagram moved to the next page would leave it stranded. Text and
        // a fixed-height image, as in a card head - a shape verified in the
        // browser (IMAGES_IN_THE_BROWSER); the frame is on the image itself.
        <>
          {first !== 'none' && !lead.short && lead.node}
          <View wrap={false}>
            {leadFor('diagram')}
            <SubHeading>System Architecture Diagram</SubHeading>
            <Image src={diagramImageBase64} style={slots.diagramImage} />
          </View>
        </>
      )}

      {config.includeComponentTable && (
        <>
          {components.length === 0 ? (
            <>
              {leadFor('components')}
              <SubHeading>Component Inventory</SubHeading>
              <EmptyNote>No architecture components defined in canvas.</EmptyNote>
            </>
          ) : (
            <PdfTable
              heading={
                <>
                  {leadFor('components')}
                  <SubHeading>Component Inventory</SubHeading>
                </>
              }
              rows={components}
              rowKey={(c) => c.id}
              columns={[
                { header: 'Component Name', weight: 2, cell: (c) => <Strong>{c.name}</Strong> },
                { header: 'Type', weight: 1.4, cell: (c) => <Code>{c.type}</Code> },
                { header: 'Description', weight: 3, cell: (c) => dash(c.description) },
                {
                  header: 'Linked Requirements',
                  weight: 1.6,
                  cell: (c) => dash(c.linkedRequirementIds?.join(', ')),
                },
              ]}
            />
          )}
        </>
      )}

      {config.includeConnectionsTable && (
        <>
          {connections.length === 0 ? (
            <>
              {leadFor('connections')}
              <SubHeading>Connections & Data Flows</SubHeading>
              <EmptyNote>No connections defined between components.</EmptyNote>
            </>
          ) : (
            <PdfTable
              heading={
                <>
                  {leadFor('connections')}
                  <SubHeading>Connections & Data Flows</SubHeading>
                </>
              }
              rows={connections}
              rowKey={(_, i) => String(i)}
              columns={[
                { header: 'Source', cell: (c) => <Strong>{c.fromName || c.from}</Strong> },
                { header: 'Target', cell: (c) => <Strong>{c.toName || c.to}</Strong> },
                { header: 'Flow Label', weight: 1.4, cell: (c) => dash(c.label) },
                { header: 'Protocol', cell: (c) => <Code>{c.protocol || c.edgeType || '-'}</Code> },
              ]}
            />
          )}
        </>
      )}
      {/* No block above: the section is otherwise empty. */}
      {first === 'none' && lead.node}
    </>
  );
}

function RequirementCard({
  item,
  data,
  heading,
}: {
  item: RequirementItemViewModel;
  data: SrdDataContext;
  /** Drawn above the card, kept on the same page as its head. */
  heading?: ReactNode;
}) {
  const slots = useSrdPdfSlots();
  const links = data.traceability.filter((t) => t.sourceId === item.id || t.targetId === item.id);
  const body = item.body?.trim();
  return (
    // A card is two boxes whose borders join. Its head - title, pills and
    // snapshot, with any heading passed in - is unsplittable, so it is never
    // parted; the rest may run onto the next page, as a long body must.
    // Keep-with-next hints cannot do this: react-pdf acts on them only for an
    // element with earlier siblings, and large values break pages too early
    // or too late. The snapshot has a fixed height (IMAGES_IN_THE_BROWSER).
    <>
      <View wrap={false}>
        {heading}
        <View style={slots.cardHead}>
          <View style={slots.cardTitleRow}>
            <Text style={slots.cardId}>{item.id}</Text>
            <Text style={slots.cardTitle}>{item.title || '(Untitled Requirement)'}</Text>
          </View>
          <View style={slots.pillRow}>
            <Pill variant="type">{item.typeLabel}</Pill>
            {item.status && <Pill variant={`status-${item.status}`}>{item.status}</Pill>}
            {item.points != null && <Pill variant="points">{item.points} pts</Pill>}
            {item.sprintName && <Pill variant="sprint">{item.sprintName}</Pill>}
            {item.assigneeName && <Pill variant="assignee">{item.assigneeName}</Pill>}
          </View>
          {item.contextSnapshotBase64 && (
            <View style={slots.snapshotFrame}>
              <Text style={slots.snapshotCaption}>Architecture Context Snapshot</Text>
              <Image src={item.contextSnapshotBase64} style={slots.snapshotImage} />
            </View>
          )}
        </View>
      </View>

      <View style={slots.cardRest}>
        {item.linkedNodeLabels && item.linkedNodeLabels.length > 0 && (
          <Text style={slots.cardDetail}>
            <Strong>Linked Components: </Strong>
            {item.linkedNodeLabels.map((label, i) => (
              <Text key={i} style={slots.nodeTag}>
                {i > 0 ? '  ' : ''}
                {label}
              </Text>
            ))}
          </Text>
        )}

        {body && (
          <View style={slots.cardBody}>
            <PdfMarkdown markdown={body} styles={slots.markdown} />
          </View>
        )}

        {links.length > 0 && (
          <Text style={slots.cardDetail}>
            <Strong>Dependencies & Links: </Strong>
            {links
              .map((l) =>
                l.sourceId === item.id
                  ? `${l.relation} ${l.targetId} (${l.targetTitle})`
                  : `Linked from ${l.sourceId} (${l.sourceTitle}) via ${l.relation}`,
              )
              .join(' • ')}
          </Text>
        )}
      </View>
    </>
  );
}

function Requirements({ lead, data, config }: SectionProps) {
  const { categories, itemsByCategory } = data.requirements;
  const shown = categories.filter((c) => (itemsByCategory[c.id] ?? []).length > 0);
  // The first category's first block - a card head or a table's opening
  // group, both unsplittable - carries the lead when its introduction is
  // short.
  const leadInFirstBlock = lead.short;
  return (
    <>
      {(shown.length === 0 || !leadInFirstBlock) && lead.node}
      {shown.map((category, categoryIndex) => {
        const items = itemsByCategory[category.id] ?? [];
        const carried = categoryIndex === 0 && leadInFirstBlock ? lead.node : null;
        const heading = (
          <>
            {carried}
            <SubHeading>Category: {category.label}</SubHeading>
          </>
        );
        if (config.requirementsLayout === 'list') {
          return items.map((item, index) => (
            // The category heading travels inside its first card's
            // unsplittable head, so the two can never be parted.
            <RequirementCard
              key={item.id}
              item={item}
              data={data}
              heading={index === 0 ? heading : undefined}
            />
          ));
        }
        return (
          <Fragment key={category.id}>
            <PdfTable
              heading={heading}
              rows={items}
              rowKey={(item) => item.id}
              columns={[
                { header: 'ID', weight: 1, cell: (item) => <Code>{item.id}</Code> },
                { header: 'Title', weight: 3, cell: (item) => <Strong>{item.title}</Strong> },
                { header: 'Type', weight: 1.2, cell: (item) => item.typeLabel },
                { header: 'Status', weight: 1.1, cell: (item) => dash(item.status) },
                {
                  header: 'Effort',
                  weight: 0.9,
                  cell: (item) => (item.points != null ? `${item.points} pts` : '-'),
                },
                { header: 'Assignee', weight: 1.4, cell: (item) => dash(item.assigneeName) },
              ]}
            />
          </Fragment>
        );
      })}
    </>
  );
}

function Traceability({ lead, data }: SectionProps) {
  if (data.traceability.length === 0) {
    return (
      <>
        {lead.node}
        <EmptyNote>No relationships or architecture linkages established.</EmptyNote>
      </>
    );
  }
  // A long introduction stays outside the table's unsplittable opening.
  return (
    <>
      {!lead.short && lead.node}
      <PdfTable
        heading={lead.short ? lead.node : null}
        rows={data.traceability}
        rowKey={(_, i) => String(i)}
        columns={[
          {
            header: 'Source Entity',
            weight: 2,
            cell: (l) => (
              <>
                <Code>{l.sourceId}</Code> ({l.sourceTitle})
              </>
            ),
          },
          { header: 'Relationship', weight: 1.2, cell: (l) => <Strong>{l.relation}</Strong> },
          {
            header: 'Target Entity',
            weight: 2,
            cell: (l) => (
              <>
                <Code>{l.targetId}</Code> ({l.targetTitle})
              </>
            ),
          },
        ]}
      />
    </>
  );
}

function Roadmap({ lead, data }: SectionProps) {
  const { milestones, sprints } = data.roadmap;
  return (
    <>
      {milestones.length > 0 && !lead.short && lead.node}
      {milestones.length === 0 ? (
        <>
          {lead.node}
          <SubHeading>Milestones</SubHeading>
          <EmptyNote>No milestones scheduled.</EmptyNote>
        </>
      ) : (
        <PdfTable
          heading={
            <>
              {lead.short && lead.node}
              <SubHeading>Milestones</SubHeading>
            </>
          }
          rows={milestones}
          rowKey={(m) => m.id}
          columns={[
            { header: 'Milestone', weight: 2, cell: (m) => <Strong>{m.title}</Strong> },
            { header: 'Type', cell: (m) => <Code>{m.type}</Code> },
            { header: 'Target Date', cell: (m) => dash(m.targetDate) },
            { header: 'Description', weight: 2.5, cell: (m) => dash(m.description) },
          ]}
        />
      )}

      {sprints.length === 0 ? (
        <>
          <SubHeading>Program Increments & Sprints</SubHeading>
          <EmptyNote>No sprint iterations planned.</EmptyNote>
        </>
      ) : (
        <PdfTable
          heading={<SubHeading>Program Increments & Sprints</SubHeading>}
          rows={sprints}
          rowKey={(s) => s.id}
          columns={[
            { header: 'PI', cell: (s) => <Strong>{s.piName}</Strong> },
            { header: 'Sprint', cell: (s) => s.name },
            { header: 'Timeline', weight: 1.8, cell: (s) => `${s.startDate} - ${s.endDate}` },
            { header: 'Effort', weight: 0.8, cell: (s) => `${s.totalPoints} pts` },
            {
              header: 'Assigned Scope',
              weight: 1.1,
              cell: (s) => `${s.assignedItems.length} items`,
            },
          ]}
        />
      )}
    </>
  );
}

const SECTION_BODIES = {
  executive_summary: ExecutiveSummary,
  architecture: Architecture,
  requirements: Requirements,
  traceability: Traceability,
  roadmap: Roadmap,
} satisfies Record<SrdSectionConfig['id'], (props: SectionProps) => React.ReactNode>;

interface SrdPdfSectionProps extends Omit<SectionProps, 'lead'> {
  section: SrdSectionConfig;
}

/** One section: its heading, introduction and body. */
export function SrdPdfSection({ section, data, config }: SrdPdfSectionProps) {
  const slots = useSrdPdfSlots();
  const Body = SECTION_BODIES[section.id];
  const intro = section.customIntroText ? interpolateTokens(section.customIntroText, data) : '';
  // The heading keeps minPresenceAhead for where it does stand alone: react-
  // pdf honors it only with earlier siblings, so sections render as
  // fragments, never inside a wrapper View.
  const lead: Lead = {
    node: (
      <>
        <Text style={slots.sectionHeading} minPresenceAhead={HEADING_KEEP_WITH_NEXT}>
          {interpolateTokens(section.title, data)}
        </Text>
        {intro && <Text style={slots.sectionIntro}>{intro}</Text>}
      </>
    ),
    short: intro.length <= SHORT_INTRO,
  };
  return <Body lead={lead} data={data} config={config} />;
}
