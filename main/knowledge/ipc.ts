import { LabloomError } from "../../shared/failure";
import { randomUUID } from "node:crypto";
import { BrowserWindow, dialog, net, shell } from "electron";
import { eq } from "drizzle-orm";
import { record } from "../../shared/attrs/values";
import { feedChanged, knowledgeChannels as channels, knowledgeChanged, saveBeforeClose, saveBeforeCloseReply } from "../../shared/ipc";
import { type AttributeDefinition, type AttributeValue } from "../../shared/types/attributes";
import { type BlockDeletion, type EditCommit, type KnowledgeChange, type Placement, type Target, type PageKind, type PageQuery } from "../../shared/types/content";
import { type AnnotationInput, type ReadingPosition } from "../../shared/types/papers";
import { type FeedLibrary } from "../feed/service";
import { importFeedPDF } from "../feed/pdf";
import { handle, on } from "../ipc";
import { type Startup } from "../startup/startup";
import { type AppStorage } from "../storage/app";
import { workspaceMeta } from "../storage/tables";
import { EditHistory } from "./history";
import { PaperService } from "./papers";
import { PurgeService } from "./purge";
import { type TimerService } from "./timers";
import { checkTab, KnowledgeService } from "./service";
import { t } from "../ui/i18n";

function string(value: unknown): string {
    if (typeof value !== "string" || value.length > 10000) throw new LabloomError({ kind: "invalid-argument" });
    return value;
}
function changed(change: KnowledgeChange): void {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(knowledgeChanged, change);
}

