import { randomUUID } from "node:crypto";
import { BrowserWindow, dialog, Notification } from "electron";
import { desc, eq } from "drizzle-orm";
import { record } from "../../shared/attrs/values";
import { knowledgeChannels as channels, knowledgeChanged, saveBeforeClose, saveBeforeCloseReply } from "../../shared/ipc";
import { type AttributeDefinition, type AttributeValue } from "../../shared/types/attributes";
import { type BlockDeletion, type EditCommit, type KnowledgeChange, type Placement, type Target, type PageKind, type PageQuery } from "../../shared/types/content";
import { type AnchorInput, type ReadingPosition } from "../../shared/types/papers";
import { type FeedLibrary } from "../feed/service";
import { handle, on } from "../ipc";
import { type Startup } from "../startup/startup";
import { type AppStorage } from "../storage/app";
import { notifications, workspaceMeta } from "../storage/tables";
import { EditHistory } from "./history";
import { PaperService } from "./papers";
import { ReminderService } from "./reminders";
import { checkTab, KnowledgeService } from "./service";

function string(value: unknown): string {
    if (typeof value !== "string" || value.length > 10000) throw new Error("参数无效。");
    return value;
}
function changed(change: KnowledgeChange): void {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(knowledgeChanged, change);
}

export function registerKnowledgeIPCs(window: BrowserWindow, startup: Startup, storage: AppStorage): FeedLibrary {
    let editorStarted = false;
    let services: { knowledge: KnowledgeService; history: EditHistory; papers: PaperService; reminders: ReminderService } | undefined;
    const get = (): NonNullable<typeof services> => {
        if (services) return services;
        const knowledge = new KnowledgeService(startup.getDatabase(), () => storage.getAppearance().timeZone);
        const history = new EditHistory(knowledge), papers = new PaperService(knowledge, startup.getPath()), reminders = new ReminderService(knowledge);
        knowledge.onScheduled = changes => reminders.reconcile(changes);
        knowledge.onChanged = publish;
        services = { knowledge, history, papers, reminders };
        return services;
    };
    const ipc = (channel: string, fn: (...args: unknown[]) => unknown): void => handle(window.webContents, channel, fn);
    const optional = (value: unknown): string | undefined => value === undefined ? undefined : string(value);
    const tab = (id: unknown): string => { checkTab(id); return id; };
    function publish(change: KnowledgeChange): void {
        const db = get().knowledge;
        if (change.blocks.length) {
            // A shared paragraph also changes the summaries and search results of its other owners.
            const owners = db.statement(`WITH RECURSIVE owners(kind,id) AS (
                SELECT container_kind,container_id FROM block_uses WHERE block_id IN (SELECT value FROM json_each(?))
                UNION SELECT u.container_kind,u.container_id FROM owners o JOIN block_uses u ON o.kind='block' AND u.block_id=o.id
            ) SELECT id FROM owners WHERE kind='page'`).pluck().all(JSON.stringify(change.blocks)) as string[];
            change.summaryPages = [...new Set([...change.pages, ...owners])];
        }
        const pages = change.summaryPages ?? change.pages;
        if (pages.length) {
            const rows = db.statement("SELECT id,kind FROM pages WHERE id IN (SELECT value FROM json_each(?))").all(JSON.stringify(pages)) as { id: string; kind: PageKind }[];
            change.kinds = Object.fromEntries(rows.map(row => [row.id, row.kind]));
        }
        changed(change);
    }
    const notice = (sourceTab: string, pages: string[] = [], blocks: string[] = []): void => publish({ sourceTab, pages, blocks });
    ipc(channels.list, query => get().knowledge.list(query as PageQuery | undefined));
    ipc(channels.listUpdates, (query, unchanged) => get().knowledge.listUpdates(query as PageQuery, unchanged as string[]));
    ipc(channels.get, id => get().knowledge.get(string(id)));
    ipc(channels.readObjects, (page, ids) => {
        if (!Array.isArray(ids)) throw new Error("读取对象列表无效。");
        return get().knowledge.readObjects(string(page), ids.map(string));
    });
    ipc(channels.previewEdit, input => get().knowledge.previewEdit(input as EditCommit));
    ipc(channels.commitEdit, (input, confirmation) => get().knowledge.commitEdit(input as EditCommit, optional(confirmation)));
    ipc(channels.place, (input, confirmation) => get().knowledge.place(input as Placement, optional(confirmation)));
    ipc(channels.deleteBlock, (input, confirmation) => get().knowledge.deleteBlock(input as BlockDeletion, optional(confirmation)));
    ipc(channels.trash, (ids, source, confirmation) => get().knowledge.trash(ids as string[], tab(source), optional(confirmation)));
    ipc(channels.restore, (ids, source) => get().knowledge.restore(ids as string[], tab(source)));
    ipc(channels.create, (kind, title, initial = {}, parentId, source) => {
        if (!record(initial)) throw new Error("页面属性无效。");
        const k = get().knowledge;
        for (const id of Object.keys(initial)) if (k.attributes.definition(id).metadata.readonly || id === "deleted") throw new Error("不能通过新建操作写入只读属性。");
        if (kind === "annotation") throw new Error("请从文献的原文选择创建批注。");
        return k.create(kind as PageKind, optional(title), initial as Record<string, AttributeValue>, optional(parentId), optional(source));
    });
    ipc(channels.definitions, () => get().knowledge.attributes.definitions());
    ipc(channels.define, (id, input, source, token) => get().knowledge.setDefinition(string(id), input as AttributeDefinition | null, tab(source), optional(token)));
    ipc(channels.resolve, target => get().knowledge.resolve(target as Target));
    ipc(channels.backlinks, id => get().knowledge.backlinks(string(id)));
    ipc(channels.history, id => get().history.state(tab(id)));
    ipc(channels.undo, (id, direction, branch, confirmation) => {
        if (direction !== "undo" && direction !== "redo") throw new Error("历史操作无效。");
        return get().history.apply(tab(id), direction, optional(branch), optional(confirmation));
    });
    ipc(channels.closeTab, id => get().history.close(tab(id)));
    ipc(channels.loadTabs, () => {
        editorStarted = true;
        return get().knowledge.db.select().from(workspaceMeta).get()?.settings.tabs ?? null;
    });
    ipc(channels.saveTabs, value => {
        if (!record(value) || JSON.stringify(value).length > 1000000 || !Array.isArray(value.groups) || value.groups.length > 32 || !record(value.layout) || typeof value.focusedGroupId !== "string") throw new Error("标签页布局无效。");
        const db = get().knowledge.db, meta = db.select().from(workspaceMeta).get()!;
        db.update(workspaceMeta).set({ settings: { ...meta.settings, tabs: value } }).where(eq(workspaceMeta.id, meta.id)).run();
    });
    ipc(channels.importPDF, async (id, source) => {
        const pageId = optional(id), sourceTab = optional(source) ?? "", { papers, knowledge } = get();
        const selection = await dialog.showOpenDialog(window, { properties: ["openFile"], filters: [{ name: "PDF 文献", extensions: ["pdf"] }] });
        if (selection.canceled || !selection.filePaths[0]) return null;
        const path = selection.filePaths[0], match = pageId ? null : papers.matchingPaper(path);
        let reusePageId: string | undefined;
        if (match) {
            const choice = await dialog.showMessageBox(window, { type: "question", message: `这个附件已关联《${match.title}》。`, buttons: ["打开已有文献", "另建文献页", "取消"], cancelId: 2 });
            if (choice.response === 2) return null;
            if (choice.response === 0) reusePageId = match.id;
        }
        const result = papers.importFile(path, pageId, reusePageId);
        if (!result.reused) notice(sourceTab, [result.pageId], pageId ? [] : Object.keys(knowledge.get(result.pageId).blocks));
        return result;
    });
    ipc(channels.resources, id => get().papers.resources(string(id)));
    ipc(channels.readFile, id => get().papers.read(string(id)));
    ipc(channels.getAnchor, id => get().papers.getAnchor(string(id)));
    ipc(channels.unlockPDF, (file, password) => get().papers.unlockPDF(string(file), string(password)));
    ipc(channels.changeHighlight, (id, color, source) => {
        const { papers } = get(), mark = string(id), owners = papers.highlightOwners(mark);
        papers.changeHighlight(mark, string(color));
        notice(optional(source) ?? "", owners);
    });
    ipc(channels.position, (id, file, value, source) => {
        get().papers.position(string(id), string(file), value as ReadingPosition);
        notice(optional(source) ?? "", [string(id)]);
    });
    ipc(channels.highlight, async (id, anchor, color, source) => {
        await get().papers.mark(string(id), anchor as AnchorInput, string(color));
        notice(optional(source) ?? "", [string(id)]);
    });
    ipc(channels.removeHighlight, (id, source, confirmation) => get().papers.removeHighlight(string(id), tab(source), optional(confirmation)));
    ipc(channels.annotate, async (id, anchor, source, color) => {
        const { papers, knowledge } = get();
        const annotation = await papers.annotate(string(id), anchor as AnchorInput | string, optional(color));
        const reference = knowledge.incoming({ kind: "page", id: annotation }).filter(row => row.sourceKind === "block").map(row => row.sourceId);
        notice(optional(source) ?? "", [string(id), annotation], [...reference, ...Object.keys(knowledge.get(annotation).blocks)]);
        return annotation;
    });
    ipc(channels.notices, () => get().knowledge.db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(100).all());
    ipc(channels.readNotice, (id, source) => {
        const db = get().knowledge, sourceTab = tab(source), noticeId = string(id);
        const page = db.statement("SELECT page_id FROM notifications WHERE id=?").pluck().get(noticeId) as string | undefined;
        db.db.update(notifications).set({ isRead: true }).where(eq(notifications.id, noticeId)).run();
        if (page) publish({ sourceTab, pages: [page], blocks: [], notices: true });
    });
    const timer = setInterval(() => {
        if (startup.state.status !== "ready") return;
        try {
            const due = get().reminders.due();
            if (due.length) publish({ sourceTab: "", pages: [...new Set(due.map(n => n.pageId))], blocks: [], notices: true });
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
    // Subscriptions add items to the library through the same services and change notices.
    return {
        createPaper: paper => get().papers.createReference(paper),
        paperState: id => get().papers.state(id),
        announce: id => notice("", [id], Object.keys(get().knowledge.get(id).blocks))
    };
}