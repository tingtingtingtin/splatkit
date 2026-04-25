let positions: Float32Array;
let vertexCount = 0;

self.onmessage = (e: MessageEvent) => {
  const { method, data } = e.data;

  if (method === "setData") {
    // We use the raw buffer from the .splat file
    vertexCount = data.numSplats;
    positions = new Float32Array(data.buffer);
  }

  if (method === "sort") {
    if (!positions) return;
    const { viewMatrix, instanceCount } = data;

    // Only sort the first instanceCount splats — the .splat format stores
    // splats in importance order (scale * opacity), so the first n splats
    // are always the most visually significant ones.
    const targetCount = Math.min(vertexCount, instanceCount);

    const depths = new Int32Array(targetCount);
    let minDepth = 1000000;
    let maxDepth = -1000000;

    // 1. Calculate Depths in Camera Space
    for (let i = 0; i < targetCount; i++) {
      // 32 bytes per splat = 8 floats per splat
      const fOffset = i * 8;
      const x = positions[fOffset + 0];
      const y = positions[fOffset + 1];
      const z = positions[fOffset + 2];

      // Depth = Z-component of position in clip space (negated for back-to-front)
      const d = -(viewMatrix[2] * x + viewMatrix[6] * y + viewMatrix[10] * z) * 4096;
      const depth = d | 0;
      depths[i] = depth;
      if (depth < minDepth) minDepth = depth;
      if (depth > maxDepth) maxDepth = depth;
    }

    // 2. Linear Time Counting Sort
    const depthIndex = new Uint32Array(targetCount);
    const range = 256 * 256;
    const counts = new Uint32Array(range);
    const depthInv = (range - 1) / (maxDepth - minDepth);

    for (let i = 0; i < targetCount; i++) {
      depths[i] = ((depths[i] - minDepth) * depthInv) | 0;
      counts[depths[i]]++;
    }

    // Prefix sum in reverse for descending order (back-to-front)
    for (let i = range - 2; i >= 0; i--) counts[i] += counts[i + 1];

    for (let i = 0; i < targetCount; i++) {
      depthIndex[--counts[depths[i]]] = i;
    }

    self.postMessage(
      { method: "sortDone", depthIndex },
    );
  }
};