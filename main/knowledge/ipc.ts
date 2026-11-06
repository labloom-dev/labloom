import { dialog, net, shell, type BrowserWindow } from "electron";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import type { PageChanges, Annotation, CreatePageInput, PageQuery, PropertyDefinition, ReadingPosition, SavePageInput, WorkspaceStats } from "../../shared/types/knowledge";
import { knowledgeChannels } from "../../shared/ipc";
import { handle } from "../ipc";
import type { Startup } from "../startup/startup";
import { suspendFeed } from "../feed/ipc";
import { KnowledgeService } from "./service";
import { PaperService, bibTeX, doiMetadata, parseBibTeX } from "./papers";
import { createBackup, restoreBackup, verifyBackup, workspaceBytes } from "./backup";
import { identifier, webURL } from "./document";
import { exportPages } from "./export";
import { scheduleTime } from "../../shared/utils/schedule";

export function registerKnowledgeIPCs(window: BrowserWindow, startup: Startup): void {
    const contents = window.webContents;
    let cached: KnowledgeService | undefined;
    function knowledge(): KnowledgeService {
        const database = startup.getDatabase();
        if (!cached || cached.database !== database) cached = new KnowledgeService(database);
        return cached;
    }
    function root(): string {
        if (startup.state.status !== "ready") throw new Error("请先打开工作区。");
        return startup.state.workspace.path;
    }
    function papers(): PaperService { return new PaperService(knowledge(), root()); }
    let fileOperation = false;
    async function files<T>(action: () => Promise<T>): Promise<T> {
        if (fileOperation) throw new Error("请先完成当前文件操作。");
        fileOperation = true;
        try { return await action(); }
        finally { fileOperation = false; }
    }
    const on = (name: keyof typeof knowledgeChannels, action: (...args: unknown[]) => unknown): void => handle(contents, knowledgeChannels[name], action);
    const settingKey = (value: unknown): string => { if (typeof value !== "string" || !["appearance", "tabs", "overview"].includes(value)) throw new Error("无效的工作区设置。"); return value; };
    on("getSetting", key => { const row = startup.getDatabase().prepare<[string], { value: string }>("SELECT value FROM workspace_settings WHERE key = ?").get(settingKey(key)); return row ? JSON.parse(row.value) : null; });
    on("setSetting", (key, value) => { const name = settingKey(key); const data = JSON.stringify(value); if (!data || data.length > 100000) throw new Error("设置内容过大或无效。"); startup.getDatabase().prepare("INSERT INTO workspace_settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(name, data); });
    on("list", query => knowledge().list(query as PageQuery));
    on("get", id => knowledge().get(id as string));
    on("create", input => knowledge().create(input as CreatePageInput));
    on("updateMany", (ids, changes) => knowledge().updateMany(ids as string[], changes as PageChanges));
    on("save", input => knowledge().save(input as SavePageInput));
    on("trash", ids => knowledge().trash(ids as string[]));
    on("restore", ids => knowledge().restore(ids as string[]));
    on("tags", () => knowledge().tags());
    on("renameTag", (oldName, newName) => knowledge().renameTag(oldName as string, newName as string));
    on("removeTag", name => knowledge().removeTag(name as string));
    on("properties", () => knowledge().properties());
    on("saveProperty", input => knowledge().saveProperty(input as PropertyDefinition));
    on("removeProperty", id => knowledge().removeProperty(id as string));
    on("backlinks", id => knowledge().backlinks(id as string));
    on("visit", id => knowledge().visit(id as string));
    on("clearHistory", id => knowledge().clearHistory(id as string | undefined));
    on("dismissReminder", id => knowledge().dismissReminder(id as string));
    on("attachments", id => papers().attachments(id as string));
    on("readAttachment", id => papers().readAttachment(id as string));
    on("getPosition", id => papers().getPosition(id as string));
    on("setPosition", (id, position) => papers().setPosition(id as string, position as ReadingPosition));
    on("annotationOrigin", id => papers().annotationOrigin(id as string));
    on("annotations", id => papers().annotations(id as string));
    on("annotate", input => papers().annotate(input as Omit<Annotation, "id" | "pageId">));
    on("changeAnnotation", (id, color) => papers().changeAnnotation(id as string, color as string));
    on("importFeed", id => papers().importFeed(id as string));
    on("importDOI", async doi => { const value = await doiMetadata(doi as string, (input, init) => net.fetch(input instanceof URL ? input.href : input, init)); return papers().importMetadata(value.title, value.paper); });
    on("openURL", url => shell.openExternal(webURL(url)));
    on("stats", (): WorkspaceStats => {
        const service = knowledge();
        const now = Date.now();
        const plans = (["task", "event"] as const).flatMap(kind => { const values: ReturnType<KnowledgeService["list"]>["items"] = []; let offset = 0; while (true) { const batch = service.list({ kind, limit: 500, offset }); values.push(...batch.items); offset += batch.items.length; if (offset >= batch.total || !batch.items.length) return values; } });
        const upcoming = plans
            .filter(page => page.schedule && page.schedule.status !== "done" && page.schedule.end && scheduleTime(page.schedule.end, page.schedule.timezone, true) <= now + 7 * 86400000)
            .sort((left, right) => scheduleTime(left.schedule!.end, left.schedule!.timezone, true) - scheduleTime(right.schedule!.end, right.schedule!.timezone, true)).slice(0, 12);
        return { pages: service.list({}).total, papers: service.list({ kind: "paper" }).total, tasks: service.list({ kind: "task" }).total, bytes: workspaceBytes(root()), due: upcoming, recent: service.recent(), notifications: service.reminders() };
    });
    on("importPDF", pageId => files(async () => {
        if (pageId !== undefined) identifier(pageId);
        const selected = await dialog.showOpenDialog(window, { title: pageId ? "为文献添加 PDF 版本" : "导入 PDF 文献", filters: [{ name: "PDF", extensions: ["pdf"] }], properties: ["openFile", "multiSelections"] });
        const result = { pages: [] as ReturnType<KnowledgeService["get"]>[], errors: [] as string[], cancelled: selected.canceled };
        if (selected.canceled) return result;
        for (const path of selected.filePaths) {
            try { result.pages.push(papers().importPDF(path, pageId as string | undefined)); }
            catch (error) { result.errors.push(`${path}：${error instanceof Error ? error.message : "导入失败"}`); }
        }
        return result;
    }));
    on("importBibTeX", () => files(async () => {
        const selected = await dialog.showOpenDialog(window, { title: "导入 BibTeX", filters: [{ name: "BibTeX", extensions: ["bib"] }], properties: ["openFile"] });
        const result = { pages: [] as ReturnType<KnowledgeService["get"]>[], errors: [] as string[], cancelled: selected.canceled };
        if (selected.canceled || !selected.filePaths[0]) return result;
        if (statSync(selected.filePaths[0]).size > 2 * 1024 * 1024) throw new Error("BibTeX 文件不能超过 2 MB。");
        for (const record of parseBibTeX(readFileSync(selected.filePaths[0], "utf8"))) {
            try { result.pages.push(papers().importMetadata(record.title, record.paper)); }
            catch (error) { result.errors.push(`${record.title}：${error instanceof Error ? error.message : "导入失败"}`); }
        }
        return result;
    }));
    on("importImage", () => files(async () => {
        const selected = await dialog.showOpenDialog(window, { title: "插入本地图片", filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }], properties: ["openFile"] });
        if (selected.canceled || !selected.filePaths[0]) return null;
        const path = selected.filePaths[0];
        if (statSync(path).size > 2 * 1024 * 1024) throw new Error("单张图片不能超过 2 MB。");
        const data = readFileSync(path);
        let type = "";
        if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) type = "png";
        else if (data[0] === 255 && data[1] === 216 && data[2] === 255) type = "jpeg";
        else if (/^GIF8[79]a/.test(data.subarray(0, 6).toString())) type = "gif";
        else if (data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP") type = "webp";
        if (!type) throw new Error("图片格式无效。");
        return `data:image/${type};base64,${data.toString("base64")}`;
    }));
    on("exportMarkdown", ids => files(async () => {
        if (!Array.isArray(ids) || !ids.length || ids.length > 500) throw new Error("请选择 1 到 500 个页面。");
        const selected = await dialog.showOpenDialog(window, { title: "选择 Markdown 导出文件夹（包含关联页面与附件）", properties: ["openDirectory", "createDirectory"] });
        if (selected.canceled || !selected.filePaths[0]) return null;
        return exportPages(knowledge(), papers(), root(), selected.filePaths[0], ids);
    }));
    on("exportBibTeX", ids => files(async () => {
        if (!Array.isArray(ids) || !ids.length || ids.length > 500) throw new Error("请选择 1 到 500 篇文献。");
        const records = ids.map(id => knowledge().get(identifier(id)));
        if (records.some(page => page.kind !== "paper")) throw new Error("BibTeX 只能导出文献页面。");
        const selected = await dialog.showSaveDialog(window, { title: "导出 BibTeX", defaultPath: "labloom.bib", filters: [{ name: "BibTeX", extensions: ["bib"] }] });
        if (selected.canceled || !selected.filePath) return null;
        writeFileSync(selected.filePath, bibTeX(records));
        return selected.filePath;
    }));
    on("backup", () => files(async () => {
        const selected = await dialog.showOpenDialog(window, { title: "选择完整备份的保存位置", properties: ["openDirectory", "createDirectory"] });
        if (selected.canceled || !selected.filePaths[0]) return null;
        return createBackup(startup.getDatabase(), root(), selected.filePaths[0]);
    }));
    on("restoreBackup", () => files(async () => {
        const source = await dialog.showOpenDialog(window, { title: "选择含有 manifest.json 的 Labloom 备份文件夹", properties: ["openDirectory"] });
        if (source.canceled || !source.filePaths[0]) return null;
        const manifest = verifyBackup(source.filePaths[0]);
        const confirmed = await dialog.showMessageBox(window, { type: "question", message: `恢复“${manifest.name}”的备份？`, detail: `备份时间：${manifest.createdAt}\n恢复到新的空文件夹，当前工作区保留。恢复完成后将打开恢复的工作区。`, buttons: ["取消", "选择恢复位置"], defaultId: 0, cancelId: 0 });
        if (confirmed.response !== 1) return null;
        const target = await dialog.showOpenDialog(window, { title: "选择空文件夹用于恢复", properties: ["openDirectory", "createDirectory"] });
        if (target.canceled || !target.filePaths[0]) return null;
        const restored = restoreBackup(source.filePaths[0], target.filePaths[0]);
        const resume = await suspendFeed(startup);
        try { startup.switchWorkspace(restored); }
        finally { resume(); }
        return restored;
    }));
}