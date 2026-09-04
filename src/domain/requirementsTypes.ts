/** A "kind" of requirements-doc item - Requirement, Goal, Constraint, etc.,
 * or a custom one the user defines. Extensible by design: the built-in set
 * covers common cases, but nothing about the data model assumes only
 * these exist. */
export interface RequirementItemType {
  id: string;
  label: string;
  /** Used in generated ids, e.g. "REQ" -> "REQ-1", "REQ-2"... */
  prefix: string;
  color: string;
  /** Built-in types can't be deleted or have their prefix changed (that
   * would silently break every existing reference using the old prefix) -
   * custom types can be freely edited/removed. */
  isBuiltIn: boolean;
  /** Whether items of this type represent actual work to be done (like a
   * Ticket) versus a descriptive/planning artifact (like a Requirement or
   * Goal) that documents intent but isn't itself a task. Drives which
   * items get a status at all, and later, which nodes appear at all in
   * dependency-order views built on top of this - not everything in the
   * requirements doc is "work", so not everything should compete for
   * space in a view specifically about getting work done. */
  isWorkable: boolean;
}

/** A user-defined grouping for organizing items by functional area (e.g.
 * "Authentication", "Payments") - orthogonal to item type: a Requirement
 * and a Goal can both belong to the same category, and a category has no
 * effect on id generation. Unlike item types, there are no built-in
 * categories - what categories make sense is entirely project-specific,
 * so the list starts empty and is built up by the user. */
export interface RequirementCategory {
  id: string;
  label: string;
  color: string;
}

/** A "kind" of link between two requirement items - Blocks, Relates to,
 * Duplicates, etc., or a custom one the user defines. Extensible by
 * design, same reasoning as RequirementItemType: the built-in set covers
 * common cases (mirroring Jira/GitLab's issue-link conventions) but
 * nothing about the data model assumes only these exist. */
export interface RelationshipType {
  id: string;
  /** Shown when viewing this relationship from its "from" item, e.g.
   * "Blocks". */
  label: string;
  /** Shown when viewing this relationship from its "to" item, e.g. "Is
   * blocked by". For a symmetric type like "Relates to", this is
   * identical to `label` - always populated (never optional) so display
   * code never has to special-case a missing inverse. */
  inverseLabel: string;
  color: string;
  isBuiltIn: boolean;
  /** Whether this type represents an actual ordering/dependency
   * constraint (like "Blocks") rather than a purely informational link
   * (like "Relates to" or "Duplicates"). Drives cycle prevention - every
   * relationship whose type has this set contributes to one shared
   * dependency graph for that check, so a cycle formed by mixing a
   * custom type (e.g. a user-defined "Depends on") with the built-in
   * "Blocks" is caught just as reliably as a cycle within one type
   * alone. A non-blocking type is never checked for cycles at all, since
   * "Relates to" being mutual or circular is completely normal. */
  isBlocking: boolean;
}

/** A directed link between two requirement items, e.g. REQ-1 "blocks"
 * REQ-5. Stored once, in one direction - which of the type's two labels
 * displays depends on which item you're currently viewing it from, not
 * on storing the same fact twice in both directions. */
export interface RequirementRelationship {
  id: string;
  typeId: string;
  fromItemId: string;
  toItemId: string;
}

/** Fixed, non-extensible - unlike item/relationship types, this isn't
 * meant to be a user-configurable workflow (no custom columns, no
 * reordering). A simple three-state model is enough to drive "is this
 * done, in flight, or not started" without taking on the complexity of a
 * fully custom workflow engine, which this app doesn't need yet. */
export type RequirementStatus = "todo" | "in-progress" | "done";

export interface RequirementItem {
  /** The full generated reference id, e.g. "REQ-1" - stable for the life
   * of the item, never reused even after deletion. */
  id: string;
  typeId: string;
  title: string;
  /** Markdown content, may contain #REQ-3 style references to other items. */
  body: string;
  /** References a RequirementCategory.id - undefined means uncategorized,
   * which is a normal, valid state (categorizing everything up front
   * shouldn't be required to start writing). */
  categoryId?: string;
  /** References a ProgramIncrements Sprint.id - undefined means
   * unassigned/backlog, same "not everything has to be scheduled up
   * front" reasoning as categoryId. */
  sprintId?: string;
  /** References a TeamMember.id - undefined means unassigned */
  assigneeId?: string;
  /** Estimated story points / effort */
  points?: number;
  /** Only meaningful for items of a workable type (see
   * RequirementItemType.isWorkable) - a non-workable item (a Requirement,
   * a Goal) simply never has this set, since "status" isn't a concept
   * that applies to a descriptive artifact. Left optional rather than
   * defaulted at the type level so a workable item created before this
   * field existed doesn't need a migration to remain valid - display code
   * treats a missing status on a workable item as "todo". */
  status?: RequirementStatus;
}

export interface RequirementsDocument {
  itemTypes: RequirementItemType[];
  categories: RequirementCategory[];
  items: RequirementItem[];
  relationshipTypes: RelationshipType[];
  relationships: RequirementRelationship[];
  /** Next sequence number to assign per type id. IDs are never reused
   * after a delete - matching how issue trackers like GitHub/GitLab number
   * things - so a reference already written elsewhere never silently ends
   * up pointing at a different item later. */
  nextSequence: Record<string, number>;
}

export const EMPTY_REQUIREMENTS_DOCUMENT: RequirementsDocument = {
  itemTypes: [],
  categories: [],
  items: [],
  relationshipTypes: [],
  relationships: [],
  nextSequence: {},
};