export function registerKnowledgeIPCs(window: BrowserWindow, startup: Startup, storage: AppStorage): FeedLibrary & { getTimers: () => TimerService } {
    let editorStarted = false;
    let services: { knowledge: KnowledgeService; history: EditHistory; papers: PaperService } | undefined;
    const get = (): NonNullable<typeof services> => {
        if (services) return services;
        const knowledge = new KnowledgeService(startup.getDatabase(), () => storage.getAppearance().timeZone);
        const history = new EditHistory(knowledge), papers = new PaperService(knowledge, startup.getPath());
        knowledge.onChanged = publish;
        services = { knowledge, history, papers };
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
                SELECT container_kind,container_id FROM sync_refs WHERE block_id IN (SELECT value FROM json_each(?))
                UNION SELECT u.container_kind,u.container_id FROM owners o JOIN sync_refs u ON o.kind='block' AND u.block_id=o.id
            ) SELECT id FROM owners WHERE kind='page'`).pluck().all(JSON.stringify(change.blocks)) as string[];
            change.summaryPages = [...new Set([...change.pages, ...owners])];
        }
        const pages = change.summaryPages ?? change.pages;
        if (pages.length) {
            const rows = db.statement("SELECT id,kind FROM pages WHERE id IN (SELECT value FROM json_each(?))").all(JSON.stringify(pages)) as { id: string; kind: PageKind }[];
            change.kinds = Object.fromEntries(rows.map(row => [row.id, row.kind]));
        }
        changed(change);
        if (Object.values(change.kinds ?? {}).includes("feed") || change.purged?.length) for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(feedChanged);
    }
    const notice = (sourceTab: string, pages: string[] = [], blocks: string[] = []): void => publish({ sourceTab, pages, blocks });
    ipc(channels.list, query => get().knowledge.list(query as PageQuery | undefined));
    ipc(channels.listUpdates, (query, unchanged) => get().knowledge.listUpdates(query as PageQuery, unchanged as string[]));
    ipc(channels.get, async id => {
        const { knowledge, papers } = get(), pageId = string(id);
        if (knowledge.header(pageId).kind === "annotation" && !knowledge.flags(pageId).deleted) await papers.getAnnotation(pageId);
        return knowledge.get(pageId);
    });
    ipc(channels.readObjects, (page, ids) => {
        if (!Array.isArray(ids)) throw new LabloomError({ kind: "page-invalid-objects" });
        return get().knowledge.readObjects(string(page), ids.map(string));
    });
    ipc(channels.previewEdit, input => get().knowledge.previewEdit(input as EditCommit));
    ipc(channels.commitEdit, (input, confirmation) => get().knowledge.commitEdit(input as EditCommit, optional(confirmation)));
    ipc(channels.place, (input, confirmation) => get().knowledge.place(input as Placement, optional(confirmation)));
    ipc(channels.deleteBlock, (input, confirmation) => get().knowledge.deleteBlock(input as BlockDeletion, optional(confirmation)));
    ipc(channels.trash, (ids, source, confirmation) => get().knowledge.trash(ids as string[], tab(source), optional(confirmation)));
    ipc(channels.restore, (ids, source) => get().knowledge.restore(ids as string[], tab(source)));
    const purge = (): PurgeService => new PurgeService(get().knowledge, get().history, startup.getPath());
    ipc(channels.purge, (ids, source, confirmation) => purge().purge(ids as string[], tab(source), optional(confirmation)));
    ipc(channels.emptyTrash, (source, confirmation) => purge().purge(null, tab(source), optional(confirmation)));
    ipc(channels.create, (kind, title, initial = {}, parentId, source) => {
        if (!record(initial)) throw new LabloomError({ kind: "page-invalid-attributes" });
        const k = get().knowledge;
        for (const id of Object.keys(initial)) if (k.attributes.definition(id).readonly || id === "deleted") throw new LabloomError({ kind: "page-create-readonly" });
        if (kind === "annotation") throw new LabloomError({ kind: "annotation-selection-required" });
        return k.create(kind as PageKind, optional(title), initial as Record<string, AttributeValue>, optional(parentId), optional(source));
    });
    ipc(channels.definitions, () => get().knowledge.attributes.definitions());
    ipc(channels.define, (id, input, source, token) => get().knowledge.setDefinition(string(id), input as AttributeDefinition | null, tab(source), optional(token)));
    ipc(channels.resolve, target => get().knowledge.resolve(target as Target));
    ipc(channels.backlinks, id => get().knowledge.backlinks(string(id)));
    ipc(channels.history, id => get().history.state(tab(id)));
    ipc(channels.undo, (id, direction, branch, confirmation) => {
        if (direction !== "undo" && direction !== "redo") throw new LabloomError({ kind: "history-invalid-action" });
        return get().history.apply(tab(id), direction, optional(branch), optional(confirmation));
    });
    ipc(channels.closeTab, id => get().history.close(tab(id)));
    ipc(channels.loadTabs, () => {
        editorStarted = true;
        return get().knowledge.db.select().from(workspaceMeta).get()?.settings.tabs ?? null;
    });
    ipc(channels.saveTabs, value => {
        if (!record(value) || JSON.stringify(value).length > 1000000 || !Array.isArray(value.groups) || value.groups.length > 32 || !record(value.layout) || typeof value.focusedGroupId !== "string") throw new LabloomError({ kind: "tabs-invalid-layout" });
        const db = get().knowledge.db, meta = db.select().from(workspaceMeta).get()!;
        db.update(workspaceMeta).set({ settings: { ...meta.settings, tabs: value } }).where(eq(workspaceMeta.id, meta.id)).run();
    });
    ipc(channels.importPDF, async (id, source) => {
        const pageId = optional(id), sourceTab = optional(source) ?? "", { papers, knowledge } = get();
        const selection = await dialog.showOpenDialog(window, { properties: ["openFile"], filters: [{ name: t("dialog.pdfFilter"), extensions: ["pdf"] }] });
        if (selection.canceled || !selection.filePaths[0]) return null;
        const result = papers.importFile(selection.filePaths[0], pageId, sourceTab || undefined);
        notice(sourceTab, [result.pageId], pageId ? [] : Object.keys(knowledge.get(result.pageId).blocks));
        return result;
    });
    ipc(channels.importFiles, async (id, attribute, source) => {
        const pageId = string(id), attributeId = string(attribute), sourceTab = tab(source), { papers, knowledge } = get();
        const definition = knowledge.attributes.definition(attributeId);
        if (definition.type !== "file" && definition.type !== "files") throw new LabloomError({ kind: "attribute-file-required" });
        const selection = await dialog.showOpenDialog(window, { properties: definition.type === "files" ? ["openFile", "multiSelections"] : ["openFile"] });
        if (selection.canceled || !selection.filePaths.length) return null;
        const files = papers.attachFiles(selection.filePaths, pageId, attributeId, sourceTab);
        notice(sourceTab, [pageId]);
        return files;
    });
    ipc(channels.files, ids => get().papers.files(ids as string[] | undefined));
    ipc(channels.openFile, async id => {
        const error = await shell.openPath(get().papers.externalPath(string(id)));
        if (error) throw new LabloomError({ kind: "attachment-open-failed", diagnostic: error });
    });
    ipc(channels.resources, id => get().papers.resources(string(id)));
    ipc(channels.readFile, id => get().papers.read(string(id)));
    ipc(channels.getAnnotation, id => get().papers.getAnnotation(string(id)));
    ipc(channels.unlockPDF, (file, password) => get().papers.unlockPDF(string(file), string(password)));
    ipc(channels.changeAnnotation, (id, color, source) => get().papers.changeAnnotation(string(id), string(color), tab(source)));
    ipc(channels.position, (id, file, value, source) => {
        get().papers.position(string(id), string(file), value as ReadingPosition);
        notice(optional(source) ?? "", [string(id)]);
    });
    ipc(channels.deleteAnnotation, (id, source, confirmation) => get().papers.deleteAnnotation(string(id), tab(source), optional(confirmation)));
    ipc(channels.annotate, async (id, value, source, color) => {
        const { papers, knowledge } = get(), sourceTab = tab(source);
        const annotation = await papers.annotate(string(id), value as AnnotationInput | string, sourceTab, optional(color));
        notice(sourceTab, [string(id), annotation], Object.keys(knowledge.get(annotation).blocks));
        return annotation;
    });
    ipc(channels.notices, () => get().knowledge.timers.notices());
    ipc(channels.timers, id => get().knowledge.timers.settings(string(id)));
    ipc(channels.setTimer, (id, attr, lead, enabled, source) => {
        const pageId = string(id), sourceTab = tab(source);
        get().knowledge.timers.set(pageId, string(attr), lead as number, enabled as boolean);
        publish({ sourceTab, pages: [pageId], blocks: [], notices: true });
    });
    ipc(channels.readNotice, (id, attr, lead, source) => {
        const pageId = string(id), sourceTab = tab(source);
        get().knowledge.timers.read(pageId, string(attr), lead as number);
        publish({ sourceTab, pages: [pageId], blocks: [], notices: true });
    });

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
            void dialog.showMessageBox(window, { type: "warning", message: t("dialog.closeTimeout"), detail: t("dialog.closeTimeoutDetail"), buttons: [t("dialog.stay"), t("dialog.closeAnyway")], defaultId: 0, cancelId: 0 }).then(({ response }) => {
                if (response === 1) {
                    closeAllowed = true;
                    window.close();
                }
            });
        }, 15000);
    });
    // Subscriptions add items to the library through the same services and change notices.
    return {
        getTimers: () => get().knowledge.timers,
        createPaper: paper => get().papers.createReference(paper),
        paperState: id => get().papers.state(id),
        hasPDF: id => get().papers.hasPDF(id),
        importPDF: (id, url) => importFeedPDF(url, path => {
            get().papers.importFile(path, id);
            notice("", [id]);
        }, net.fetch),
        announce: id => notice("", [id], Object.keys(get().knowledge.get(id).blocks))
    };
}