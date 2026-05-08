import { SplatViewer, type SplatViewerOptions } from "./SplatViewer";
import type { SplatRendererProgress } from "./classes/SplatRenderer";

/** Configuration options for {@link SplatViewerUI}. Extends {@link SplatViewerOptions}. */
export interface SplatViewerUIOptions extends SplatViewerOptions {
  /**
   * Percentage of splats to render on first load (1–100). Values outside this
   * range are clamped. Useful for improving startup performance on large scenes.
   * @defaultValue 100
   */
  initialPercent?: number;
}

/**
 * Batteries-included wrapper around {@link SplatViewer} that adds a built-in
 * loading overlay, FPS counter, instance-density slider, live stats panel, and
 * a reset button — all injected as absolutely-positioned DOM elements inside
 * the given container.
 *
 * CSS class names follow the `splat-ui-*` prefix convention so they can be
 * styled without affecting the rest of the page. The overlay elements are
 * appended to `container`, which is automatically set to `position: relative`
 * if it has `position: static`.
 *
 * If WebGL is unavailable the constructor renders an error message and skips
 * all further initialisation; no `SplatViewer` instance is created.
 *
 * @example
 * ```ts
 * const ui = new SplatViewerUI(document.getElementById("viewer")!, {
 *   url: "/scene.splat",
 *   initialPercent: 75,
 * });
 * // Call dispose() when done to clean up all DOM nodes and GPU resources.
 * ```
 */
export class SplatViewerUI {
  /** The underlying {@link SplatViewer}. `null` when WebGL is unavailable. */
  public readonly viewer: SplatViewer;

  private readonly container: HTMLElement;
  /** Overlay shown during load and on error. Hidden once the scene is ready. */
  private readonly loadingOverlay: HTMLDivElement;
  /** Top-corner overlay displaying a rolling FPS average sampled every 250 ms. */
  private readonly fpsOverlay: HTMLDivElement;
  /** Control panel housing the density slider, stats rows, and reset button. */
  private readonly panel: HTMLDivElement;
  private readonly percentValue: HTMLSpanElement;
  private readonly percentSlider: HTMLInputElement;
  private readonly instanceCountValue: HTMLSpanElement;
  private readonly cameraPositionValue: HTMLSpanElement;
  private readonly resetButton: HTMLButtonElement;

  private frameCount = 0;
  private lastFpsTime = performance.now();
  private statsAnimationId?: number;
  /** Monotonically-increasing load progress (0–1) used to avoid backwards jumps in the overlay text. */
  private latestProgress = 0;
  private readonly externalOnProgress?: SplatViewerOptions["onProgress"];

  /**
   * Creates a new `SplatViewerUI`, injects all overlay elements into
   * `container`, and begins streaming the splat file.
   *
   * @param container - Host element. Must be in the DOM before this call.
   * @param options - Viewer and UI configuration. See {@link SplatViewerUIOptions}.
   */
  constructor(container: HTMLElement, options: SplatViewerUIOptions) {
    this.container = container;
    if (getComputedStyle(this.container).position === "static") {
      this.container.style.position = "relative";
    }

    // Detect WebGL support before creating the renderer to show a friendly
    // error rather than a cryptic Three.js failure.
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) {
      this.loadingOverlay = document.createElement("div");
      this.loadingOverlay.className = "splat-ui-loading is-error";
      this.loadingOverlay.textContent =
        "WebGL is not available. Enable hardware acceleration in your browser settings.";
      container.appendChild(this.loadingOverlay);
      // Satisfy TypeScript's definite-assignment checks for readonly fields.
      this.viewer = null!;
      this.fpsOverlay = null!;
      this.panel = null!;
      this.percentValue = null!;
      this.percentSlider = null!;
      this.instanceCountValue = null!;
      this.cameraPositionValue = null!;
      this.resetButton = null!;
      return;
    }

    this.externalOnProgress = options.onProgress;

