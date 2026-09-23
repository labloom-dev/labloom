import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteStaticCopy } from "vite-plugin-static-copy";

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
        plugins: [
            svelte({ configFile: resolve("configs/svelte.config.js") }),
            // pdf.js fetches these at runtime, see renderer/components/Reader/pdfjs.ts.
            viteStaticCopy({
                targets: [{
                    src: "../node_modules/pdfjs-dist/{cmaps,iccs,standard_fonts,wasm}/*",
                    dest: "pdfjs",
                    rename: { stripBase: 2 }
                }]
            })
        ]
    }
});