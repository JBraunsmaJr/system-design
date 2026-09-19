# Overview

**System Design Editor** is an interactive, browser-based architectural modeling and requirements gathering tool designed for engineering teams.

---

## Core Capabilities

- **Real-Time Peer-to-Peer Collaboration**: Collaborate live with teammates. All document state synchronizes directly browser-to-browser over WebRTC using Yjs CRDTs.
- **Architectural Diagramming**: Construct interactive system architectures, node topologies, and connection pathways.
- **Requirement Traceability**: Bi-directionally link diagram elements with engineering requirements, enabling intuitive drill-downs and scope tracking.
- **Program Increment (PI) Planning**: Plan capacity reservations, sprints, and milestones directly within interactive timelines.
- **Scenario Presentations**: Walk stakeholders through state transitions and system scenarios like presentation slides.

---

## Architecture & Tenets

### 100% Static Single-Page Application
The application contains no runtime database or server-side business logic. It executes entirely within the client's browser engine and can be hosted from any static web server, object storage bucket, or GitHub Pages.

### Peer-to-Peer State Synchronization
Document changes are tracked using CRDTs (Conflict-free Replicated Data Types) via Yjs. Document data never traverses a central server—it flows directly over encrypted WebRTC data channels between participants.

### Air-Gap & Private Network Friendly
The client bundle has zero external CDN dependencies (fonts and icons are fully bundled). When deployed in isolated or classified networks, internal STUN/TURN and relay servers can be configured to keep all communication strictly on-premises.

---

## Technology Stack

- **Framework**: React + TypeScript
- **Bundler & Tooling**: Vite
- **Diagram Canvas**: React Flow (`@xyflow/react`)
- **State & CRDT**: Yjs + `y-webrtc`
- **Icons & UI**: Lucide React + Tailwind CSS
