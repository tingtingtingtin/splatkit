import * as THREE from "three";
import vertexShader from "../shaders/splat.vert?raw";
import fragmentShader from "../shaders/splat.frag?raw";

export function createSplatMaterial(): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader,
        fragmentShader,
        uniforms: {
            viewport: { value: new THREE.Vector2() },
            focal: { value: new THREE.Vector2() },
            u_texture: { value: null },
            u_textureSize: { value: new THREE.Vector2(1024, 1024) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrcAlpha: THREE.OneMinusDstAlphaFactor,
        blendDstAlpha: THREE.OneFactor,
        blendEquation: THREE.AddEquation,
        side: THREE.DoubleSide,
    });

    material.onBeforeRender = (renderer, _, camera) => {
        const payload = new THREE.Vector2();
        renderer.getSize(payload);
        material.uniforms.viewport.value.copy(payload);

        // Calculate focal length from projection matrix
        const te = camera.projectionMatrix.elements;
        const fx = (te[0] * payload.x) / 2.0;
        const fy = (te[5] * payload.y) / 2.0;
        material.uniforms.focal.value.set(fx, fy);
    };

    return material;
}
