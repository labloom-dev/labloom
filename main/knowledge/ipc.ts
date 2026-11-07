import { randomUUID } from "node:crypto";
import { BrowserWindow, dialog, Notification } from "electron";
import { eq } from "drizzle-orm";
import { record, validUUID } from "../../shared/attrs/values";
import { blockText } from "../../shared/content/blocks";
import { knowledgeChannel, knowledgeChanged, saveBeforeClose, saveBeforeCloseReply } from "../../shared/ipc";
import { type AttributeDefinition, type AttributeValue } from "../../shared/types/attributes";
import { type Mutation, type PageKind, type PageQuery } from "../../shared/types/content";
import { type AnchorInput, type ReadingPosition } from "../../shared/types/papers";
import { handle, on } from "../ipc";
import { type Startup } from "../startup/startup";
import { notifications, workspaceMeta } from "../storage/tables";
import { EditHistory } from "./history";
import { PaperService } from "./papers";
import { ReminderService } from "./reminders";
import { KnowledgeService } from "./service";

function string(value: unknown): string {
    if (typeof value !== "string" || value.length > 10000) throw new Error("参数无效。");
    return value;
}
function changed(): void {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(knowledgeChanged);
}

export function registerKnowledgeIPCs(window: BrowserWindow, startup: Startup): void {
    let editorStarted = false;
    let services: { knowledge: KnowledgeService; history: EditHistory; papers: PaperService; reminders: ReminderService } | undefined;
    const get = (): NonNullable<typeof services> => {
        if (services) return services;
        const knowledge = new KnowledgeService(startup.getDatabase());
        const history = new EditHistory(knowledge), papers = new PaperService(knowledge, startup.getPath()), reminders = new ReminderService(knowledge);
        knowledge.onScheduled = (before, after) => reminders.reconcile(before, after);
        services = { knowledge, history, papers, reminders };
        return services;
    };
    handle(window.webContents, knowledgeChannel, async (method, ...args) => {
        const { knowledge: k, history, papers, reminders } = get();
        const [a, b, c] = args;
        let result: unknown;
        switch (method) {
            case "list": return k.list(a as PageQuery | undefined);
            case "get": return k.get(string(a));
            case "definitions": return k.attributes.definitions();
            case "backlinks": return k.backlinks(string(a));
            case "resources": return papers.resources(string(a));
            case "readFile": return papers.read(string(a));
            case "history": return history.state(string(a));
            case "loadTabs": editorStarted = true;
                return k.db.select().from(workspaceMeta).get()?.settings.tabs ?? null;
            case "resolve": {
                if (!record(a) || !validUUID(a.id) || !["page", "block"].includes(String(a.kind))) throw new Error("引用目标无效。");
                if (a.kind === "block") {
                    const block = k.readBlocks().get(a.id);
                    return block ? { title: blockText(block), text: blockText(block), deleted: false, block } : null;
                }
                try {
                    const page = k.get(a.id);
                    return { title: page.title || "未命名", text: page.excerpt, deleted: !!page.attributes.deleted };
                }
                catch {
                    return null;
                }
            }
            case "create": {
                const initial = c ?? {};
                if (!record(initial)) throw new Error("页面属性无效。");
                for (const id of Object.keys(initial)) if (k.attributes.definition(id).metadata.readonly || id === "deleted") throw new Error("内置只读属性不能通过普通新建操作写入。");
                if (a === "annotation") throw new Error("请从文献的原文选择创建批注。");
                const before = k.snapshot();
                result = k.db.$client.transaction(() => {
                    const page = k.create(a as PageKind, b === undefined ? "" : string(b), initial as Record<string, AttributeValue>);
                    reminders.reconcile(before, k.snapshot());
                    return page;
                })();
                break;
            }
            case "mutate": result = k.mutate(a as Mutation, b === undefined ? undefined : string(b));
                break;
            case "define": result = k.setDefinition(string(a), b as AttributeDefinition | null, c === undefined ? undefined : string(c));
                break;
            case "undo":
                if (b !== "undo" && b !== "redo") throw new Error("历史操作无效。");
                result = history.apply(string(a), b, c === undefined ? undefined : string(c));
                break;
            case "closeTab": history.close(string(a));
                return;
            case "saveTabs": {
                if (!record(a) || JSON.stringify(a).length > 1000000 || !Array.isArray(a.groups) || a.groups.length > 32 || !record(a.layout) || typeof a.focusedGroupId !== "string") throw new Error("标签页布局无效。");
                const meta = k.db.select().from(workspaceMeta).get()!;
                k.db.update(workspaceMeta).set({ settings: { ...meta.settings, tabs: a } }).where(eq(workspaceMeta.id, meta.id)).run();
                return;
            }
            case "importPDF": {
                if (a !== undefined) string(a);
                const selection = await dialog.showOpenDialog(window, { properties: ["openFile"], filters: [{ name: "PDF 文献", extensions: ["pdf"] }] });
                if (selection.canceled || !selection.filePaths[0]) return null;
                const path = selection.filePaths[0];
                const match = a === undefined ? papers.matchingPaper(path) : null;
                let reusePageId: string | undefined;
                if (match) {
                    const choice = await dialog.showMessageBox(window, { type: "question", message: `这个附件已关联《${match.title}》。`, buttons: ["打开已有文献", "另建文献页", "取消"], cancelId: 2 });
                    if (choice.response === 2) return null;
                    if (choice.response === 0) reusePageId = match.id;
                }
                result = papers.importFile(path, a as string | undefined, reusePageId);
                break;
            }
            case "position": papers.position(string(a), string(b), c as ReadingPosition);
                return;
            case "highlight": papers.mark(string(a), b as AnchorInput, string(c));
                break;
            case "removeHighlight": papers.removeHighlight(string(a));
                break;
            case "annotate": result = papers.annotate(string(a), b as AnchorInput);
                break;
            case "notices": return k.db.select().from(notifications).all().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
            case "readNotice": k.db.update(notifications).set({ isRead: true }).where(eq(notifications.id, string(a))).run();
                break;
            default: throw new Error("未知工作区操作。");
        }
        changed();
        return result;
    });
    const timer = setInterval(() => {
        if (startup.state.status !== "ready") return;
        try {
            const due = get().reminders.due();
            if (due.length) changed();
            for (const notice of due) if (Notification.isSupported()) new Notification({ title: "知织提醒", body: notice.title }).show();
        }
        catch (error) {
            console.error("Reminder delivery failed", error);
        }
    }, 1000 * 15);
    window.once("closed", () => clearInterval(timer));

    let closeAllowed = false, closeNonce: string | null = null;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    on(window.webContents, saveBeforeCloseReply, (nonce, saved) => {
        if (nonce !== closeNonce) return;
        clearTimeout(deadline);
        closeNonce = null;
        if (saved === true) {
            closeAllowed = true;
            window.close();
        }
    });
    window.on("close", event => {
        if (closeAllowed || !editorStarted || startup.state.status !== "ready") return;
        event.preventDefault();
        if (closeNonce) return;
        closeNonce = randomUUID();
        window.webContents.send(saveBeforeClose, closeNonce);
        deadline = setTimeout(() => {
            closeNonce = null;
            void dialog.showMessageBox(window, { type: "warning", message: "界面未能确认保存完成。", detail: "继续关闭可能丢失尚未保存的输入。", buttons: ["留在应用", "仍然关闭"], defaultId: 0, cancelId: 0 }).then(({ response }) => {
                if (response === 1) {
                    closeAllowed = true;
                    window.close();
                }
            });
        }, 15000);
    });
}