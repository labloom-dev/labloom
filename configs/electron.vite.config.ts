import { resolve } from "node:path";
import typia from "@typia/unplugin/vite";
import { defineConfig } from "electron-vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
    main: {
        plugins: [typia({ include: [/[/\\]main[/\\][^/\\]+[/\\]ipc\.ts$/], tsconfig: "configs/tsconfig.node.json" })],
        build: {
            outDir: "dist/main",
            rollupOptions: {
                input: resolve("main/index.ts")
            }
        }
    },
    preload: {
        oxc: {
            // Erase inline type imports so the sandbox does not try to require their modules.
            typescript: { onlyRemoveTypeImports: false }
        },
        build: {
            outDir: "dist/preload",
            rollupOptions: {
                input: resolve("preload/index.ts"),
                output: {
                    // Sandboxed preloads cannot load ES modules.
                    format: "cjs",
                    entryFileNames: "index.cjs"
                }
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