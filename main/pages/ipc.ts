import { type BrowserWindow } from "electron";
import typia from "typia";
import { pagesChannels, pagesChanged, type PagesAPI } from "../../shared/pages/ipc";
import { invalid, register, route, type Routes } from "../ipc";
import * as records from "../knowledge/records";
import * as picker from "../knowledge/block-list";
import * as edits from "../knowledge/edits";
import * as papers from "../knowledge/papers";
import * as purge from "../knowledge/purge";
import * as events from "../knowledge/events";

type Args<Key extends keyof typeof pagesChannels> = Parameters<PagesAPI[Key]>;

export const routes = {
    list: route(typia.createAssert<Args<"list">>(invalid), records.list),
    search: route(typia.createAssert<Args<"search">>(invalid), records.searchPages),
    listUpdates: route(typia.createAssert<Args<"listUpdates">>(invalid), records.listUpdates),
    blockList: route(typia.createAssert<Args<"blockList">>(invalid), picker.blockList),
    get: route(typia.createAssert<Args<"get">>(invalid), papers.get),
    readObjects: route(typia.createAssert<Args<"readObjects">>(invalid), records.readObjects),
    syncBlocks: route(typia.createAssert<Args<"syncBlocks">>(invalid), edits.syncBlocks),
    create: route(typia.createAssert<Args<"create">>(invalid), edits.create),
    commitEdit: route(typia.createAssert<Args<"commitEdit">>(invalid), edits.commitEdit),
    previewEdit: route(typia.createAssert<Args<"previewEdit">>(invalid), edits.previewEdit),
    deleteBlock: route(typia.createAssert<Args<"deleteBlock">>(invalid), edits.deleteBlock),
    place: route(typia.createAssert<Args<"place">>(invalid), edits.place),
    trash: route(typia.createAssert<Args<"trash">>(invalid), edits.trash),
    restore: route(typia.createAssert<Args<"restore">>(invalid), edits.restore),
    purge: route(typia.createAssert<Args<"purge">>(invalid), purge.purge),
    emptyTrash: route(typia.createAssert<Args<"emptyTrash">>(invalid), (...args) => purge.purge(null, ...args)),
    backlinks: route(typia.createAssert<Args<"backlinks">>(invalid), records.backlinks),
    resolve: route(typia.createAssert<Args<"resolve">>(invalid), records.resolve)
} satisfies Routes<PagesAPI>;
export function registerPagesIPCs(window: BrowserWindow): void {
    const contents = window.webContents;
    register(contents, pagesChannels, routes);
    const unsubscribe = events.subscribe(event => {
        if (event.type === "knowledge" && !contents.isDestroyed()) contents.send(pagesChanged, event.change);
    });
    contents.once("destroyed", unsubscribe);
}