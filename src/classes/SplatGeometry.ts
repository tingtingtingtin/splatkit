import * as THREE from "three";
import type { SplatDataBuffers } from "./SplatLoader";
import { packSplat } from "./SplatPacker";

export interface SplatPackProgress {
    stage: "pack";
    packed: number;
    total: number;
    progress: number;
}

/**
 * SplatGeometry - Handles geometry setup and data packing for splat rendering
 */

/**
 * Create and configure instanced geometry from splat data
 */
export async function createSplatGeometry(
    data: SplatDataBuffers,
    instanceCount: number,
    onProgress?: (progress: SplatPackProgress) => void,
): Promise<{
    geometry: THREE.InstancedBufferGeometry;
    texture: THREE.DataTexture;
    textureSize: THREE.Vector2;
    texData: Uint32Array;
}> {
    const geometry = new THREE.InstancedBufferGeometry();
    const WORDS_PER_SPLAT = 2;

    const quad = new Float32Array([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0]);
    geometry.setAttribute("position", new THREE.BufferAttribute(quad, 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

    // Pack splat data into texture (chunked to avoid blocking UI)
    console.log(`[SplatGeometry] Packing ${data.numSplats} splats into texture...`);
    const texWidth = 2048;
    const texHeight = Math.ceil((data.numSplats * WORDS_PER_SPLAT) / texWidth);
    const texData = new Uint32Array(texWidth * texHeight * 4);

    const CHUNK_SIZE = 500; // Process 500 splats at a time

    onProgress?.({
        stage: "pack",
        packed: 0,
        total: data.numSplats,
        progress: 0,
    });

    for (let start = 0; start < data.numSplats; start += CHUNK_SIZE) {
        const end = Math.min(start + CHUNK_SIZE, data.numSplats);
        
        for (let i = start; i < end; i++) {
            const center: [number, number, number] = [
                data.positions[i * 3],
                data.positions[i * 3 + 1],
                data.positions[i * 3 + 2],
            ];
            const scale: [number, number, number] = [
                data.scales[i * 3],
                data.scales[i * 3 + 1],
                data.scales[i * 3 + 2],
            ];
            const rotation: [number, number, number, number] = [
                data.rotations[i * 4],
                data.rotations[i * 4 + 1],
                data.rotations[i * 4 + 2],
                data.rotations[i * 4 + 3],
            ];
            const color: [number, number, number] = [
                data.colorsFloat[i * 3],
                data.colorsFloat[i * 3 + 1],
                data.colorsFloat[i * 3 + 2],
            ];
            const opacity = data.opacityFloat[i];

            const packed = packSplat(center, scale, rotation, color, opacity);
            texData.set(packed, i * WORDS_PER_SPLAT * 4);
        }

        onProgress?.({
            stage: "pack",
            packed: end,
            total: data.numSplats,
            progress: Math.min(1, end / data.numSplats),
        });

        // Yield to browser between chunks
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    console.log(
        `[SplatGeometry] Texture size: ${texWidth} x ${texHeight} (${data.numSplats} splats)`
    );

    const texture = new THREE.DataTexture(
        texData,
        texWidth,
        texHeight,
        THREE.RGBAIntegerFormat,
        THREE.UnsignedIntType
    );
    texture.needsUpdate = true;

    // Set up instanced attribute: just the splat index
    const indexArray = new Uint32Array(data.numSplats);
    for (let i = 0; i < data.numSplats; i++) {
        indexArray[i] = i;
    }
    geometry.setAttribute(
        "splatIndex",
        new THREE.InstancedBufferAttribute(indexArray, 1, false, 1)
    );

    geometry.instanceCount = Math.min(data.numSplats, instanceCount);

    console.log(`[SplatGeometry] Geometry created, instanceCount: ${geometry.instanceCount}`);

    return {
        geometry,
        texture,
        textureSize: new THREE.Vector2(texWidth, texHeight),
        texData,
    };
}