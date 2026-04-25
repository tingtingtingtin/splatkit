# SplatKit: Three.js Splat Viewer

Work-in-progress Gaussian Splat renderer built with Three.js, TypeScript, GLSL, and Web Workers.

This package is experimental and APIs may change between releases.

This repository now has two usage modes:

1. Standalone page app (entry at `src/main.ts`)
2. Embeddable viewer classes:
	 - `SplatViewer` (headless core, no UI)
	 - `SplatViewerUI` (optional overlay UI wrapper)

Inspired by:

- [antimatter15/splat](https://github.com/antimatter15/splat/)
- [Spark](https://github.com/sparkjsdev/spark/)

## Features

- Custom splat pipeline with packed `DataTexture` storage
- GLSL splat shading and ellipse projection
- Worker-based depth sorting for transparent blending
- Dynamic instance-count control by percentage
- Camera controls:
	- Orbit controls
	- WASD translation
	- right-drag panning (inverted screen direction)
- Runtime reset and consistency recovery hooks
- Embeddable class API for host applications

## Quick Start

### Requirements

- Node.js 20+

### Install

```bash
npm install
```

### Run development server

```bash
npm run dev
```

### Production build

```bash
npm run build
```

### Preview production build

```bash
npm run preview
```

## Standalone Mode

`src/main.ts` is a deployable standalone entry.

It mounts `SplatViewerUI` into `#app` in `index.html`.

## Embedding API

Important packaging/runtime notes:

- Experimental package: expect API and build changes while the renderer evolves.
- Worker limitation: `SplatWorker` is instantiated via `new URL("./SplatWorker.ts", import.meta.url)`, so bundler behavior is tied to Vite-compatible worker URL handling.
- Styles: `SplatViewer` is headless and has no UI styles. `SplatViewerUI` expects styles to be provided by the consumer. You can either include your own stylesheet or import the package sheet from `threejs-gs-framework/style.css`.

### 1. Headless viewer (no UI)

Use this when your app already has its own controls/DOM.

```ts
import { SplatViewer } from "./SplatViewer";

const container = document.getElementById("viewer")!;

const viewer = new SplatViewer(container, {
	url: "https://media.reshot.ai/models/nike_next/model.splat",
	background: 0x111111,
	moveSpeed: 3,
	enableWASD: true,
	enableRightDragPan: true,
});

await viewer.waitUntilReady();
viewer.setInstancePercent(100);

// Later
viewer.dispose();
```

`SplatViewer` methods:

- `waitUntilReady(): Promise<void>`
- `setInstancePercent(percent: number): number`
- `reset(reason?: string): void`
- `getStats(): { totalSplats, instanceCount, cameraPosition }`
- `dispose(): void`

### 2. Viewer with built-in overlay UI

Use this when you want a quick ready-made panel and loading/fps overlays.

```ts
import { SplatViewerUI } from "./SplatViewerUI";

const container = document.getElementById("viewer")!;

const viewerUI = new SplatViewerUI(container, {
	url: "https://media.reshot.ai/models/nike_next/model.splat",
	initialPercent: 100,
});

// Later
viewerUI.dispose();
```

## Controls

- Orbit: mouse drag
- Translate: `W`, `A`, `S`, `D`
- Pan: right-click drag
- Reset view: UI reset button

## Project Structure

### Core rendering

- `src/classes/SplatLoader.ts`: parse/load `.splat`
- `src/classes/SplatPacker.ts`: pack splat attributes for GPU texture usage
- `src/classes/SplatGeometry.ts`: create instanced quad geometry + packed texture
- `src/classes/SplatMaterial.ts`: shader material and uniforms
- `src/classes/SplatRenderer.ts`: orchestration, async readiness, sort/update/reset APIs
- `src/classes/SplatWorker.ts`: worker-side depth sort

### Wrappers and app entry

- `src/SplatViewer.ts`: headless embeddable viewer class
- `src/SplatViewerUI.ts`: opt-in overlay UI wrapper around `SplatViewer`
- `src/main.ts`: standalone page bootstrap

### Shaders

- `src/shaders/splat.vert`
- `src/shaders/splat.frag`

## Rendering Pipeline (High Level)

1. Load binary splat buffer.
2. Pack splat data into integer texture storage.
3. Render instanced quads, one per splat.
4. Project covariance to screen-space ellipse in vertex shader.
5. Apply Gaussian falloff in fragment shader.
6. Keep transparent blending stable using worker depth sorting.

## Notes

- This is still a learning project and API surface may change.
- Remote model URLs are subject to CORS/network constraints.
- Performance depends heavily on GPU/browser and splat count.
