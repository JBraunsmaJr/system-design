import type { RequirementCategory, RequirementItemType, RequirementsDocument, RelationshipType, RequirementRelationship, RequirementItem, RequirementStatus } from "./requirementsTypes";

/** "Ticket" is the only built-in type that represents actual work -
 * everything else here documents intent (a client requirement, a goal, a
 * constraint) rather than being a task someone completes. Custom types
 * can be marked workable too (see ManageTypesModal), this is just what
 * ships by default. */
export const BUILT_IN_ITEM_TYPES: RequirementItemType[] = [
  { id: "requirement", label: "Requirement", prefix: "REQ", color: "#5b7cfa", isBuiltIn: true, isWorkable: false },
  { id: "goal", label: "Goal", prefix: "GOAL", color: "#0FA36B", isBuiltIn: true, isWorkable: false },
  { id: "constraint", label: "Constraint", prefix: "CON", color: "#F2994A", isBuiltIn: true, isWorkable: false },
  { id: "assumption", label: "Assumption", prefix: "ASM", color: "#9061F9", isBuiltIn: true, isWorkable: false },
  { id: "risk", label: "Risk", prefix: "RISK", color: "#F0578C", isBuiltIn: true, isWorkable: false },
  { id: "ticket", label: "Ticket", prefix: "TICKET", color: "#22B8CF", isBuiltIn: true, isWorkable: true },
];

/** Status is fixed and not user-extensible (see RequirementStatus's own
 * doc comment) - this is just display metadata (label/color) for the
 * three values, not a registry of addable entries like item/relationship
 * types. */
export const REQUIREMENT_STATUSES: { id: RequirementStatus; label: string; color: string }[] = [
  { id: "todo", label: "To Do", color: "#8b90a0" },
  { id: "in-progress", label: "In Progress", color: "#F2994A" },
  { id: "done", label: "Done", color: "#0FA36B" },
];

export function getStatusMeta(status: RequirementStatus | undefined) {
  return REQUIREMENT_STATUSES.find((s) => s.id === status) ?? REQUIREMENT_STATUSES[0];
}

/** The starting status for a newly-created item of the given type -
 * "todo" for a workable type (a Ticket, or any custom type marked
 * workable), or undefined for a non-workable type, since status isn't a
 * meaningful concept for a purely descriptive item like a Requirement or
 * Goal. */
export function defaultStatusForType(doc: RequirementsDocument, typeId: string): RequirementStatus | undefined {
  const type = getItemType(doc, typeId);
  return type?.isWorkable ? "todo" : undefined;
}

/** Whether `item` is currently displaying/eligible for a status at all -
 * true only when its type is marked workable. Centralizes the "look up
 * the type, check the flag" pattern so display code (which item cards
 * show a StatusPicker) and future dependency-order views (which items
 * even appear) share one source of truth rather than each re-deriving it. */
export function isItemWorkable(doc: RequirementsDocument, item: RequirementItem): boolean {
  const type = getItemType(doc, item.typeId);
  return type?.isWorkable ?? false;
}

/** Mirrors the issue-link conventions from Jira/GitLab. "Relates to" is
 * symmetric (label === inverseLabel, direction is not meaningful);
 * "Blocks"/"Duplicates" are directional, each with a distinct inverse
 * shown when viewing the relationship from the other item. */
export const BUILT_IN_RELATIONSHIP_TYPES: RelationshipType[] = [
  { id: "relates-to", label: "Relates to", inverseLabel: "Relates to", color: "#8b90a0", isBuiltIn: true },
  { id: "blocks", label: "Blocks", inverseLabel: "Is blocked by", color: "#F0578C", isBuiltIn: true },
  { id: "duplicates", label: "Duplicates", inverseLabel: "Is duplicated by", color: "#F2994A", isBuiltIn: true },
];

export function getItemType(doc: RequirementsDocument, typeId: string): RequirementItemType | undefined {
  return doc.itemTypes.find((t) => t.id === typeId);
}

/** Adds whichever current built-in item types are missing from
 * `itemTypes`, leaving everything already there (built-in or custom)
 * completely untouched. Needed because a document saved before a given
 * built-in existed - e.g. before "Ticket" was added - has SOME item
 * types already, so the old "populate only if the list is empty" check
 * never ran for it: that check only handled a brand-new document with
 * zero types, not one simply missing a built-in added after it was
 * saved. Idempotent - calling this on a document that already has every
 * current built-in returns the array unchanged. */
