import * as THREE from "three";
import { SplatLoader } from "./SplatLoader";
import type { SplatDataBuffers, SplatLoadProgress } from "./SplatLoader";
import { createSplatGeometry } from "./SplatGeometry";
import type { SplatPackProgress } from "./SplatGeometry";
import { createSplatMaterial } from "./SplatMaterial";
import { debugCurrentView as runDebugCurrentView } from "../debug/debugSplat";

export interface SplatRendererProgress {
  stage: "fetch" | "pack" | "complete";
  progress: number;
  loaded?: number;
  total?: number;
  packed?: number;
  packTotal?: number;
}

export interface SplatRendererOptions {
  onProgress?: (progress: SplatRendererProgress) => void;
}

export class SplatRenderer {
  public mesh: THREE.Mesh;
  public readonly ready: Promise<void>;

  private geometry: THREE.InstancedBufferGeometry;
  private material: THREE.ShaderMaterial;
  private loader: SplatLoader;
  private splatData?: SplatDataBuffers;
  private sourceBuffer?: ArrayBuffer;
  private sourceNumSplats = 0;
  // private texture?: THREE.DataTexture;
  private texData?: Uint32Array;
  private camera: THREE.Camera;

  // Sorting State
  private worker: Worker;
  private isSorting = false;
  private needsSort = false;
  private targetInstanceCount = 270491;
  private onProgress?: (progress: SplatRendererProgress) => void;

  private getDesiredInstanceCount(): number {
    if (!this.splatData) {
      return 0;
    }
    return Math.min(this.splatData.numSplats, this.targetInstanceCount);
  }

  constructor(url: string, camera: THREE.Camera, options?: SplatRendererOptions) {
    this.camera = camera;
    this.onProgress = options?.onProgress;
    this.geometry = new THREE.InstancedBufferGeometry();
    this.material = createSplatMaterial();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.rotation.x = Math.PI;

    this.loader = new SplatLoader();

    this.material.transparent = true;
    this.material.depthWrite = false;
    this.material.blending = THREE.CustomBlending;
    this.material.blendSrc = THREE.OneMinusDstAlphaFactor;
    this.material.blendDst = THREE.OneFactor;
    this.material.blendSrcAlpha = THREE.OneMinusDstAlphaFactor;
    this.material.blendDstAlpha = THREE.OneFactor;

    this.worker = new Worker(new URL("./SplatWorker.ts", import.meta.url));
    this.worker.onmessage = (e) => this.handleWorkerMessage(e);

    this.ready = this.loadAndPrepare(url);
    this.ready.catch((error) => {
      console.error("Failed to load splat data", error);
    });
  }

  public waitUntilReady(): Promise<void> {
    return this.ready;
  }

  private handleWorkerMessage(e: MessageEvent): void {
    if (e.data.method === "sortDone") {
      const { depthIndex } = e.data;
      const desiredInstanceCount = this.getDesiredInstanceCount();

      this.geometry.instanceCount = depthIndex.length;

      const indexAttr = new THREE.InstancedBufferAttribute(depthIndex, 1, false, 1);
      this.geometry.setAttribute("splatIndex", indexAttr);
      indexAttr.needsUpdate = true;

      this.isSorting = false;

      if (this.needsSort || depthIndex.length !== desiredInstanceCount) {
        this.needsSort = false;
        this.update();
      }
    }
  }

  public update(): void {
    if (!this.splatData || this.isSorting) {
      this.needsSort = true;
      return;
    }

    this.camera.updateMatrixWorld();
    this.mesh.updateMatrixWorld();

    const modelViewMatrix = new THREE.Matrix4()
      .multiplyMatrices(this.camera.matrixWorldInverse, this.mesh.matrixWorld);
    const viewProjMatrix = new THREE.Matrix4()
      .multiplyMatrices(this.camera.projectionMatrix, modelViewMatrix);

    const desiredInstanceCount = this.getDesiredInstanceCount();
    if (desiredInstanceCount <= 0) {
      return;
    }

    this.isSorting = true;
    this.worker.postMessage({
      method: "sort",
      data: {
        viewMatrix: viewProjMatrix.elements,
        vertexCount: this.splatData.numSplats,
        instanceCount: desiredInstanceCount
      },
    });
  }

  public setInstanceCount(nextCount: number): void {
    this.targetInstanceCount = Math.max(1, Math.floor(nextCount));

    if (!this.splatData) {
      return;
    }

    this.geometry.instanceCount = this.getDesiredInstanceCount();
    this.update();
  }

