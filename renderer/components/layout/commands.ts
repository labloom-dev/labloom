import { SvelteMap } from "svelte/reactivity";
import { tick } from "svelte";
import { definitionFor } from "../Tab/views";
import { visits } from "../Tab/activity.svelte";
import { shortcutCommand, type Command } from "../../../shared/content/commands";
import { toggleProperties } from "../Knowledge/page-header";
import { tabDirty } from "../Tab/dirty.svelte";
import { workspaceHistory, type HistorySource } from "../../../shared/history/ipc";
import { confirmed } from "../Knowledge/confirmation.svelte";
import { perform } from "../Knowledge/feedback.svelte";
import { write } from "../Knowledge/page-sessions";
import { activateTab, closeGroup, focusGroup, removeTab } from "../Tab/api";
import type { LayoutNode } from "../Tab/defs";
import { tabState } from "../Tab/state.svelte";
import { createPage, openDestination, openPage, splitCurrent } from "./navigation";
import { focusTabGroup } from "../Tab/interactions";
import { shell, showSearch, togglePanel } from "./shell.svelte";

export type EditingCommand = "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll" | "inlineReference" | "blockMenu";
const editors = new WeakMap<HTMLElement, (command: EditingCommand) => void>();
let lastFocus: HTMLElement | null = null;
export function rememberFocus(): void {
    if (document.activeElement instanceof HTMLElement && !document.activeElement.closest(".menubar,[data-menubar-content]")) lastFocus = document.activeElement;
}
const unavailable = new SvelteMap<EditingCommand, boolean>();
let contextRevision = 0;
function historySource(active: HTMLElement | null): HistorySource {
    const groupId = active?.closest<HTMLElement>("[data-group-id]")?.dataset.groupId;
    const owner = tabState.groups.find(item => item.id === groupId);
    const tab = owner?.tabs.find(item => item.id === owner.activeTabId);
    return tab ? definitionFor(tab.view.type).history(tab.view.params) : workspaceHistory;
}
export function prepareCommands(origin: Element | null = document.activeElement): void {
    if (origin instanceof HTMLElement && !origin.closest(".menubar,[data-menubar-content],.search-popup")) lastFocus = origin;
    const active = lastFocus?.isConnected ? lastFocus : null;
    const field = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    const editor = active?.closest<HTMLElement>(".tiptap");
    const selected = field ? active.selectionStart !== active.selectionEnd : !window.getSelection()?.isCollapsed;
    const writable = field ? !active.readOnly && !active.disabled : !!editor?.isContentEditable;
    unavailable.set("cut", !writable || !selected);
    unavailable.set("copy", !selected);
    unavailable.set("paste", !writable);
    const revision = ++contextRevision;
    if (field) {
        unavailable.set("undo", !document.queryCommandEnabled("undo"));
        unavailable.set("redo", !document.queryCommandEnabled("redo"));
        return;
    }
    const tab = active?.closest<HTMLElement>("[data-tabs-content]")?.dataset.value;
    const dirty = !!tab && tabDirty(tab);
    unavailable.set("undo", !dirty);
    unavailable.set("redo", true);
    void window.api.history.state(historySource(active)).then(state => {
        if (revision !== contextRevision) return;
        unavailable.set("undo", !state.canUndo && !dirty);
        unavailable.set("redo", !state.canRedo);
    }).catch(console.error);
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
        const source = historySource(active);
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
export function commandDisabled(id: Command): boolean {
    const group = tabState.groups.find(item => item.id === tabState.focusedGroupId);
    const current = group?.tabs.find(tab => tab.id === group.activeTabId);
    if (id === "toggleProperties") return current?.view.type !== "page";
    if (id === "blockMenu") return !group || !current || !document.querySelector(`[data-tabs-content][data-value="${CSS.escape(current.id)}"] .tiptap[contenteditable=true]`);
    if (id === "mergeGroup") return tabState.groups.length < 2;
    if (id === "closeTab") return !group?.activeTabId;
    if (id === "nextTab" || id === "previousTab") return (group?.tabs.length ?? 0) < 2;
    if (id === "group1" || id === "group2" || id === "group3") return tabState.groups.length < Number(id.slice(-1));
    return unavailable.get(id as EditingCommand) ?? false;
}

export function runCommand(id: Command): void {
    const group = tabState.groups.find(g => g.id === tabState.focusedGroupId)!;
    if (id === "toggleProperties") {
        const tab = group.tabs.find(item => item.id === group.activeTabId);
        if (tab?.view.type === "page") toggleProperties(tab.id, tab.view.params);
    }
    else if (id === "blockMenu") {
        const activeEditor = lastFocus?.closest<HTMLElement>(".tiptap");
        const pane = group.activeTabId && document.querySelector(`[data-tabs-content][data-value="${CSS.escape(group.activeTabId)}"]`);
        const editor = pane && (activeEditor && pane.contains(activeEditor) ? activeEditor : pane.querySelector<HTMLElement>(".tiptap"));
        if (editor) editors.get(editor)?.("blockMenu");
    }
    else if (id === "newPage") createPage();
    else if (id === "closeTab") {
        if (group.activeTabId) removeTab(group.activeTabId);
    }
    else if (id === "sidebar") togglePanel();
    else if (id === "search" || id === "commandPalette") {
        const origin = lastFocus?.isConnected ? lastFocus : document.activeElement;
        if (!shell.search) prepareCommands(origin);
        showSearch(id === "commandPalette", origin);
    }
    else if (id === "mergeGroup") {
        if (closeGroup(group.id)) void tick().then(() => focusTabGroup(tabState.focusedGroupId));
    }
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
    if (!id || (shell.search && id !== "commandPalette" && id !== "search")) return;
    const target = event.target instanceof Element ? event.target : null;
    if (id === "blockMenu" && !target?.closest(".tiptap[contenteditable=true]")) return;
    if (["undo", "redo", "cut", "copy", "paste", "selectAll"].includes(id) && target?.closest("input,textarea,.tiptap,[contenteditable=true]")) return;
    event.preventDefault();
    if (!shell.search) rememberFocus();
    runCommand(id);
}