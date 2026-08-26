/**
 * esbuild config for browser test bundle.
 * Bundles src/yolo.js + onnxruntime-web into test/yolo_test.bundle.js
 * Copies the ORT WASM binary alongside the bundle.
 */

import { copyFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_SRC = join(
  __dirname, "node_modules", "onnxruntime-web", "dist",
  "ort-wasm-simd-threaded.wasm"
);
const WASM_DEST = join(__dirname, "test", "ort-wasm-simd-threaded.wasm");

export default {
  entryPoints: ["test/yolo_test_entry.mjs"],
  bundle: true,
  outfile: "test/yolo_test.bundle.js",
  platform: "browser",
  format: "esm",
  target: "es2020",
  external: ["chrome"],
  sourcemap: true,
  minify: false,
  outbase: "test",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  plugins: [
    {
      name: "copy-ort-wasm",
      setup(build) {
        build.onEnd(() => {
          if (existsSync(WASM_SRC)) copyFileSync(WASM_SRC, WASM_DEST);
        });
      },
    },
  ],
};