    this.viewer = new SplatViewer(container, {
      ...options,
      onProgress: (progress) => {
        this.onLoadProgress(progress);
        this.externalOnProgress?.(progress);
      },
      onContextLost: () => {
        this.loadingOverlay.textContent = "WebGL context lost. Reload the page to continue.";
        this.loadingOverlay.classList.add("is-error");
        this.loadingOverlay.hidden = false;
      },
    });

    this.loadingOverlay = document.createElement("div");
    this.loadingOverlay.className = "splat-ui-loading";
    this.loadingOverlay.textContent = "Loading model... 0%";

    this.fpsOverlay = document.createElement("div");
    this.fpsOverlay.className = "splat-ui-fps";
    this.fpsOverlay.hidden = true;
    this.fpsOverlay.textContent = "FPS: --";

    this.panel = document.createElement("div");
    this.panel.className = "splat-ui-panel";
    this.panel.hidden = true;

    const label = document.createElement("label");
    label.className = "splat-ui-label";
    label.textContent = "Instance density: ";

    this.percentValue = document.createElement("span");
    this.percentValue.textContent = "100%";
    label.appendChild(this.percentValue);

    this.percentSlider = document.createElement("input");
    this.percentSlider.type = "range";
    this.percentSlider.min = "1";
    this.percentSlider.max = "100";
    this.percentSlider.step = "1";
    const initialPercent = Math.min(100, Math.max(1, Math.round(options.initialPercent ?? 100)));
    this.percentSlider.value = String(initialPercent);

    const stats = document.createElement("div");
    stats.className = "splat-ui-stats";

    const instanceRow = document.createElement("div");
    instanceRow.textContent = "Instance count: ";
    this.instanceCountValue = document.createElement("span");
    this.instanceCountValue.textContent = "--";
    instanceRow.appendChild(this.instanceCountValue);

    const cameraRow = document.createElement("div");
    cameraRow.textContent = "Camera position: ";
    this.cameraPositionValue = document.createElement("span");
    this.cameraPositionValue.textContent = "--";
    cameraRow.appendChild(this.cameraPositionValue);

    stats.appendChild(instanceRow);
    stats.appendChild(cameraRow);

    this.resetButton = document.createElement("button");
    this.resetButton.type = "button";
    this.resetButton.className = "splat-ui-reset";
    this.resetButton.textContent = "Reset";

    this.panel.appendChild(label);
    this.panel.appendChild(this.percentSlider);
    this.panel.appendChild(stats);
    this.panel.appendChild(this.resetButton);

    this.container.appendChild(this.loadingOverlay);
    this.container.appendChild(this.fpsOverlay);
    this.container.appendChild(this.panel);

    this.percentSlider.addEventListener("input", this.onSliderInput);
    this.resetButton.addEventListener("click", this.onResetClick);

