/**
 * Cross-document links: a node pointing at another document. The pure
 * rules (what counts as a valid link, the URL it opens, which title it
 * shows) and that the link survives every way a node is stored - a file,
 * the collaborative diagram, a peer's edit, an unlink.
 */
import * as Y from 'yjs';
import type {Node} from '@xyflow/react';
import {
    linkedDocumentHref,
    linkedDocumentLabel,
    normalizeLinkedDocument,
    parseDocumentIdInput,
    resolveLinkedDocument,
} from './documentLinks.ts';
import type {ArchNodeData} from './types.ts';
import {createYjsDiagramStore, seedYjsDiagramDoc} from '../../collab/stores/yjsDiagramStore.ts';
import {createLocalDiagramStore} from '../../collab/stores/diagramStore.ts';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

console.log('Normalizing');
{
  assert(
      normalizeLinkedDocument({docId: 'auth-platform', title: ' Auth '})?.title === 'Auth',
      'a valid link is kept, its title trimmed',
  );
  assert(
      normalizeLinkedDocument({docId: 'abc'})?.title === '',
      'a missing title is allowed - the link still opens',
  );
  assert(normalizeLinkedDocument(undefined) === undefined, 'no link is no link');
  assert(normalizeLinkedDocument('abc') === undefined, 'a bare string is not a link');
  assert(
      normalizeLinkedDocument({docId: '../../etc', title: 'x'}) === undefined,
      'an id the storage layer would refuse is dropped rather than linked',
  );
  assert(
      normalizeLinkedDocument({docId: 'a"><script>', title: 'x'}) === undefined,
      'as is anything that could break out of a URL',
  );
  assert(
      (normalizeLinkedDocument({docId: 'abc', title: 'x'.repeat(5000)})?.title.length ?? 0) <= 200,
      'a huge cached title is capped',
  );
  assert(
      linkedDocumentLabel({docId: 'abc', title: ''}) === 'Untitled document',
      'an untitled target still reads as something',
  );
}

console.log('The URL a link opens');
{
  const here = 'https://example.gov/system-design/?doc=payments#room=abc&key=secret';
  const href = linkedDocumentHref(here, 'auth-platform');
  assert(
      href === 'https://example.gov/system-design/?doc=auth-platform',
      'same app, the target document, and the session link in the hash dropped',
  );
  assert(!href?.includes('secret'), "this document's session key never travels with the link");
  assert(
      linkedDocumentHref('https://example.gov/?doc=a&view=x', 'b') ===
      'https://example.gov/?doc=b&view=x',
      'other query parameters are left alone',
  );
  assert(linkedDocumentHref(here, 'not valid!') === null, 'an invalid id produces no URL');
}

console.log('Resolving the title shown');
{
    const ref = {docId: 'auth', title: 'Auth (old name)'};
    const known = resolveLinkedDocument(ref, [{docId: 'auth', title: 'Auth platform'}]);
  assert(
      known.title === 'Auth platform' && known.isKnownHere,
      "where this browser has the document, its current title wins over the link's cached one",
  );
  const unknown = resolveLinkedDocument(ref, []);
  assert(
      unknown.title === 'Auth (old name)' && !unknown.isKnownHere,
      'elsewhere, the cached title is shown and the link is marked as not known here',
  );
}

console.log('Entering a document directly');
{
  assert(parseDocumentIdInput('  auth-platform ') === 'auth-platform', 'a bare id, trimmed');
  assert(
      parseDocumentIdInput('https://example.gov/system-design/?doc=auth-platform#room=x&key=y') ===
      'auth-platform',
      'or the editor link from the address bar, session part and all',
  );
  assert(parseDocumentIdInput('') === null, 'nothing is nothing');
  assert(parseDocumentIdInput('two words') === null, 'text that is not an id is refused');
  assert(
      parseDocumentIdInput('https://example.gov/system-design/') === null,
      'a link to the editor that names no document is refused, not guessed at',
  );
  assert(
      parseDocumentIdInput('https://example.gov/?doc=../../x') === null,
      'as is a link naming an invalid id',
  );
  assert(parseDocumentIdInput('javascript:alert(1)') === null, 'and anything else');
}

console.log('Stored with the node');
{
    const link = {docId: 'auth-platform', title: 'Auth platform'};
  const node: Node<ArchNodeData> = {
    id: 'n1',
    type: 'typed',
      position: {x: 0, y: 0},
    data: {
      nodeType: 'custom',
      label: 'Shared auth',
      properties: {},
      tags: [],
      linkedDocument: link,
    },
  };

  const doc = new Y.Doc();
    seedYjsDiagramDoc(doc, {nodes: [node], edges: []});
  const store = createYjsDiagramStore(doc);
  const read = () =>
      normalizeLinkedDocument(
          store.getSnapshot().nodes.find((n) => n.id === 'n1')?.data.linkedDocument,
      );
  assert(read()?.docId === 'auth-platform', 'seeding a file keeps the link');

  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
  createYjsDiagramStore(peer).updateNode('n1', {
      linkedDocument: {docId: 'identity', title: 'Identity'},
  });
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer));
  assert(read()?.docId === 'identity', "a peer's relink arrives");

    store.updateNode('n1', {linkedDocument: undefined});
  assert(read() === undefined, 'unlinking removes it');

    const local = createLocalDiagramStore({nodes: [node], edges: []});
  assert(
      normalizeLinkedDocument(local.getSnapshot().nodes[0]?.data.linkedDocument)?.title ===
      'Auth platform',
      'the local store carries it too',
  );
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
} else {
  console.log('\nAll document link checks passed.');
}
