precision highp float;
precision highp int;

// Three.js built-ins provided by ShaderMaterial:
// - projectionMatrix
// - modelViewMatrix
// - position (quad vertex in local billboard space)

// Custom uniforms
uniform vec2 viewport;
uniform vec2 focal;
uniform highp usampler2D u_texture;
uniform vec2 u_textureSize;

// Per-instance index into packed texture data
in uint splatIndex;

// Outputs to fragment shader
out vec4 vColor;
out vec3 vPosition;

void main() {
    // ---------------------------------------------------------------------
    // 1) Read packed splat data from integer texture
    // ---------------------------------------------------------------------
    uint globalTexelIndex = splatIndex * 2u;
    uint width = uint(u_textureSize.x);

    ivec2 texPos0 = ivec2(globalTexelIndex % width, globalTexelIndex / width);
    ivec2 texPos1 = ivec2((globalTexelIndex + 1u) % width, (globalTexelIndex + 1u) / width);

    // pixel0 stores center position in xyz
    uvec4 pixel0 = texelFetch(u_texture, texPos0, 0);
    vec3 splatPos = vec3(uintBitsToFloat(pixel0.x), uintBitsToFloat(pixel0.y), uintBitsToFloat(pixel0.z));

    // Move splat center into camera space for culling/projection.
    vec4 camPos = modelViewMatrix * vec4(splatPos, 1.0);
    if (camPos.z > -0.1) {
        // Behind/too close to camera: discard by pushing outside clip volume.
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }

    // pixel1 stores packed covariance and RGBA8 color/opacity.
    uvec4 pixel1 = texelFetch(u_texture, texPos1, 0);
    uint c = pixel1.w;
    float opacity = float(c >> 24) / 255.0;

    if (opacity < 0.01) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }

    // ---------------------------------------------------------------------
    // 2) Project center and apply clip-space culling
    // ---------------------------------------------------------------------
    vec4 clipPos = projectionMatrix * camPos;

    float clip = 1.2 * clipPos.w;
    if (clipPos.z < -clip || abs(clipPos.x) > clip || abs(clipPos.y) > clip) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }

    // ---------------------------------------------------------------------
    // 3) Reconstruct 3D covariance and project to 2D conic space
    // ---------------------------------------------------------------------
    vec2 u1 = unpackHalf2x16(pixel1.x);
    vec2 u2 = unpackHalf2x16(pixel1.y);
    vec2 u3 = unpackHalf2x16(pixel1.z);

    mat3 cov3d = mat3(
        u1.x, u1.y, u2.x,
        u1.y, u2.y, u3.x,
        u2.x, u3.x, u3.y
    );

    // Jacobian of perspective projection at splat center.
    mat3 J = mat3(
        focal.x / camPos.z, 0.0, -(focal.x * camPos.x) / (camPos.z * camPos.z),
        0.0, -focal.y / camPos.z, (focal.y * camPos.y) / (camPos.z * camPos.z),
        0.0, 0.0, 0.0
    );

    // Transform covariance into screen-aligned conic space.
    mat3 T = transpose(mat3(modelViewMatrix)) * J;
    mat3 cov2d = transpose(T) * cov3d * T;

    // Add a small blur term to stabilize tiny splats.
    cov2d[0][0] += 0.3;
    cov2d[1][1] += 0.3;

    // ---------------------------------------------------------------------
    // 4) Eigen decomposition of 2x2 covariance for ellipse axes
    // ---------------------------------------------------------------------
    float b = cov2d[0][1];
    float a = cov2d[0][0] + 0.3;
    float d = cov2d[1][1] + 0.3;
    float mid = (a + d) / 2.0;
    float radius = length(vec2((a - d) / 2.0, b));
    float lambda1 = mid + radius;
    float lambda2 = mid - radius;

    if (lambda2 < 0.0) {
        return;
    }

    // Build orthogonal major/minor axes for stretched billboard.
    vec2 diagonalVector = normalize(vec2(cov2d[0][1], lambda1 - cov2d[0][0]));
    float maxAxis = min(viewport.x, viewport.y) * 0.5;
    vec2 majorAxis = min(sqrt(2.0 * lambda1), maxAxis) * diagonalVector;
    vec2 minorAxis = min(sqrt(2.0 * lambda2), maxAxis) * vec2(diagonalVector.y, -diagonalVector.x);

    // Decode packed RGBA color.
    vColor = vec4(float(c & 0xffu), float((c >> 8) & 0xffu), float((c >> 16) & 0xffu), float(c >> 24)) / 255.0;

    if (vColor.a < (1.0 / 255.0)) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }

    // Keep local quad position for fragment-space Gaussian eval.
    vPosition = position;

    // ---------------------------------------------------------------------
    // 5) Output billboard vertex in NDC around projected splat center
    // ---------------------------------------------------------------------
    vec2 vCenter = clipPos.xy / clipPos.w;
    gl_Position = vec4(
        vCenter
        + position.x * majorAxis / viewport
        + position.y * minorAxis / viewport,
        0.0, 1.0
    );
}