    this.initialize(initialPercent).catch((error) => {
      this.loadingOverlay.textContent = this.describeLoadError(error);
      this.loadingOverlay.classList.add("is-error");
      console.error("[SplatViewerUI] Model load failed", error);
    });
  }

  /**
   * Tears down all UI elements and the underlying {@link SplatViewer}.
   *
   * Cancels the stats animation loop, removes event listeners, detaches overlay
   * DOM nodes, and forwards to `viewer.dispose()`. After calling `dispose`,
   * this instance must not be used.
   */
  public dispose(): void {
    if (this.statsAnimationId !== undefined) {
      cancelAnimationFrame(this.statsAnimationId);
      this.statsAnimationId = undefined;
    }

    this.percentSlider.removeEventListener("input", this.onSliderInput);
    this.resetButton.removeEventListener("click", this.onResetClick);

    this.loadingOverlay.remove();
    this.fpsOverlay.remove();
    this.panel.remove();

    this.viewer.dispose();
  }

  private readonly onSliderInput = () => {
    const percent = Math.min(100, Math.max(1, Math.round(Number(this.percentSlider.value) || 1)));
    this.percentSlider.value = String(percent);
    this.percentValue.textContent = `${percent}%`;
    this.viewer.setInstancePercent(percent);
    this.updateStats();
  };

  private readonly onResetClick = () => {
    this.viewer.reset("user-reset-button");
    this.updateStats();
  };

  /** Waits for the scene to finish loading, then reveals the panel and starts the stats loop. */
  private async initialize(initialPercent: number): Promise<void> {
    await this.viewer.waitUntilReady();
    this.viewer.setInstancePercent(initialPercent);

    this.loadingOverlay.hidden = true;
    this.fpsOverlay.hidden = false;
    this.panel.hidden = false;

    this.updateStats();
    this.updateStatsLoop();
  }

  /** Updates the loading overlay text with stage-specific progress detail (fetch bytes or pack splat count). */
  private onLoadProgress(progress: SplatRendererProgress): void {
    this.latestProgress = Math.max(this.latestProgress, progress.progress);
    const percentText = `${Math.round(this.latestProgress * 100)}%`;

    if (progress.stage === "fetch") {
      const loadedText = this.formatBytes(progress.loaded ?? 0);
      const totalText = progress.total ? this.formatBytes(progress.total) : "unknown";
      this.loadingOverlay.textContent = `Loading model (fetch)... ${percentText} (${loadedText} / ${totalText})`;
      return;
    }

    if (progress.stage === "pack") {
      const packed = progress.packed ?? 0;
      const total = progress.packTotal ?? 0;
      this.loadingOverlay.textContent = `Preparing model (pack)... ${percentText} (${packed.toLocaleString()} / ${total.toLocaleString()} splats)`;
      return;
    }

    this.loadingOverlay.textContent = "Loading complete";
  }

  /**
   * Converts a raw fetch/parse error into a user-friendly message.
   * Recognises common patterns (404, CORS, network failures) and falls back to
   * a generic string for anything else.
   */
  private describeLoadError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);

    if (/\b404\b/.test(message)) {
      return "Model load failed: 404 (file not found).";
    }

    // Browser fetch failures often surface CORS and network failures under generic TypeError text.
    if (/failed to fetch|networkerror|cors|cross-origin/i.test(message)) {
      return "Model load failed: CORS/network error. Check server headers and URL.";
    }

    return "Model load failed.";
  }

  /** Formats a byte count as a human-readable string (e.g. `"3.2 MB"`). */
  private formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return "0 B";
    }

    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    const precision = unitIndex === 0 ? 0 : 1;
    return `${value.toFixed(precision)} ${units[unitIndex]}`;
  }

  /** `rAF`-driven loop that refreshes the FPS counter every 250 ms and keeps the stats panel current. */
  private updateStatsLoop(): void {
    this.statsAnimationId = requestAnimationFrame(() => this.updateStatsLoop());

    const now = performance.now();
    this.frameCount++;
    if (now - this.lastFpsTime >= 250) {
      const fps = (this.frameCount * 1000) / (now - this.lastFpsTime);
      this.fpsOverlay.textContent = `FPS: ${fps.toFixed(1)}`;
      this.frameCount = 0;
      this.lastFpsTime = now;
    }

    this.updateStats();
  }

  /** Pulls the latest stats from the viewer and writes them into the panel DOM nodes. */
  private updateStats(): void {
    const stats = this.viewer.getStats();
    if (stats.totalSplats > 0) {
      this.instanceCountValue.textContent = `${stats.instanceCount.toLocaleString()} / ${stats.totalSplats.toLocaleString()}`;
    } else {
      this.instanceCountValue.textContent = "--";
    }

    this.cameraPositionValue.textContent = `(${stats.cameraPosition.x.toFixed(2)}, ${stats.cameraPosition.y.toFixed(2)}, ${stats.cameraPosition.z.toFixed(2)})`;
  }
}
