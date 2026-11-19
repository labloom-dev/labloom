import { type BrowserWindow } from "electron";
import typia from "typia";
import { workspaceChannels, type WorkspaceAPI } from "../../shared/workspace/ipc";
import { invalid, register, route, type Routes } from "../ipc";
import * as workspace from "../workspace-settings";

type Args<Key extends keyof typeof workspaceChannels> = Parameters<WorkspaceAPI[Key]>;

const routes = {
    loadTabs: route(typia.createAssert<Args<"loadTabs">>(invalid), workspace.loadTabs),
    saveTabs: route(typia.createAssert<Args<"saveTabs">>(invalid), workspace.saveTabs)
} satisfies Routes<WorkspaceAPI>;
export function registerWorkspaceIPCs(window: BrowserWindow): void {
    const contents = window.webContents;
    register(contents, workspaceChannels, routes);
}