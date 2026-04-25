import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SplatRenderer } from "./classes/SplatRenderer";

export interface SplatViewerOptions {
  url: string;
  background?: THREE.ColorRepresentation;
  moveSpeed?: number;
  enableWASD?: boolean;
  enableRightDragPan?: boolean;
}

export class SplatViewer {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly controls: OrbitControls;
  public readonly splatRenderer: SplatRenderer;

  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly initialCameraPosition: THREE.Vector3;
  private readonly initialTarget: THREE.Vector3;
  private readonly moveSpeed: number;
  private readonly enableWASD: boolean;
  private readonly enableRightDragPan: boolean;

  private animationId?: number;
  private consistencyCheckTimeoutId?: number;
  private lastMoveTime = performance.now();

  private moveForward = false;
  private moveBackward = false;
  private moveLeft = false;
  private moveRight = false;

  private isRightDragging = false;
  private lastDragX = 0;
  private lastDragY = 0;

  private readonly worldUp = new THREE.Vector3(0, 1, 0);

  private readonly onControlsChange = () => {
    this.splatRenderer.update();
  };

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!this.enableWASD) {
      return;
    }

    if ((e.target as HTMLElement | null)?.tagName === "INPUT") {
      return;
    }

    const key = e.key.toLowerCase();
    if (key === "w") this.moveForward = true;
    if (key === "s") this.moveBackward = true;
    if (key === "a") this.moveLeft = true;
    if (key === "d") this.moveRight = true;
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    if (!this.enableWASD) {
      return;
    }

    const key = e.key.toLowerCase();
    if (key === "w") this.moveForward = false;
    if (key === "s") this.moveBackward = false;
    if (key === "a") this.moveLeft = false;
    if (key === "d") this.moveRight = false;
  };

  private readonly onContextMenu = (e: MouseEvent) => {
    if (!this.enableRightDragPan) {
      return;
    }

    if (e.target === this.renderer.domElement) {
      e.preventDefault();
    }
  };

  private readonly onMouseDown = (e: MouseEvent) => {
    if (!this.enableRightDragPan || e.button !== 2) {
      return;
    }

    if (e.target !== this.renderer.domElement) {
      return;
    }

    this.isRightDragging = true;
    this.lastDragX = e.clientX;
    this.lastDragY = e.clientY;
    e.preventDefault();
  };

  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.enableRightDragPan || !this.isRightDragging) {
      return;
    }

    const deltaX = e.clientX - this.lastDragX;
    const deltaY = e.clientY - this.lastDragY;
    this.lastDragX = e.clientX;
    this.lastDragY = e.clientY;

    this.panByScreenDelta(deltaX, deltaY);
    this.splatRenderer.update();
  };

  private readonly onMouseUp = (e: MouseEvent) => {
    if (!this.enableRightDragPan) {
      return;
    }

    if (e.button === 2) {
      this.isRightDragging = false;
    }
  };

  constructor(container: HTMLElement, options: SplatViewerOptions) {
    const {
      url,
      background,
      moveSpeed = 3,
      enableWASD = true,
      enableRightDragPan = true,
    } = options;

    this.container = container;
    this.moveSpeed = moveSpeed;
    this.enableWASD = enableWASD;
    this.enableRightDragPan = enableRightDragPan;

    this.scene = new THREE.Scene();
    if (background !== undefined) {
      this.scene.background = new THREE.Color(background);
    }

    const { width, height } = this.getContainerSize();

    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    this.camera.position.z = 3;
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({ alpha: true });
    this.renderer.setClearColor(0xaaaaaa, 0);
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.addEventListener("change", this.onControlsChange);

    this.splatRenderer = new SplatRenderer(url, this.camera);
    this.scene.add(this.splatRenderer.mesh);

    this.initialCameraPosition = this.camera.position.clone();
    this.initialTarget = new THREE.Vector3(0, 0, 0);

    this.resizeObserver = new ResizeObserver(() => {
      this.onResize();
      this.scheduleConsistencyCheck("resize", false);
    });
    this.resizeObserver.observe(this.container);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("contextmenu", this.onContextMenu);
    this.renderer.domElement.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);

    this.animate();
  }

  public waitUntilReady(): Promise<void> {
    return this.splatRenderer.waitUntilReady();
  }

  public setInstancePercent(percent: number): number {
    const totalSplats = this.splatRenderer.getTotalSplats();
    const safePercent = Math.min(100, Math.max(1, Math.round(percent)));
    if (totalSplats <= 0) {
      return 0;
    }

    const instanceCount = Math.max(1, Math.floor((totalSplats * safePercent) / 100));
    this.splatRenderer.setInstanceCount(instanceCount);
    this.scheduleConsistencyCheck("instance-percent-change", false);
    return instanceCount;
  }

  public reset(reason = "manual"): void {
    this.resetCameraPose();
    this.splatRenderer.reset(reason);
  }

  public getStats() {
    return {
      totalSplats: this.splatRenderer.getTotalSplats(),
      instanceCount: this.splatRenderer.getInstanceCount(),
      cameraPosition: this.camera.position.clone(),
    };
  }

  public dispose(): void {
    if (this.animationId !== undefined) {
      cancelAnimationFrame(this.animationId);
      this.animationId = undefined;
    }

    if (this.consistencyCheckTimeoutId !== undefined) {
      window.clearTimeout(this.consistencyCheckTimeoutId);
      this.consistencyCheckTimeoutId = undefined;
    }

    this.resizeObserver.disconnect();
    this.controls.removeEventListener("change", this.onControlsChange);
    this.controls.dispose();

    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("contextmenu", this.onContextMenu);
    this.renderer.domElement.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);

    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private getContainerSize(): { width: number; height: number } {
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    return { width, height };
  }

  private onResize(): void {
    const { width, height } = this.getContainerSize();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  private scheduleConsistencyCheck(reason: string, includeCameraReset: boolean): void {
    if (this.consistencyCheckTimeoutId !== undefined) {
      window.clearTimeout(this.consistencyCheckTimeoutId);
    }

    this.consistencyCheckTimeoutId = window.setTimeout(() => {
      const didReset = this.splatRenderer.verifyStateAndResetIfNeeded();
      if (didReset && includeCameraReset) {
        this.resetCameraPose();
      }
      if (didReset) {
        console.warn(`[SplatViewer] Renderer consistency reset after ${reason}`);
      }
    }, 180);
  }

  private resetCameraPose(): void {
    this.camera.position.copy(this.initialCameraPosition);
    this.controls.target.copy(this.initialTarget);
    this.controls.update();
  }

  private panByScreenDelta(deltaX: number, deltaY: number): void {
    const { height } = this.getContainerSize();
    const toTarget = this.camera.position.distanceTo(this.controls.target);
    const fovRadians = THREE.MathUtils.degToRad(this.camera.fov);
    const worldUnitsPerPixelY = (2 * toTarget * Math.tan(fovRadians / 2)) / height;
    const worldUnitsPerPixelX = worldUnitsPerPixelY * this.camera.aspect;

    const rightAxis = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    const upAxis = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();

    const offset = new THREE.Vector3()
      .addScaledVector(rightAxis, -deltaX * worldUnitsPerPixelX)
      .addScaledVector(upAxis, deltaY * worldUnitsPerPixelY);

    this.camera.position.add(offset);
    this.controls.target.add(offset);
  }

  private animate(): void {
    this.animationId = requestAnimationFrame(() => this.animate());

    const now = performance.now();
    const deltaSeconds = (now - this.lastMoveTime) / 1000;
    this.lastMoveTime = now;

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() > 0) {
      forward.normalize();
    }

    const right = new THREE.Vector3().crossVectors(forward, this.worldUp).normalize();
    const velocity = this.moveSpeed * deltaSeconds;
    let moved = false;

    if (this.enableWASD && this.moveForward) {
      this.camera.position.addScaledVector(forward, velocity);
      this.controls.target.addScaledVector(forward, velocity);
      moved = true;
    }
    if (this.enableWASD && this.moveBackward) {
      this.camera.position.addScaledVector(forward, -velocity);
      this.controls.target.addScaledVector(forward, -velocity);
      moved = true;
    }
    if (this.enableWASD && this.moveLeft) {
      this.camera.position.addScaledVector(right, -velocity);
      this.controls.target.addScaledVector(right, -velocity);
      moved = true;
    }
    if (this.enableWASD && this.moveRight) {
      this.camera.position.addScaledVector(right, velocity);
      this.controls.target.addScaledVector(right, velocity);
      moved = true;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    if (moved) {
      this.splatRenderer.update();
    }
  }
}
