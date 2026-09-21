# How your work is protected

This page describes what is encrypted, what the server can see, and what
happens when someone loses a device. It is written for the people using the
editor and for anyone reviewing it before a deployment.

<style>
.kd { width: 100%; height: auto; }
.kd .box { fill: var(--vp-c-bg-soft); stroke: var(--vp-c-divider); stroke-width: 1; }
.kd .held { fill: var(--vp-c-bg-soft); stroke: var(--vp-c-brand-1); stroke-width: 1; }
.kd .zone { fill: none; stroke: var(--vp-c-divider); stroke-width: 1; stroke-dasharray: 5 4; }
.kd .t { fill: var(--vp-c-text-1); font-size: 14px; font-family: var(--vp-font-family-base); }
.kd .ts { fill: var(--vp-c-text-2); font-size: 12px; font-family: var(--vp-font-family-base); }
.kd .arr { stroke: var(--vp-c-text-3); stroke-width: 1.2; fill: none; }
.kd .pair { stroke: var(--vp-c-text-3); stroke-width: 1; stroke-dasharray: 4 4; }
</style>

## The chain of keys

Each key opens the next. Only the first one is held by your browser; the
rest are recovered by unwrapping, every time you open a document.

<svg class="kd" viewBox="0 0 680 560" role="img" aria-label="Key hierarchy: the device key unwraps the user key, which unwraps the workspace key, which unwraps the document key, from which the storage key is derived to open sealed document content.">
  <defs>
    <marker id="kdarrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
  </defs>

  <rect class="zone" x="20" y="20" width="300" height="440" rx="16"/>
  <text class="t" x="170" y="46" text-anchor="middle">Held in your browser</text>
  <text class="ts" x="170" y="64" text-anchor="middle">Unwrapped in memory, never sent</text>

  <rect class="zone" x="360" y="20" width="300" height="440" rx="16"/>
  <text class="t" x="510" y="46" text-anchor="middle">Held by the workspace</text>
  <text class="ts" x="510" y="64" text-anchor="middle">Wrapped or sealed only</text>

  <rect class="held" x="40" y="86" width="260" height="52" rx="8"/>
  <text class="t" x="170" y="108" text-anchor="middle" dominant-baseline="central">Device key</text>
  <text class="ts" x="170" y="126" text-anchor="middle" dominant-baseline="central">RSA-OAEP 3072, non-extractable</text>
  <line class="arr" x1="170" y1="138" x2="170" y2="158" marker-end="url(#kdarrow)"/>

  <rect class="held" x="40" y="162" width="260" height="52" rx="8"/>
  <text class="t" x="170" y="184" text-anchor="middle" dominant-baseline="central">Your user key</text>
  <text class="ts" x="170" y="202" text-anchor="middle" dominant-baseline="central">RSA-OAEP 3072, one per person</text>
  <line class="arr" x1="170" y1="214" x2="170" y2="234" marker-end="url(#kdarrow)"/>

  <rect class="held" x="40" y="238" width="260" height="52" rx="8"/>
  <text class="t" x="170" y="260" text-anchor="middle" dominant-baseline="central">Workspace key</text>
  <text class="ts" x="170" y="278" text-anchor="middle" dominant-baseline="central">AES-KW 256, one per workspace</text>
  <line class="arr" x1="170" y1="290" x2="170" y2="310" marker-end="url(#kdarrow)"/>

  <rect class="held" x="40" y="314" width="260" height="52" rx="8"/>
  <text class="t" x="170" y="336" text-anchor="middle" dominant-baseline="central">Document key</text>
  <text class="ts" x="170" y="354" text-anchor="middle" dominant-baseline="central">128 bits, also carried by a link</text>
  <line class="arr" x1="170" y1="366" x2="170" y2="386" marker-end="url(#kdarrow)"/>

  <rect class="held" x="40" y="390" width="260" height="52" rx="8"/>
  <text class="t" x="170" y="412" text-anchor="middle" dominant-baseline="central">Storage key</text>
  <text class="ts" x="170" y="430" text-anchor="middle" dominant-baseline="central">AES-GCM 256, derived not stored</text>

  <rect class="box" x="380" y="86" width="260" height="52" rx="8"/>
  <text class="t" x="510" y="108" text-anchor="middle" dominant-baseline="central">Your user key, wrapped</text>
  <text class="ts" x="510" y="126" text-anchor="middle" dominant-baseline="central">One row per approved browser</text>
  <line class="pair" x1="304" y1="112" x2="376" y2="112"/>

  <rect class="box" x="380" y="162" width="260" height="52" rx="8"/>
  <text class="t" x="510" y="184" text-anchor="middle" dominant-baseline="central">Workspace key, wrapped</text>
  <text class="ts" x="510" y="202" text-anchor="middle" dominant-baseline="central">Per member, per generation</text>
  <line class="pair" x1="304" y1="188" x2="376" y2="188"/>

  <rect class="box" x="380" y="238" width="260" height="52" rx="8"/>
  <text class="t" x="510" y="260" text-anchor="middle" dominant-baseline="central">Sealed document list</text>
  <text class="ts" x="510" y="278" text-anchor="middle" dominant-baseline="central">Titles and wrapped document keys</text>
  <line class="pair" x1="304" y1="264" x2="376" y2="264"/>

  <rect class="box" x="380" y="314" width="260" height="52" rx="8"/>
  <text class="t" x="510" y="336" text-anchor="middle" dominant-baseline="central">Sealed changes</text>
  <text class="ts" x="510" y="354" text-anchor="middle" dominant-baseline="central">Each bound to its document</text>
  <line class="pair" x1="304" y1="340" x2="376" y2="340"/>

  <rect class="box" x="380" y="390" width="260" height="52" rx="8"/>
  <text class="t" x="510" y="412" text-anchor="middle" dominant-baseline="central">Recovery wrap</text>
  <text class="ts" x="510" y="430" text-anchor="middle" dominant-baseline="central">Required on every document</text>
  <line class="pair" x1="304" y1="416" x2="376" y2="416"/>

  <rect class="box" x="380" y="482" width="260" height="52" rx="8"/>
  <text class="t" x="510" y="504" text-anchor="middle" dominant-baseline="central">organization's recovery key</text>
  <text class="ts" x="510" y="522" text-anchor="middle" dominant-baseline="central">Private half kept off the server</text>
  <line class="arr" x1="510" y1="446" x2="510" y2="478" marker-end="url(#kdarrow)"/>