  public getInstanceCount(): number {
    return this.geometry.instanceCount;
  }

  public getTotalSplats(): number {
    return this.splatData?.numSplats ?? 0;
  }

  public verifyStateAndResetIfNeeded(): boolean {
    if (!this.splatData) {
      return false;
    }

    const desiredInstanceCount = this.getDesiredInstanceCount();
    const indexAttr = this.geometry.getAttribute("splatIndex") as THREE.InstancedBufferAttribute | undefined;
    const indexCount = indexAttr?.count ?? 0;

    if (this.geometry.instanceCount === desiredInstanceCount && indexCount >= desiredInstanceCount) {
      return false;
    }

    this.reset("consistency-check");
    return true;
  }

  public reset(reason = "manual"): void {
    if (!this.splatData || !this.sourceBuffer) {
      return;
    }

    const desiredInstanceCount = this.getDesiredInstanceCount();
    const indexArray = new Uint32Array(desiredInstanceCount);
    for (let i = 0; i < desiredInstanceCount; i++) {
      indexArray[i] = i;
    }

    this.isSorting = false;
    this.needsSort = false;
    this.geometry.instanceCount = desiredInstanceCount;
    this.geometry.setAttribute("splatIndex", new THREE.InstancedBufferAttribute(indexArray, 1, false, 1));

    this.worker.postMessage({
      method: "setData",
      data: {
        buffer: this.sourceBuffer,
        numSplats: this.sourceNumSplats,
        instanceCount: desiredInstanceCount,
      },
    });

    console.warn(`[SplatRenderer] Reset triggered: ${reason}`);
    this.update();
  }

  private async loadAndPrepare(url: string): Promise<void> {
    console.log(`[SplatRenderer] Loading splat data from: ${url}`);
    try {
      const onFetchProgress = (fetchProgress: SplatLoadProgress) => {
        this.onProgress?.({
          stage: "fetch",
          progress: fetchProgress.progress * 0.5,
          loaded: fetchProgress.loaded,
          total: fetchProgress.total,
        });
      };

      const { buffer, numSplats, parsed } = await this.loader.load(url, undefined, onFetchProgress);
      console.log(`[SplatRenderer] ✓ Loaded ${numSplats} splats`);
      this.splatData = parsed;
      this.sourceBuffer = buffer;
      this.sourceNumSplats = numSplats;

      this.worker.postMessage({
        method: "setData",
        data: {
          buffer: buffer,
          numSplats: numSplats,
          instanceCount: this.geometry.instanceCount
        },
      });

      // Compute centroid
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < parsed.numSplats; i++) {
        cx += parsed.positions[i * 3 + 0];
        cy += parsed.positions[i * 3 + 1];
        cz += parsed.positions[i * 3 + 2];
      }
      cx /= parsed.numSplats;
      cy /= parsed.numSplats;
      cz /= parsed.numSplats;
      this.mesh.position.set(-cx, -cy, -cz);
      console.log("Splat centroid:", cx, cy, cz);

      // Apply rotation first, then position to center after rotation
      this.mesh.rotation.x = Math.PI;
      this.mesh.updateMatrixWorld(true);

      // After rotating X by PI, world-space Y and Z are flipped relative to local space
      // So negate cy and cz to compensate
      this.mesh.position.set(-cx, cy, cz);

      const onPackProgress = (packProgress: SplatPackProgress) => {
        this.onProgress?.({
          stage: "pack",
          progress: 0.5 + packProgress.progress * 0.5,
          packed: packProgress.packed,
          packTotal: packProgress.total,
        });
      };

      const { geometry, texture, textureSize, texData } =
        await createSplatGeometry(parsed, this.targetInstanceCount, onPackProgress);

      this.material.uniforms.u_texture.value = texture;
      this.material.uniforms.u_textureSize.value = textureSize;

      // this.texture = texture;
      this.texData = texData;
      this.geometry = geometry;
      this.mesh.geometry = geometry;

      this.update();

      this.onProgress?.({
        stage: "complete",
        progress: 1,
      });

      console.log(`[SplatRenderer] ✓ Texture created and bound, instanceCount: ${geometry.instanceCount}`);

      this.camera.updateMatrixWorld();
    } catch (error) {
      console.error(`[SplatRenderer] ✗ Failed to load splat data:`, error);
      throw error;
    }
  }

  public debugCurrentView(): void {
    if (!this.texData || !this.splatData) return;
    runDebugCurrentView(this.texData, this.splatData, this.mesh, this.camera, this.geometry);
  }
}
