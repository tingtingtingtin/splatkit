precision highp float;
precision highp int;

// Three.js Built-ins
// uniform mat4 projectionMatrix;
// uniform mat4 modelViewMatrix;
// in vec3 position; // The quad vertices: [-2, 2]

// Custom Uniforms
uniform vec2 viewport;
uniform vec2 focal;
uniform highp usampler2D u_texture;
uniform vec2 u_textureSize;

// Instanced Attribute
in uint splatIndex;

// Outputs to Fragment Shader
out vec4 vColor;
out vec3 vPosition;

void main() {
    uint globalTexelIndex = splatIndex * 2u;
    uint width = uint(u_textureSize.x);
    
    ivec2 texPos0 = ivec2(globalTexelIndex % width, globalTexelIndex / width);
    ivec2 texPos1 = ivec2((globalTexelIndex + 1u) % width, (globalTexelIndex + 1u) / width);

    uvec4 pixel0 = texelFetch(u_texture, texPos0, 0); // Position
    vec3 splatPos = vec3(uintBitsToFloat(pixel0.x), uintBitsToFloat(pixel0.y), uintBitsToFloat(pixel0.z));

    vec4 camPos = modelViewMatrix * vec4(splatPos, 1.0);
    if (camPos.z > -0.1) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }
    
    uvec4 pixel1 = texelFetch(u_texture, texPos1, 0); // Covariance + Color
        uint c = pixel1.w;
    float opacity = float(c >> 24) / 255.0;

    if (opacity < 0.01) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }
    // Transform to Camera Space
    vec4 clipPos = projectionMatrix * camPos;

    float clip = 1.2 * clipPos.w;
    if (clipPos.z < -clip || abs(clipPos.x) > clip || abs(clipPos.y) > clip) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }

    // reconstruct 3d covariance from pixel 1
    vec2 u1 = unpackHalf2x16(pixel1.x); 
    vec2 u2 = unpackHalf2x16(pixel1.y); 
    vec2 u3 = unpackHalf2x16(pixel1.z);
    
    mat3 cov3d = mat3(
        u1.x, u1.y, u2.x, 
        u1.y, u2.y, u3.x, 
        u2.x, u3.x, u3.y
    );

    // complex jacobian
    mat3 V = mat3(modelViewMatrix);
    // mat3 cov3D_view = V * cov3d * transpose(V);

    float invZ = 1.0 / camPos.z;
    float invZ2 = invZ * invZ;

    // mat3 J = mat3(
    //     -(focal.x * invZ),              0.0,                          0.0,
    //     0.0,                           -focal.y * invZ,               0.0,
    //     (focal.x * camPos.x) * invZ2,  -(focal.y * camPos.y) * invZ2, 0.0
    // );

mat3 J = mat3(
    focal.x / camPos.z, 0., -(focal.x * camPos.x) / (camPos.z * camPos.z),
    0., -focal.y / camPos.z, (focal.y * camPos.y) / (camPos.z * camPos.z),
    0., 0., 0.
);

mat3 T = transpose(mat3(modelViewMatrix)) * J;
mat3 cov2d = transpose(T) * cov3d * T;

    // apply blur to prevent antialiasing
    cov2d[0][0] += 0.3;
    cov2d[1][1] += 0.3;

    // eigenvalue decomp
    float b = cov2d[0][1];
float a = cov2d[0][0] + 0.3;
float d = cov2d[1][1] + 0.3;
float mid = (a + d) / 2.0;
float radius = length(vec2((a-d)/2.0, b));
    // float mid = (cov2d[0][0] + cov2d[1][1]) / 2.0;
    // float radius = length(vec2((cov2d[0][0] - cov2d[1][1]) / 2.0, cov2d[0][1]));
    float lambda1 = mid + radius;
    float lambda2 = mid - radius;

    if (lambda2 < 0.0) { return; }

    // Calculate axis vectors for the quad stretching
    vec2 diagonalVector = normalize(vec2(cov2d[0][1], lambda1 - cov2d[0][0]));
    // vec2 eigenvec = vec2(cov2d[0][1], lambda1 - cov2d[0][0]);
    // float eigenvecLen = length(eigenvec);
    float maxAxis = min(viewport.x, viewport.y) * 0.5;
    vec2 majorAxis = min(sqrt(2.0 * lambda1), maxAxis) * diagonalVector;
    vec2 minorAxis = min(sqrt(2.0 * lambda2), maxAxis) * vec2(diagonalVector.y, -diagonalVector.x);

    // vColor = vec4(abs(V[0][0]), abs(V[0][1]), abs(V[0][2]), 1.0);

// float v00 = cov3d[0][0];
// bool hasNaN = (v00 != v00) || (cov3d[0][1] != cov3d[0][1]) || (cov3d[1][1] != cov3d[1][1]);
// bool hasInf = (abs(v00) == 1.0/0.0) || (abs(cov3d[0][1]) == 1.0/0.0);
// vColor = vec4(float(hasInf), float(hasNaN), 0.0, 1.0);

    // float covViewMax = max(max(cov3D_view[0][0], cov3D_view[1][1]), cov3D_view[2][2]);
    // vColor = vec4(clamp(covViewMax / 10.0, 0.0, 1.0), clamp(1.0 - covViewMax / 10.0, 0.0, 1.0), 0.0, 1.0);

//     float covMax = max(max(cov3d[0][0], cov3d[1][1]), cov3d[2][2]);
// vColor = vec4(clamp(covMax / 10.0, 0.0, 1.0), clamp(1.0 - covMax / 10.0, 0.0, 1.0), 0.0, 1.0);

// float covNorm = length(vec3(cov3d[0][0], cov3d[0][1], cov3d[0][2])) 
//               + length(vec3(cov3d[1][0], cov3d[1][1], cov3d[1][2]))
//               + length(vec3(cov3d[2][0], cov3d[2][1], cov3d[2][2]));
// vColor = vec4(clamp(covNorm / 10.0, 0.0, 1.0), clamp(1.0 - covNorm / 10.0, 0.0, 1.0), 0.0, 1.0);
    // float rawMajor = sqrt(2.0 * lambda1);
    // float rawMinor = sqrt(2.0 * lambda2);
    // // Red channel = how close major axis is to hitting the cap
    // vColor = vec4(clamp(rawMajor / 1024.0, 0.0, 1.0), clamp(1.0 - rawMajor / 1024.0, 0.0, 1.0), 0.0, 1.0);
    vColor = vec4(float(c & 0xffu), float((c >> 8) & 0xffu), float((c >> 16) & 0xffu), float(c >> 24)) / 255.0;

    if (vColor.a < (1.0 / 255.0)) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // Send behind the far plane
        return;
    }

    vPosition = position;

    vec2 vCenter = clipPos.xy / clipPos.w;
gl_Position = vec4(
    vCenter
    + position.x * majorAxis / viewport
    + position.y * minorAxis / viewport,
    0.0, 1.0);
    // center in clip space
    // vec2 ndcOffset = (position.x * majorAxis + position.y * minorAxis) / viewport;

    //     float offsetMag = length(ndcOffset);
    // vColor = vec4(
    //     clamp(offsetMag * 10.0, 0.0, 1.0),  // red = large offset
    //     clamp(1.0 - offsetMag * 10.0, 0.0, 1.0),  // green = small offset
    //     0.0,
    //     1.0
    // );

    // gl_Position = vec4((vCenter + ndcOffset) * clipPos.w, clipPos.z, clipPos.w);
}