</svg>

Reading the rows across: every key on the left exists on the right only in a
form that needs the key above it to open. The dashed lines are that pairing,
not data moving.

Three things this arrangement buys:

- **The device key never leaves the browser.** It is generated as
  non-extractable, so even the application's own code cannot read it out —
  only ask the browser to use it.
- **Each sealed change is bound to its place.** A document's id, the kind of
  change, and its version are authenticated alongside the ciphertext, so a
  change cannot be moved into another document or replayed as a later
  version. It fails to open rather than opening into something plausible.
- **The storage key is derived, never stored.** It comes from the document
  key by HKDF at the moment a document is opened.

## What the workspace can and cannot see

::: info Default mode
It holds ciphertext and wrapped keys. A database dump yields no titles, no
diagram content, and no key that can open any of it.
:::

It **does** see, by design, and records in its audit log:

- document identifiers, sizes and timestamps
- who signed in, from which provider, and when
- which documents each person read or changed, and who granted access to whom

A deployment can be configured to store documents unencrypted — for local
development, or where an organization has decided the server should read
content. When it is, **the editor shows a warning that cannot be dismissed**,
because you should never have to check a configuration file to know whether
your work is readable.

The relay that carries live sessions holds no key at all. A session's room
name is a hash of the document key, and its traffic is encrypted with that
key, so the relay sees opaque rooms and opaque bytes. It cannot tell which
document, workspace, or even which deployment a session belongs to.

## Three ways back in

Losing a device must not mean losing documents, and must not mean anyone
else can read them either.

<svg class="kd" viewBox="0 0 680 270" role="img" aria-label="Three recovery routes: another approved browser, your recovery code, or the organization's offline key — each leading back to readable documents.">
  <rect class="box" x="30" y="24" width="190" height="56" rx="8"/>
  <text class="t" x="125" y="46" text-anchor="middle" dominant-baseline="central">Another browser</text>
  <text class="ts" x="125" y="64" text-anchor="middle" dominant-baseline="central">Codes compared, then approved</text>

  <rect class="box" x="245" y="24" width="190" height="56" rx="8"/>
  <text class="t" x="340" y="46" text-anchor="middle" dominant-baseline="central">Your recovery code</text>
  <text class="ts" x="340" y="64" text-anchor="middle" dominant-baseline="central">Unseals your own keys</text>

  <rect class="box" x="460" y="24" width="190" height="56" rx="8"/>
  <text class="t" x="555" y="46" text-anchor="middle" dominant-baseline="central">Offline recovery key</text>
  <text class="ts" x="555" y="64" text-anchor="middle" dominant-baseline="central">Held by the organization</text>

  <line class="arr" x1="125" y1="80" x2="285" y2="166" marker-end="url(#kdarrow)"/>
  <line class="arr" x1="340" y1="80" x2="340" y2="166" marker-end="url(#kdarrow)"/>
  <line class="arr" x1="555" y1="80" x2="395" y2="166" marker-end="url(#kdarrow)"/>

  <rect class="held" x="200" y="170" width="280" height="56" rx="8"/>
  <text class="t" x="340" y="192" text-anchor="middle" dominant-baseline="central">Documents readable again</text>
  <text class="ts" x="340" y="210" text-anchor="middle" dominant-baseline="central">Content is never re-encrypted</text>
</svg>

They differ in who they need:

| Route | Needs | Typical use |
|---|---|---|
| Another browser | Someone with a working browser | A new laptop, a colleague joining |
| Recovery code | Only you | Every browser gone |
| Offline recovery key | The organization, not you | Someone has left; a records request |

The offline key is why **every document must carry a recovery wrap**. A
workspace that accepted documents without one would accumulate content that
nobody — including the organization that owns it — could ever recover. The
store refuses them rather than let that happen.

## Replacing a key

Revoking a browser stops the workspace serving it, but that browser still
holds the workspace key it already had. **Rotating** the key replaces it:
each document key is re-wrapped under the new one and the document list is
re-sealed. No content is re-encrypted, nothing is lost, and documents that
are deleted but still within their retention period are re-wrapped too, so
they stay restorable.

Anyone holding the old key can still read what they could read before —
copies already made cannot be recalled — but nothing saved afterwards.

## What this does not protect against

Stated plainly, because a security page that only lists strengths is not
much use:

- **A compromised browser.** Anything your browser can open, malware running
  in it can open too.
- **Someone you gave access to.** Access is a person deciding to trust
  another person. Revocation stops future reads, not copies already taken.
- **Traffic analysis.** The workspace sees sizes, times and who touched what,
  even though it cannot read content.
- **A lost recovery code with no devices left.** That is an administrator
  re-grant, and the documents written under the old keys stay unreadable
  unless the organization's offline key recovers them.
