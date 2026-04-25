import { SplatViewer, type SplatViewerOptions } from "./SplatViewer";

export interface SplatViewerUIOptions extends SplatViewerOptions {
  initialPercent?: number;
}

export class SplatViewerUI {
  public readonly viewer: SplatViewer;

  private readonly container: HTMLElement;
  private readonly loadingOverlay: HTMLDivElement;
  private readonly fpsOverlay: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly percentValue: HTMLSpanElement;
  private readonly percentSlider: HTMLInputElement;
  private readonly instanceCountValue: HTMLSpanElement;
  private readonly cameraPositionValue: HTMLSpanElement;
  private readonly resetButton: HTMLButtonElement;

  private frameCount = 0;
  private lastFpsTime = performance.now();
  private statsAnimationId?: number;

  constructor(container: HTMLElement, options: SplatViewerUIOptions) {
    this.container = container;
    if (getComputedStyle(this.container).position === "static") {
      this.container.style.position = "relative";
    }

    this.viewer = new SplatViewer(container, options);

    this.loadingOverlay = document.createElement("div");
    this.loadingOverlay.className = "splat-ui-loading";
    this.loadingOverlay.textContent = "Loading model...";

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
      this.loadingOverlay.textContent = "Model load failed";
      this.loadingOverlay.classList.add("is-error");
      console.error("[SplatViewerUI] Model load failed", error);
    });
  }

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

  private async initialize(initialPercent: number): Promise<void> {
    await this.viewer.waitUntilReady();
    this.viewer.setInstancePercent(initialPercent);

    this.loadingOverlay.hidden = true;
    this.fpsOverlay.hidden = false;
    this.panel.hidden = false;

    this.updateStats();
    this.updateStatsLoop();
  }

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
