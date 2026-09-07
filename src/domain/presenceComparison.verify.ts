/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/presenceComparison.verify.ts
 */
import { peerBadgesAreEqual, type PeerBadge } from "./presenceComparison";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const alice = (): PeerBadge => ({ clientId: 1, name: "Alice", color: "#5b7cfa" });
const bob = (): PeerBadge => ({ clientId: 2, name: "Bob", color: "#f0578c" });

// === Part 1: the same array is trivially equal ===
{
  const peers = [alice()];
  assert(peerBadgesAreEqual(peers, peers), "an identical array reference short-circuits to equal");
}

// === Part 2: freshly rebuilt but identical arrays are equal ===
// This is the case that makes array identity useless here: the parent
// rebuilds peersHere with a .filter() on every single render, so the
// reference always differs even when nothing about the peers changed.
{
  assert(
    peerBadgesAreEqual([alice(), bob()], [alice(), bob()]),
    "two separately-constructed arrays with the same peers are equal - so a parent re-render alone doesn't re-render every card"
  );
}

// === Part 3: cursor movement does NOT count as a change ===
// The whole reason for comparing fields instead of peer objects.
// Presence updates rebuild peer objects and fire on every throttled
// cursor move; a badge renders none of that.
{
  const before: PeerBadge[] = [{ ...alice(), cursor: { x: 10, y: 10 } } as PeerBadge & { cursor: unknown }];
  const after: PeerBadge[] = [{ ...alice(), cursor: { x: 900, y: 400 } } as PeerBadge & { cursor: unknown }];

  assert(
    peerBadgesAreEqual(before, after),
    "a peer moving their cursor is NOT a badge change - object identity would have re-rendered every card in the list on every mouse move"
  );
}

// === Part 4: every rendered field is compared ===
{
  assert(!peerBadgesAreEqual([alice()], [{ ...alice(), name: "Alicia" }]), "a renamed peer is a change - the badge renders the first initial and the hover title");
  assert(!peerBadgesAreEqual([alice()], [{ ...alice(), color: "#000000" }]), "a recolored peer is a change - the badge dot uses it");
  assert(!peerBadgesAreEqual([alice()], [{ ...alice(), clientId: 99 }]), "a different clientId is a change - it's the badge's React key");
}

// === Part 5: peers arriving and leaving ===
// The actual bug the missing comparator entry caused: a peer starting
// to edit this item produced no re-render at all, so the badge never
// appeared.
{
  assert(!peerBadgesAreEqual([], [alice()]), "a peer arriving on this item is a change - this is the staleness the memo was hiding");
  assert(!peerBadgesAreEqual([alice()], []), "a peer leaving is a change too, so the badge actually disappears");
  assert(!peerBadgesAreEqual([alice()], [alice(), bob()]), "a second peer joining the same item is a change");
}

// === Part 6: undefined is treated as empty ===
// peersHere is an optional prop, and its `= []` default is applied
// inside the component, not in the comparator - so the comparator
// genuinely sees undefined from any caller that omits it.
{
  assert(peerBadgesAreEqual(undefined, undefined), "two omitted lists are equal");
  assert(peerBadgesAreEqual(undefined, []), "omitted and empty are equal - the default is applied inside the component, so the comparator sees both forms");
  assert(!peerBadgesAreEqual(undefined, [alice()]), "omitted vs. one peer is still a change");
}

// === Part 7: order is treated as a change ===
// Deliberate: reordering yields a redundant re-render rather than a
// missed one, and avoids sorting on every comparison.
{
  assert(!peerBadgesAreEqual([alice(), bob()], [bob(), alice()]), "reordered peers compare unequal - the safe direction to be wrong in, and cheaper than sorting");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
