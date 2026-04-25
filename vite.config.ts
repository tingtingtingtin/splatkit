import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "SplatViewer",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: ["three", "three/examples/jsm/controls/OrbitControls.js"],
    },
  },
});
