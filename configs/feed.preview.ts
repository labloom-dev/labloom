import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import Database from "better-sqlite3";
import { FeedService } from "../main/feed/service";
import type { FeedQuery, FeedSourceInput } from "../shared/types/feed";
import { arxivURL } from "../shared/utils/feed";

const root = resolve(import.meta.dirname, "..");

export default defineConfig({
    root: resolve(root, "renderer"),
    plugins: [
        svelte({ configFile: resolve(root, "configs/svelte.config.js") }),
        {
            name: "feed-preview",
            async configureServer(server) {
                const folder = resolve(root, ".local/feed-preview");
                mkdirSync(folder, { recursive: true });
                const database = new Database(resolve(folder, "feed.sqlite"));
                database.pragma("foreign_keys = ON");
                const feed = new FeedService(database);
                server.httpServer?.once("close", () => database.close());

                if (!feed.getState({}).sources.length) {
                    try {
                        await feed.saveSource({
                            name: "示例：AI / 机器学习（large language model）",
                            url: arxivURL("cs.AI, cs.LG", "large language model")
                        });
                    }
                    catch (error) {
                        server.config.logger.warn(`示例订阅加载失败，可在页面中手动添加：${error instanceof Error ? error.message : error}`);
                    }
                }

                server.middlewares.use(async (req, res, next) => {
                    if (req.url === "/") {
                        req.url = "/feed-preview.html";
                        return next();
                    }
                    if (req.url !== "/__feed") return next();
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.setHeader("Cache-Control", "no-store");
                    if (req.method !== "POST" || !req.headers["content-type"]?.startsWith("application/json")
                        || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) {
                        res.writeHead(403).end(JSON.stringify({ error: "无效的预览请求。" }));
                        return;
                    }
                    try {
                        let body = "";
                        for await (const chunk of req) {
                            body += chunk;
                            if (Buffer.byteLength(body) > 65536) throw new Error("请求内容过长。");
                        }
                        const { method, args } = JSON.parse(body) as { method: string; args: unknown[]; };
                        if (!Array.isArray(args)) throw new Error("无效的预览参数。");
                        let result: unknown;
                        switch (method) {
                            case "getState": result = feed.getState(args[0] as FeedQuery); break;
                            case "saveSource": result = await feed.saveSource(args[0] as FeedSourceInput); break;
                            case "removeSource": result = feed.removeSource(args[0] as string); break;
                            case "refresh": result = await feed.refresh((args[0] ?? undefined) as string | undefined); break;
                            case "setRead": result = feed.setRead(args[0] as string, args[1] as boolean); break;
                            case "openItem": result = feed.itemURL(args[0] as string); break;
                            default: throw new Error("未知的预览操作。");
                        }
                        res.end(JSON.stringify(result ?? null));
                    }
                    catch (error) {
                        res.writeHead(400).end(JSON.stringify({ error: error instanceof Error ? error.message : "操作失败，请重试。" }));
                    }
                });
            }
        }
    ],
    server: { host: "127.0.0.1", port: 15174, strictPort: true }
});