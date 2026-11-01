/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const workletEntry = path.resolve(root, "src/engine/worklet/looper-processor.ts");
const WORKLET_FILE = "looper-processor.js";

async function bundleWorklet(): Promise<string> {
  const built = await esbuild.build({
    absWorkingDir: root,
    entryPoints: [workletEntry],
    bundle: true,
    format: "iife",
    write: false,
    target: "es2022",
    legalComments: "none",
    platform: "browser",
  });
  return built.outputFiles[0]?.text ?? "";
}

/**
 * AudioWorklet scripts are classic scripts. Bundling to IIFE keeps Safari
 * (which still rejects module worklets) from seeing import/export.
 */
function looperWorklet(): Plugin {
  return {
    name: "carbon-looper-worklet",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.endsWith(`/${WORKLET_FILE}`)) {
          next();
          return;
        }
        const code = await bundleWorklet();
        res.setHeader("Content-Type", "application/javascript");
        res.setHeader("Cache-Control", "no-store");
        res.end(code);
      });
    },
    async generateBundle() {
      const code = await bundleWorklet();
      this.emitFile({ type: "asset", fileName: WORKLET_FILE, source: code });
    },
  };
}

export default defineConfig({
  base: "/carbon-cycle/",
  plugins: [
    react(),
    looperWorklet(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Carbon Cycle",
        short_name: "Carbon Cycle",
        description: "Keyboard, five-track loop station, and pocket studio.",
        theme_color: "#090a0c",
        background_color: "#090a0c",
        display: "standalone",
        orientation: "any",
        start_url: "/carbon-cycle/",
        scope: "/carbon-cycle/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
        navigateFallback: "index.html",
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
