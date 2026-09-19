import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
    main: {
        build: {
            outDir: "dist/main",
            rollupOptions: {
                input: resolve("main/index.ts")
            }
        }
    },
    preload: {
        build: {
            outDir: "dist/preload",
            rollupOptions: {
                input: resolve("preload/index.ts")
            }
        }
    },
    renderer: {
        root: "renderer",
        server: {
            port: 15173
        },
        build: {
            outDir: "dist/renderer",
            rollupOptions: {
                input: resolve("renderer/index.html")
            }
        },
        plugins: [svelte({ configFile: resolve("configs/svelte.config.js") })]
    }
});