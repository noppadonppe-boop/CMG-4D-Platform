# CMG 3D • 4D Workspace

รุ่นทดลอง 0.1 — Vite + React + TypeScript + Three.js / React Three Fiber / Drei

## Run locally

Install a Node.js version compatible with the locked dependencies, then:

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
```

## Implemented

Multiple independent projects; parametric concrete members; XYZ views; orbit, zoom, pan; perspective/orthographic; category visibility; isolation; transparency; section plane at Z=2m; illustrative reinforcement; dimensions and centroid editing; local audit; local model persistence; JSON import/export; document attachments through IndexedDB; image/PDF preview; editable category-linked schedule and 4D timeline.

## Boundaries

- Sample geometry is illustrative, not an engineered design.
- Canonical unit: metres. Z up. Position means member centroid.
- localStorage stores model metadata, IndexedDB stores attachments, per browser/device/origin. Firebase is not connected; clearing browser data removes local data. Export JSON and download attachments separately to back up.
- JSON exports contain model/schedule metadata, not attachment bytes. Imports omit attachment entries.
- CAD/IFC files can be attached/downloaded, not parsed. PDF/images are viewed, not automatically interpreted. AI is not connected.
- Reinforcement is visual demonstration, not BBS or design.
- 4D links activities by category, displays planned states only, with inclusive calendar start/end dates. Future members are ghosted, active yellow, completed green.
- Owner-private hosting does not add a team role/authorization system.

## Next phase

Firebase Auth, project memberships, Firestore/Storage and tested security rules; immutable model version snapshots; evidence-linked PDF review; IFC adapter; per-element activity links; backend jobs and reviewed AI extraction.