export function withMissingBuiltInTypes(itemTypes: RequirementItemType[]): RequirementItemType[] {
  const existingIds = new Set(itemTypes.map((t) => t.id));
  const missing = BUILT_IN_ITEM_TYPES.filter((t) => !existingIds.has(t.id));
  return missing.length > 0 ? [...itemTypes, ...missing] : itemTypes;
}

/** Same reasoning as withMissingBuiltInTypes, for relationship types -
 * kept as a mirrored, separate function (rather than one generic helper)
 * since the two lists have different shapes and this stays simple to
 * read at each call site about which kind of type it's merging. */
export function withMissingBuiltInRelationshipTypes(relationshipTypes: RelationshipType[]): RelationshipType[] {
  const existingIds = new Set(relationshipTypes.map((t) => t.id));
  const missing = BUILT_IN_RELATIONSHIP_TYPES.filter((t) => !existingIds.has(t.id));
  return missing.length > 0 ? [...relationshipTypes, ...missing] : relationshipTypes;
}

/** True if `prefix` (case-insensitive) is already used by another type in
 * the document - two types sharing a prefix would make generated ids
 * ambiguous (which type does "REQ-3" belong to?), so this must be checked
 * before adding or renaming a custom type's prefix. `excludeTypeId` lets a
 * type be checked against everyone ELSE while editing itself. */
export function isPrefixTaken(doc: RequirementsDocument, prefix: string, excludeTypeId?: string): boolean {
  const normalized = prefix.trim().toUpperCase();
  return doc.itemTypes.some((t) => t.id !== excludeTypeId && t.prefix.toUpperCase() === normalized);
}

/** Generates the next id for `typeId` (e.g. "REQ-1", then "REQ-2"...) and
 * returns the updated sequence map to store back onto the document -
 * doesn't mutate `doc`, matching the immutable-update pattern used
 * throughout this app's state. */
export function generateItemId(
  doc: RequirementsDocument,
  typeId: string
): { id: string; nextSequence: Record<string, number> } {
  const type = getItemType(doc, typeId);
  if (!type) throw new Error(`Unknown requirement item type: ${typeId}`);
  const sequence = doc.nextSequence[typeId] ?? 1;
  return { id: `${type.prefix}-${sequence}`, nextSequence: { ...doc.nextSequence, [typeId]: sequence + 1 } };
}

export function getCategory(doc: RequirementsDocument, categoryId: string | undefined): RequirementCategory | undefined {
  if (!categoryId) return undefined;
  return doc.categories.find((c) => c.id === categoryId);
}

/** Cycled by category creation order rather than assigned by the user -
 * categories are meant to be quick to create (type a name, done), and
 * asking for a color up front on every one would add friction that item
 * types (created far less often, and tied to id generation) can more
 * reasonably ask for. */
const CATEGORY_COLOR_PALETTE = ["#5b7cfa", "#0FA36B", "#F2994A", "#9061F9", "#F0578C", "#22B8CF", "#EAB308", "#84CC16"];

export function nextCategoryColor(doc: RequirementsDocument): string {
  return CATEGORY_COLOR_PALETTE[doc.categories.length % CATEGORY_COLOR_PALETTE.length];
}

function nextCategoryId(doc: RequirementsDocument): string {
  let n = 1;
  while (doc.categories.some((c) => c.id === `category-${n}`)) n++;
  return `category-${n}`;
}

/** Case-insensitive match against existing category labels, since "Auth"
 * and "auth" being treated as different categories would be a confusing
 * way to end up with near-duplicate groups. */
export function findCategoryByLabel(doc: RequirementsDocument, label: string): RequirementCategory | undefined {
  const normalized = label.trim().toLowerCase();
  return doc.categories.find((c) => c.label.toLowerCase() === normalized);
}

/** Creates a new category (or returns the existing one if `label` already
 * matches, case-insensitively - typing an existing category's name is
 * treated as "use that one," not "make a duplicate") and returns the
 * updated categories array to store back onto the document. */
export function createCategory(
  doc: RequirementsDocument,
  label: string
): { category: RequirementCategory; categories: RequirementCategory[] } {
  const trimmed = label.trim();
  const existing = findCategoryByLabel(doc, trimmed);
  if (existing) return { category: existing, categories: doc.categories };
  const category: RequirementCategory = { id: nextCategoryId(doc), label: trimmed, color: nextCategoryColor(doc) };
  return { category, categories: [...doc.categories, category] };
}

