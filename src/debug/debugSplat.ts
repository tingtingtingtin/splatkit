import * as THREE from "three";
import type { SplatDataBuffers } from "../classes/SplatLoader";
import { unpackHalf2x16, mat3Mul, transpose3 } from "../utils/splatMath";

export function debugSplat(
  texData: Uint32Array,
  splatIndex: number,
  modelViewMatrix: THREE.Matrix4,
  projectionMatrix: THREE.Matrix4,
  focal: THREE.Vector2,
  verbose: boolean,
): { lambda1: number; lambda2: number; majorAxisPx: number; camPos: THREE.Vector3; trace3d: number } {
  const p0 = splatIndex * 2 * 4;
  const p1 = splatIndex * 2 * 4 + 4;

  const pixel0 = texData.slice(p0, p0 + 4);
  const pixel1 = texData.slice(p1, p1 + 4);

  const posView = new Float32Array(pixel0.buffer, pixel0.byteOffset, 4);
  const splatPos = new THREE.Vector3(posView[0], posView[1], posView[2]);
  const camPos = splatPos.clone().applyMatrix4(modelViewMatrix);
  const clipPos = camPos.clone().applyMatrix4(projectionMatrix);
  const clip = 1.2;
  const isOffScreen = Math.abs(clipPos.x) > clip || Math.abs(clipPos.y) > clip;

  if (isOffScreen) return { lambda1: 0, lambda2: 0, majorAxisPx: 0, camPos, trace3d: 0 };
  if (camPos.z > -0.1) return { lambda1: 0, lambda2: 0, majorAxisPx: 0, camPos, trace3d: 0 };

  const [u1x, u1y] = unpackHalf2x16(pixel1[0]);
  const [u2x, u2y] = unpackHalf2x16(pixel1[1]);
  const [u3x, u3y] = unpackHalf2x16(pixel1[2]);

  const cov3d = [
    u1x, u1y, u2x,
    u1y, u2y, u3x,
    u2x, u3x, u3y,
  ];

  const x = camPos.x, y = camPos.y, z = camPos.z;
  const z2 = z * z;
  const J = [
    focal.x / z, 0, -(focal.x * x) / z2,
    0, -focal.y / z, (focal.y * y) / z2,
    0, 0, 0,
  ];

  const MV3x3 = new THREE.Matrix3().setFromMatrix4(modelViewMatrix);
  const V = MV3x3.elements;

  const T = mat3Mul(transpose3(V as unknown as number[]), J);
  const cov2d = mat3Mul(mat3Mul(transpose3(T), cov3d), T);

  const a = cov2d[0] + 0.3;
  const d = cov2d[4] + 0.3;
  const b = cov2d[1];
  const mid = (a + d) / 2;
  const radius = Math.sqrt(((a - d) / 2) ** 2 + b * b);
  const lambda1 = mid + radius;
  const lambda2 = mid - radius;
  const majorAxisPx = Math.sqrt(2.0 * lambda1);
  const trace3d = u1x + u2y + u3y;

  if (verbose) {
    console.log("cov3d:", u1x, u1y, u2x, u2y, u3x, u3y);
    console.log("V det:", MV3x3.determinant());
    console.log("V:", ...V);
    console.log("J:", ...J);
    console.log("T:", ...T);
    console.log("cov2d:", cov2d[0], cov2d[4], cov2d[1]);
    console.log("pixel1 raw:", pixel1[0], pixel1[1], pixel1[2], pixel1[3]);
    console.log("pixel1 hex:", pixel1[0].toString(16), pixel1[1].toString(16), pixel1[2].toString(16));
  }
  return { lambda1, lambda2, majorAxisPx, camPos, trace3d };
}

export function debugCurrentView(
  texData: Uint32Array,
  splatData: SplatDataBuffers,
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  geometry: THREE.InstancedBufferGeometry,
): void {
  mesh.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);

  const viewport = new THREE.Vector2(window.innerWidth, window.innerHeight);
  const focal = new THREE.Vector2(
    camera.projectionMatrix.elements[0] * viewport.x / 2,
    camera.projectionMatrix.elements[5] * viewport.y / 2,
  );
  const splatIndexAttr = geometry.getAttribute("splatIndex") as THREE.InstancedBufferAttribute;
  if (!splatIndexAttr) return;

  let explosionCount = 0;
  const limit = geometry.instanceCount;

  for (let i = 0; i < limit; i++) {
    const idx = splatIndexAttr.getX(i);
    const result = debugSplat(
      texData,
      idx,
      mesh.modelViewMatrix,
      camera.projectionMatrix,
      focal,
      false,
    );

    if (result.lambda2 < 0 || isNaN(result.lambda1)) continue;

    if (result.majorAxisPx > 500) {
      debugSplat(texData, idx, mesh.modelViewMatrix, camera.projectionMatrix, focal, true);
      console.warn(`Explosion detected at index ${i}:`, {
        pixelWidth: result.majorAxisPx.toFixed(2),
        zDepth: result.camPos.z.toFixed(4),
        lambda1: result.lambda1.toFixed(2),
        lambda2: result.lambda2.toFixed(2),
        trace3d: result.trace3d.toFixed(4),
      });
      console.log("scale:",
        splatData.scales[idx*3], splatData.scales[idx*3+1], splatData.scales[idx*3+2]);
      console.log("rotation:",
        splatData.rotations[idx*4], splatData.rotations[idx*4+1],
        splatData.rotations[idx*4+2], splatData.rotations[idx*4+3]);
      console.log("position:",
        splatData.positions[idx*3], splatData.positions[idx*3+1], splatData.positions[idx*3+2]);
      explosionCount++;
    }
  }

  if (explosionCount > 0) {
    console.error(`Total exploding splats in current view: ${explosionCount}`);
  } else {
    console.log("what");
  }
}
