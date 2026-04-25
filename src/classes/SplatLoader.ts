export interface SplatDataBuffers {
  positions: Float32Array;
  scales: Float32Array;
  rotations: Float32Array;
  colorsFloat: Float32Array;
  opacityFloat: Float32Array;
  stride: number;
  numSplats: number;
  headerOffset: number;
}

export interface SplatLoadProgress {
  stage: "fetch";
  loaded: number;
  total?: number;
  progress: number;
}

export class SplatLoader {
  /**
   * Load a .splat file from the given URL and return its raw ArrayBuffer and header info.
   * Header layout (example): first 4 bytes = uint32 number of splats (little-endian)
   * @param url - URL to the .splat file
   * @param signal - optional AbortSignal to cancel the request
   */
  async load(
    url: string,
    signal?: AbortSignal,
    onProgress?: (progress: SplatLoadProgress) => void,
  ): Promise<{ buffer: ArrayBuffer; numSplats: number, parsed: SplatDataBuffers }> {
    const res = await fetch(url, { method: "GET", signal });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }

    const totalHeader = res.headers.get("content-length");
    const total = totalHeader ? Number(totalHeader) : undefined;

    let buffer: ArrayBuffer;
    if (!res.body) {
      buffer = await res.arrayBuffer();
      onProgress?.({
        stage: "fetch",
        loaded: buffer.byteLength,
        total,
        progress: 1,
      });
    } else {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;

      onProgress?.({
        stage: "fetch",
        loaded: 0,
        total,
        progress: 0,
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        if (!value) {
          continue;
        }

        chunks.push(value);
        loaded += value.byteLength;

        onProgress?.({
          stage: "fetch",
          loaded,
          total,
          progress: total ? Math.min(1, loaded / total) : 0,
        });
      }

      const merged = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }

      buffer = merged.buffer;
      onProgress?.({
        stage: "fetch",
        loaded,
        total,
        progress: 1,
      });
    }
    // const dv = new DataView(buffer);

    // if (dv.byteLength < 4) {
    //   throw new Error(`Invalid .splat file: header too small (${dv.byteLength} bytes)`);
    // }

    // Read the number of splats from the first 4 bytes (change endianness if needed)
    // const numSplats = dv.getUint32(0, true);

    if (buffer.byteLength % 32 !== 0) {
      throw new Error(`File size ${buffer.byteLength} is not a multiple of 32!`);
    }
    const numSplats = buffer.byteLength / 32;
    const parsed = SplatLoader.parse(buffer, numSplats);

    return { buffer, numSplats, parsed };
  }

  /**
   * Parse splat binary data into optimized typed arrays.
   * @param buffer - ArrayBuffer containing splat data (including header if any)
   * @param numSplats - number of splats to read
   * @param options - parsing options
   *    - headerOffset: byte offset where splat records start (default 4)
   *    - colorUint8: store colors as `Uint8Array` (3 bytes per splat) when true, otherwise `Float32Array`
   *    - opacityUint8: store opacity as `Uint8Array` (1 byte per splat) when true, otherwise `Float32Array`
   *    - littleEndian: whether float values are little-endian (default true)
   */
  static parse(buffer: ArrayBuffer, numSplats: number): SplatDataBuffers {
    const u8 = new Uint8Array(buffer);
    const f32 = new Float32Array(buffer);

    const positions = new Float32Array(numSplats * 3);
    const scales = new Float32Array(numSplats * 3);
    const rotations = new Float32Array(numSplats * 4);
    const colorsFloat = new Float32Array(numSplats * 3);
    const opacityFloat = new Float32Array(numSplats);

    for (let i = 0; i < numSplats; i++) {
      // 32 bytes per splat = 8 floats per splat
      const fOffset = i * 8; 
      const bOffset = i * 32;

      // Positions (Floats 0, 1, 2)
      positions[i * 3 + 0] = f32[fOffset + 0];
      positions[i * 3 + 1] = f32[fOffset + 1];
      positions[i * 3 + 2] = f32[fOffset + 2];

      // Scales (Floats 3, 4, 5)
      scales[i * 3 + 0] = f32[fOffset + 3];
      scales[i * 3 + 1] = f32[fOffset + 4];
      scales[i * 3 + 2] = f32[fOffset + 5];

      // Color (Bytes 24, 25, 26, 27) - stored in the same word as floats but read as bytes
      colorsFloat[i * 3 + 0] = u8[bOffset + 24] / 255;
      colorsFloat[i * 3 + 1] = u8[bOffset + 25] / 255;
      colorsFloat[i * 3 + 2] = u8[bOffset + 26] / 255;
      opacityFloat[i]      = u8[bOffset + 27] / 255;

      // Rotation (Bytes 28, 29, 30, 31)
      // Packed: (value - 128) / 128
      rotations[i * 4 + 0] = (u8[bOffset + 28] - 128) / 128;
      rotations[i * 4 + 1] = (u8[bOffset + 29] - 128) / 128;
      rotations[i * 4 + 2] = (u8[bOffset + 30] - 128) / 128;
      rotations[i * 4 + 3] = (u8[bOffset + 31] - 128) / 128;
    }

    return {
      positions, scales, rotations, colorsFloat, opacityFloat,
      stride: 32,
      numSplats,
      headerOffset: 0
    };
  }
}