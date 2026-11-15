import { type BrowserWindow, dialog, shell } from "electron";
import { LabloomError } from "../../shared/failure";
import { knowledgeChannels as channels } from "../../shared/ipc";
import { type AttributeDefinition, type AttributeValue } from "../../shared/types/attributes";
import { type BlockDeletion, type EditCommit, type PageKind, type PageQuery, type Placement, type Target } from "../../shared/types/content";
import { type AnnotationInput, type ReadingPosition } from "../../shared/types/papers";
import { handle } from "../ipc";
import * as workspaceSettings from "../workspace-settings";
import * as lifecycle from "../lifecycle";
import { t } from "../ui/i18n";
import * as attributes from "./attributes";
import * as edits from "./edits";
import * as history from "./history";
import * as papers from "./papers";
import * as purge from "./purge";
import * as knowledge from "./records";
import * as timers from "./timers";
import { checkTab } from "./validation";

function string(value: unknown): string {
    if (typeof value !== "string" || value.length > 10000) throw new LabloomError({ kind: "invalid-argument" });
    return value;
}
export function registerKnowledgeIPCs(window: BrowserWindow): void {
    const ipc = (channel: string, fn: (...args: unknown[]) => unknown): void => handle(window.webContents, channel, fn);
    const optional = (value: unknown): string | undefined => value === undefined ? undefined : string(value);
    const tab = (id: unknown): string => {
        checkTab(id); return id;
    };
    ipc(channels.list, query => knowledge.list(query as PageQuery | undefined));
    ipc(channels.listUpdates, (query, unchanged) => knowledge.listUpdates(query as PageQuery, unchanged as string[]));
    ipc(channels.get, id => papers.get(string(id)));
    ipc(channels.readObjects, (page, ids) => {
        if (!Array.isArray(ids)) throw new LabloomError({ kind: "page-invalid-objects" });
        return knowledge.readObjects(string(page), ids.map(string));
    });
    ipc(channels.previewEdit, input => edits.previewEdit(input as EditCommit));
    ipc(channels.syncBlocks, (workspace, ids) => {
        if (!Array.isArray(ids)) throw new LabloomError({ kind: "page-invalid-objects" });
        return edits.syncBlocks(string(workspace), ids.map(string));
    });
    ipc(channels.commitEdit, (input, confirmation) => edits.commitEdit(input as EditCommit, optional(confirmation)));
    ipc(channels.place, (input, confirmation) => edits.place(input as Placement, optional(confirmation)));
    ipc(channels.deleteBlock, (input, confirmation) => edits.deleteBlock(input as BlockDeletion, optional(confirmation)));
    ipc(channels.trash, (ids, source, confirmation) => edits.trash(ids as string[], tab(source), optional(confirmation)));
    ipc(channels.restore, (ids, source) => edits.restore(ids as string[], tab(source)));
    ipc(channels.purge, (ids, source, confirmation) => purge.purge(ids as string[], tab(source), optional(confirmation)));
    ipc(channels.emptyTrash, (source, confirmation) => purge.purge(null, tab(source), optional(confirmation)));
    ipc(channels.create, (kind, title, initial = {}, parentId, source) => edits.create(kind as PageKind, optional(title), initial as Record<string, AttributeValue>, optional(parentId), optional(source)));
    ipc(channels.definitions, () => attributes.definitions());
    ipc(channels.define, (id, input, source, token) => edits.setDefinition(string(id), input as AttributeDefinition | null, tab(source), optional(token)));
    ipc(channels.resolve, target => knowledge.resolve(target as Target));
    ipc(channels.backlinks, id => knowledge.backlinks(string(id)));
    ipc(channels.history, id => history.state(tab(id)));
    ipc(channels.undo, (id, direction, branch, confirmation) => {
        if (direction !== "undo" && direction !== "redo") throw new LabloomError({ kind: "history-invalid-action" });
        return history.apply(tab(id), direction, optional(branch), optional(confirmation));
    });
    ipc(channels.closeTab, id => history.close(tab(id)));
    ipc(channels.loadTabs, () => {
        lifecycle.editorStarted(window.webContents);
        return workspaceSettings.loadTabs();
    });
    ipc(channels.saveTabs, value => workspaceSettings.saveTabs(value));
    ipc(channels.importPDF, async (id, source) => {
        const pageId = optional(id), sourceTab = optional(source) ?? "";
        const selection = await dialog.showOpenDialog(window, { properties: ["openFile"], filters: [{ name: t("dialog.pdfFilter"), extensions: ["pdf"] }] });
        if (selection.canceled || !selection.filePaths[0]) return null;
        const result = papers.importFile(selection.filePaths[0], pageId, sourceTab || undefined);
        return result;
    });
    ipc(channels.importFiles, async (id, attribute, source) => {
        const pageId = string(id), attributeId = string(attribute), sourceTab = tab(source);
        const multiple = papers.fileSelection(attributeId);
        const selection = await dialog.showOpenDialog(window, { properties: multiple ? ["openFile", "multiSelections"] : ["openFile"] });
        if (selection.canceled || !selection.filePaths.length) return null;
        const files = papers.attachFiles(selection.filePaths, pageId, attributeId, sourceTab);
        return files;
    });
    ipc(channels.files, ids => papers.files(ids as string[] | undefined));
    ipc(channels.openFile, async id => {
        const error = await shell.openPath(papers.externalPath(string(id)));
        if (error) throw new LabloomError({ kind: "attachment-open-failed", diagnostic: error });
    });
    ipc(channels.resources, id => papers.resources(string(id)));
    ipc(channels.readFile, id => papers.read(string(id)));
    ipc(channels.getAnnotation, id => papers.getAnnotation(string(id)));
    ipc(channels.unlockPDF, (file, password) => papers.unlockPDF(string(file), string(password)));
    ipc(channels.changeAnnotation, (id, color, source) => papers.changeAnnotation(string(id), string(color), tab(source)));
    ipc(channels.position, (id, file, value, source) => papers.position(string(id), string(file), value as ReadingPosition, optional(source)));
    ipc(channels.deleteAnnotation, (id, source, confirmation) => papers.deleteAnnotation(string(id), tab(source), optional(confirmation)));
    ipc(channels.annotate, (id, value, source, color) => papers.annotate(string(id), value as AnnotationInput | string, tab(source), optional(color)));
    ipc(channels.notices, () => timers.notices());
    ipc(channels.timers, id => timers.settings(string(id)));
    ipc(channels.setTimer, (id, attr, lead, enabled, source) => timers.set(string(id), string(attr), lead as number, enabled as boolean, tab(source)));
    ipc(channels.readNotice, (id, attr, lead, source) => timers.read(string(id), string(attr), lead as number, tab(source)));

}