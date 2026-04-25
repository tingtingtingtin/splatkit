export function float16ToFloat32(h: number): number {
  const hs = (h & 0x8000) >> 15;
  const he = (h & 0x7c00) >> 10;
  const hm = h & 0x03ff;
  if (he === 0x1f) return hs ? -Infinity : Infinity;
  if (he === 0) { const val = hm / 1024.0; return hs ? -val : val; }
  const fval = Math.pow(2, he - 15) * (1 + hm / 1024.0);
  return hs ? -fval : fval;
}

export function unpackHalf2x16(x: number): [number, number] {
  return [float16ToFloat32(x & 0xffff), float16ToFloat32((x >>> 16) & 0xffff)];
}

export function mat3Mul(A: number[], B: number[]): number[] {
  return [
    A[0]*B[0] + A[3]*B[1] + A[6]*B[2],
    A[1]*B[0] + A[4]*B[1] + A[7]*B[2],
    A[2]*B[0] + A[5]*B[1] + A[8]*B[2],

    A[0]*B[3] + A[3]*B[4] + A[6]*B[5],
    A[1]*B[3] + A[4]*B[4] + A[7]*B[5],
    A[2]*B[3] + A[5]*B[4] + A[8]*B[5],

    A[0]*B[6] + A[3]*B[7] + A[6]*B[8],
    A[1]*B[6] + A[4]*B[7] + A[7]*B[8],
    A[2]*B[6] + A[5]*B[7] + A[8]*B[8],
  ];
}

export function mat3MulDiag(d: number[]): number[] {
  return [
    d[0], 0, 0,
    0, d[1], 0,
    0, 0, d[2],
  ];
}

export function transpose3(M: number[]): number[] {
  return [
    M[0], M[3], M[6],
    M[1], M[4], M[7],
    M[2], M[5], M[8],
  ];
}

export function quatToMat3(q: [number, number, number, number]): number[] {
  const [w, x, y, z] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    1 - (yy + zz), xy + wz, xz - wy,
    xy - wz, 1 - (xx + zz), yz + wx,
    xz + wy, yz - wx, 1 - (xx + yy),
  ];
}

export function floatToHalf(f: number): number {
  const da = new DataView(new ArrayBuffer(4));
  da.setFloat32(0, f);
  const x = da.getUint32(0);
  const hs = (x >> 16) & 0x8000;
  const hm = (x >> 13) & 0x03ff;
  const he = (x >> 23) & 0xff;
  if (he < 113) return hs;
  if (he > 142) return hs | 0x7c00;
  return (hs | ((he - 112) << 10) | hm) & 0xffff;
}

export function encodeLogScale(s: number): number {
  if (s === 0) return 0;
  const lnScale = Math.log(s);
  const lnScaleMin = -12.0;
  const lnScaleMax = 9.0;
  const lnScaleScale = 254.0 / (lnScaleMax - lnScaleMin);
  const encoded = Math.round(Math.max(0, Math.min(254, (lnScale - lnScaleMin) * lnScaleScale)));
  return encoded + 1;
}

export function encodeQuatSimple(q: [number, number, number, number]): number {
  const x = Math.round((q[0] * 0.5 + 0.5) * 255);
  const y = Math.round((q[1] * 0.5 + 0.5) * 255);
  const z = Math.round((q[2] * 0.5 + 0.5) * 255);
  return x | (y << 8) | (z << 16);
}
