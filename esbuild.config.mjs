/**
 * esbuild config for browser test bundle
 * Bundles src/yolo.js + onnxruntime-web into test/yolo_test.bundle.js
 */

export default {
  entryPoints: ['test/yolo_test_entry.mjs'],
  bundle: true,
  outfile: 'test/yolo_test.bundle.js',
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  external: ['chrome'], // chrome.runtime not available in browser context
  sourcemap: true,
  minify: false,
  outbase: 'test',
  loader: {
    '.onnx': 'file', // copy .onnx files to output dir if imported
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
};