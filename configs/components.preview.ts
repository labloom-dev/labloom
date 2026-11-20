import { resolve } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
    root: resolve("renderer/preview/components"),
    plugins: [svelte({ configFile: resolve("configs/svelte.config.js") })],
    server: { host: "127.0.0.1", port: 15175, strictPort: true }
});