import { tick } from "svelte";
import { definitionFor } from "../Tab/views";
import { visits } from "../Tab/activity.svelte";
import { commands, shortcutCommand, type Command } from "../../../shared/content/commands";
import { workspaceHistory } from "../../../shared/history/ipc";
import { confirmed } from "../Knowledge/confirmation.svelte";
import { perform } from "../Knowledge/feedback.svelte";
import { write } from "../Knowledge/page-sessions";
import { activateTab, focusGroup, removeTab } from "../Tab/api";
import type { LayoutNode } from "../Tab/defs";
import { tabState } from "../Tab/state.svelte";
import { createPage, openDestination, openPage, splitCurrent } from "./navigation";
import { shell, togglePanel } from "./shell.svelte";

export { commands };
export type EditingCommand = "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll" | "inlineReference";
const editors = new WeakMap<HTMLElement, (command: EditingCommand) => void>();
let lastFocus: HTMLElement | null = null;
export function rememberFocus(): void {
    if (document.activeElement instanceof HTMLElement) lastFocus = document.activeElement;
}
export function registerEditing(element: HTMLElement, run: (command: EditingCommand) => void): () => void {
    editors.set(element, run); return () => editors.delete(element);
}
function editCommand(command: EditingCommand): void {
    const group = document.querySelector(`[data-group-id="${CSS.escape(tabState.focusedGroupId)}"]`);
    const active = lastFocus?.isConnected ? lastFocus : null;
    if (active?.matches("input,textarea")) {
        active.focus({ preventScroll: true });
        if (command !== "inlineReference") document.execCommand(command);
        return;
    }
    if (command === "undo" || command === "redo") {
        const editor = active?.closest<HTMLElement>(".tiptap");
        const run = editor && editors.get(editor);
        if (run) {
            run(command); return;
        }
        const groupId = active?.closest<HTMLElement>("[data-group-id]")?.dataset.groupId;
        const owner = tabState.groups.find(item => item.id === groupId);
        const tab = owner?.tabs.find(item => item.id === owner.activeTabId);
        const source = tab ? definitionFor(tab.view.type).history(tab.view.params) : workspaceHistory;
        void perform(async () => {
            await write(async () => {
                const history = await window.api.history.state(source);
                if (command === "undo" ? history.canUndo : history.canRedo) {
                    await confirmed(token => window.api.history.apply(source, command, token));
                }
            });
        });
        return;
    }
    const area = active?.closest<HTMLElement>(".tiptap,.library") ?? group?.querySelector<HTMLElement>("[data-tabs-content]:not([hidden]) .tiptap, [data-tabs-content]:not([hidden]) .library");
    const run = area && editors.get(area);
    if (run) {
        run(command); return;
    }
    active?.focus({ preventScroll: true });
    if (command !== "inlineReference") document.execCommand(command);
}
async function focusActive(id: string): Promise<void> {
    await tick();
    const select = (): HTMLElement | null => document.querySelector(`[data-tabs-content][data-value="${CSS.escape(id)}"] .tiptap, [data-tabs-content][data-value="${CSS.escape(id)}"] [role=grid]`);
    if (!select() && !await visits.settled(id)) return;
    if (tabState.groups.find(group => group.id === tabState.focusedGroupId)?.activeTabId === id) select()?.focus({ preventScroll: true });
}
export function runCommand(id: Command): void {
    const group = tabState.groups.find(g => g.id === tabState.focusedGroupId)!;
    if (id === "newPage") createPage();
    else if (id === "closeTab") {
        if (group.activeTabId) removeTab(group.activeTabId);
    }
    else if (id === "sidebar") togglePanel();
    else if (id === "search") shell.search = true;
    else if (id === "devtools") window.api.app.openDevTools();
    else if (id === "splitRight" || id === "splitDown") splitCurrent(group.id, id === "splitRight" ? "horizontal" : "vertical");
    else if (id === "nextTab" || id === "previousTab") {
        const index = group.tabs.findIndex(tab => tab.id === group.activeTabId), count = group.tabs.length;
        if (count) {
            const tab = group.tabs[(index + (id === "nextTab" ? 1 : count - 1)) % count]; activateTab(tab.id); void focusActive(tab.id);
        }
    }
    else if (id === "group1" || id === "group2" || id === "group3") {
        const order = (node: LayoutNode): string[] => node.type === "group" ? [node.groupId] : node.children.flatMap(order);
        const target = tabState.groups.find(g => g.id === order(tabState.layout)[Number(id.slice(-1)) - 1]);
        if (target) {
            focusGroup(target.id);
            document.querySelector<HTMLElement>(`[data-group-id="${CSS.escape(target.id)}"] [data-tabs-content]:not([hidden]) .tiptap, [data-group-id="${CSS.escape(target.id)}"] [data-tabs-trigger][data-state=active]`)?.focus();
        }
    }
    else if (id === "importPDF") void perform(async () => {
        const result = await write(() => window.api.papers.importPDF(workspaceHistory));
        if (result) openPage(result.pageId);
    });
    else if (["undo", "redo", "cut", "copy", "paste", "selectAll"].includes(id)) editCommand(id as EditingCommand);
    else openDestination(id as Parameters<typeof openDestination>[0]);
}
export function globalShortcut(event: KeyboardEvent): void {
    const id = shortcutCommand(event);
    if (!id) return;
    const target = event.target instanceof Element ? event.target : null;
    if (["undo", "redo", "cut", "copy", "paste", "selectAll"].includes(id) && target?.closest("input,textarea,.tiptap,[contenteditable=true]")) return;
    event.preventDefault();
    rememberFocus();
    runCommand(id);
}