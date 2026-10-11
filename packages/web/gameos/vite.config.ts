/**
 * GAMEOS PREVIEW MOUNT — dedicated Vite config (PL-033 browser evidence).
 *
 * A separate config (NOT a modification of packages/web/vite.config.ts):
 * the web app config belongs to other lanes; this one only serves the
 * gameos preview mount on its own port with two explicit browser shims
 * (see browser-shims/) for the node builtins the REAL demo snapshot graph
 * transitively imports. Everything else is stock Vite + React.
 *
 * Run (from packages/web):
 *   node ../../node_modules/vite/bin/vite.js --config gameos/vite.config.ts
 * Preview: http://localhost:5174/gameos/ (Vite serves index.html at the
 * root of THIS config: http://localhost:5174/).
 */

import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const HERE = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: HERE,
  plugins: [react()],
  resolve: {
    alias: {
      // REAL sha256 implementation (byte-compatible with node:crypto) so
      // the demo snapshot's digests stay true values in the browser.
      "node:crypto": fileURLToPath(new URL("./browser-shims/node-crypto.ts", import.meta.url)),
      // Import-binding-only shim: the demo never spawns processes.
      "node:child_process": fileURLToPath(new URL("./browser-shims/node-child-process.ts", import.meta.url)),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    // The mount imports workspace source outside this root (game-ui src,
    // root node_modules for React) — allow the whole repo.
    fs: { allow: [fileURLToPath(new URL("../../../", import.meta.url))] },
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
});