/** Matches #REQ-3 style references: a prefix starting with a letter,
 * alphanumeric after that, a hyphen, then digits. Deliberately permissive
 * on the prefix shape (not hardcoded to the 5 built-in prefixes) so
 * references to custom types' ids match too. */
export const REFERENCE_PATTERN = /#([A-Za-z][A-Za-z0-9]*-\d+)\b/g;

export interface ParsedReference {
  /** The full matched text including the #, e.g. "#REQ-3". */
  raw: string;
  /** Just the id, e.g. "REQ-3". */
  id: string;
  index: number;
}

/** Finds every #ID-style reference in `text`, valid or not - callers that
 * only care about references to items that actually exist should cross
 * check the result against the document's items themselves. */
export function findReferences(text: string): ParsedReference[] {
  const results: ParsedReference[] = [];
  const regex = new RegExp(REFERENCE_PATTERN);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    results.push({ raw: match[0], id: match[1], index: match.index });
    // A zero-width match would infinite-loop exec(); REFERENCE_PATTERN
    // always consumes at least "#X-0"'s worth of characters so this
    // shouldn't happen in practice, but guarding costs nothing.
    if (match[0].length === 0) regex.lastIndex++;
  }
  return results;
}

/** Rewrites #REQ-3 style references into standard markdown links, but ONLY
 * for ids that actually exist in `doc` - a typo'd or since-deleted id is
 * left as plain text rather than becoming a dead link. Uses a custom
 * "#ref:ID" URL scheme (not a real anchor) specifically so the rendering
 * layer can detect and intercept clicks on these - see RequirementBody's
 * custom `a` component override, which distinguishes this scheme from a
 * genuine external link and scrolls to the item instead of navigating. */
export function resolveReferencesToMarkdownLinks(text: string, doc: RequirementsDocument): string {
  const existingIds = new Set(doc.items.map((i) => i.id));
  return text.replace(REFERENCE_PATTERN, (fullMatch, id: string) => {
    if (!existingIds.has(id)) return fullMatch;
    return `[${fullMatch}](#ref:${id})`;
  });
}

export function getRelationshipType(doc: RequirementsDocument, typeId: string): RelationshipType | undefined {
  return doc.relationshipTypes.find((t) => t.id === typeId);
}

/** Every relationship touching `itemId`, whether it's on the "from" or
 * "to" side - a relationship is only ever stored once regardless of
 * which item you're viewing it from, so callers looking at one item's
 * card need both directions included in a single list. */
export function getRelationshipsForItem(doc: RequirementsDocument, itemId: string): RequirementRelationship[] {
  return doc.relationships.filter((r) => r.fromItemId === itemId || r.toItemId === itemId);
}

/** The id of the OTHER item in `relationship`, relative to `itemId` -
 * e.g. if itemId is on the "from" side, returns the "to" id, and vice
 * versa. Assumes itemId is actually one side of the relationship, which
 * callers iterating getRelationshipsForItem's results always satisfy. */
export function getOtherItemId(relationship: RequirementRelationship, itemId: string): string {
  return relationship.fromItemId === itemId ? relationship.toItemId : relationship.fromItemId;
}

/** The direction-correct label for `relationship` as seen from `itemId`'s
 * side - e.g. viewing a "Blocks" relationship from the blocked item
 * returns the type's inverseLabel ("Is blocked by"), not its forward
 * label, since that item doesn't "block", it "is blocked by". */
export function getRelationshipLabelForItem(
  relationship: RequirementRelationship,
  type: RelationshipType,
  itemId: string
): string {
  return relationship.fromItemId === itemId ? type.label : type.inverseLabel;
}

function nextRelationshipId(): string {
  return `rel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Adds a new relationship if it's valid, returning the updated
 * relationships array - or the original array unchanged if the request
 * was invalid, so callers don't need to pre-validate themselves. Rejects
 * a self-relationship (an item can't block/relate-to/duplicate itself)
 * and an exact duplicate of an existing relationship (same type and same
 * direction already recorded).
 */
export function addRelationship(
  doc: RequirementsDocument,
  typeId: string,
  fromItemId: string,
  toItemId: string
): RequirementRelationship[] {
  if (fromItemId === toItemId) return doc.relationships;
  const isDuplicate = doc.relationships.some(
    (r) => r.typeId === typeId && r.fromItemId === fromItemId && r.toItemId === toItemId
  );
  if (isDuplicate) return doc.relationships;
  const newRelationship: RequirementRelationship = { id: nextRelationshipId(), typeId, fromItemId, toItemId };
  return [...doc.relationships, newRelationship];
}
