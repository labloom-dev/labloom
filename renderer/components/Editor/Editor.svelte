<div class="editor editor-canvas" class:paper={session.state.page?.kind === "paper"} bind:this={root} role="presentation"
    onpointerdowncapture={marginDown} oncontextmenucapture={context} onpointermove={hover} onpointerleave={() => {
        if (!menu && !picker && !gesture) handle = null;
        clearPreview();
    }}>
    <Menu context bind:open={bodyOpen} items={bodyItems(editingCommand, !locked)} {portal} onrestore={restoreEditor}>
        {#snippet trigger({ props })}<div {...props} tabindex="-1" class="editor-column" bind:this={host} {@attach documentLabels}></div>{/snippet}
    </Menu>
    {#each bands as rect (rect.y)}
        <div class="block-band" style:left={rect.x + "px"} style:top={rect.y + "px"} style:width={rect.width + "px"} style:height={rect.height + "px"}></div>
    {/each}
    {#if marquee}<div class="marquee" style:left={marquee.x + "px"} style:top={marquee.y + "px"} style:width={marquee.width + "px"} style:height={marquee.height + "px"}></div>{/if}
    {#if indicator}<div class="drop-line" style:transform={`translate3d(${indicator.left}px, ${indicator.top}px, 0)`} style:width={(indicator.right - indicator.left) + "px"}></div>{/if}
    {#if handle && !locked}
        <div class="handle" class:list-handle={handle.kind === "ordered_list" || handle.kind === "unordered_list"} style:top={handle.top + "px"} style:left={handle.left + "px"}>
            <IconButton icon="gripper" label={commandLabel("blockMenu")} shortcut={commands.blockMenu.shortcut}
                onpointerdown={handleDown} onclick={event => {
                    if (!event.detail) setBlockMenu(true);
                }}
                oncontextmenu={event => {
                    event.preventDefault(); event.stopPropagation(); setBlockMenu(true);
                }} />
            {#if handle.children}
                <IconButton icon={handle.folded ? "chevron-right" : "chevron-down"} label={t(handle.folded ? "editor.unfold" : "editor.fold")} shortcut={blockShortcuts.fold}
                    style="--ui-hover: var(--ui-surface-clear)" onpointerdown={event => event.preventDefault()} onclick={() => act("fold")} />
            {/if}
            <Menu align="start" bind:open={() => menu, setBlockMenu} anchor={handleAnchor} items={blockItems(handle, convert, act, pick, move, multiple)} {portal} onrestore={restoreEditor} />
        </div>
    {/if}
</div>
<span hidden bind:this={linkGlyph}><Icon name="link-external" size="1em" /></span>
{#if slash && editor}
    <SuggestionMenu items={suggestions} selected={suggestionIndex} onselect={insertSuggestion} bounds={caretBounds} label={t("editor.insertBlock")} />
{/if}
{#if picker}
    <TargetPicker mode={picker === "sync" ? "sync" : "reference"} position={picker === "inline" ? pickerPosition : undefined} onselect={choose} onclose={cancelPicker} />
{/if}
{#if preview}
    <ReferencePreview anchor={preview.anchor}><ReferenceView {session} target={preview.target} /></ReferencePreview>
{/if}
{#if pasteChoice}
    <Menu align="start" bind:open={() => !!pasteChoice, pasteOpen} {portal} first
        anchor={{ getBoundingClientRect: () => new DOMRect(pasteChoice?.x, pasteChoice?.y, 0, 0) }}
        items={pasteItems(synced => void perform(() => paste(synced)))} onrestore={restoreEditor} />
{/if}
{#if editor}<Toolbar {editor} history={session.state.history} dirty={session.state.dirty} />{/if}

<style>
    .editor { position: relative; flex: 1; min-height: var(--ui-editor-min-height); }
    .editor[data-gesture]::after { content: ""; position: absolute; inset: 0; z-index: 3; }
    .editor[data-gesture="drag"]::after { cursor: grabbing; }
    .editor[data-gesture="marquee"]::after { cursor: crosshair; }
    .handle { cursor: default; display: flex; position: absolute; transform: translate(-100%, -50%); z-index: 2; color: var(--ui-text-secondary); }
    .block-band { position: absolute; pointer-events: none; background: var(--ui-text-selection); }
    .editor-column { position: relative; z-index: 1; }
    .marquee { position: absolute; z-index: 1; pointer-events: none; border: var(--ui-stroke) solid var(--ui-accent); background: color-mix(in srgb, var(--ui-text-selection) 45%, transparent); }
    .drop-line { position: absolute; inset: calc(var(--ui-active-border) / -2) auto auto 0; height: var(--ui-active-border); background: var(--ui-accent); z-index: 1; pointer-events: none; }
    .list-handle { margin-inline-start: calc(-1 * var(--ui-editor-indent)); }
</style>
<script lang="ts">
    import Icon from "../utils/Icon.svelte";
    import { LabloomError } from "../../../shared/failure";
    import { mount, onMount, tick, unmount, untrack } from "svelte";
    import { Editor, Extension } from "@tiptap/core";
    import History from "@tiptap/extension-history";
    import { type Node as DocNode } from "@tiptap/pm/model";
    import { TextSelection, type EditorState, type SelectionBookmark } from "@tiptap/pm/state";
    import type { EditorView } from "@tiptap/pm/view";
    import { Mapping, type Step } from "@tiptap/pm/transform";
    import { commandLabel, t } from "../../i18n.svelte";
    import { isComposingKey, commands, blockShortcuts } from "../../../shared/content/commands";
    import { registerEditing, type EditingCommand } from "../layout/commands";
    import { openPage, openTarget } from "../layout/navigation";
    import Menu from "../base/Menu.svelte";
    import IconButton from "../base/IconButton.svelte";
    import Backlinks from "../Knowledge/Backlinks.svelte";
    import { block as blockItems, body as bodyItems, paste as pasteItems } from "./menus";
    import { type Target, type ContentBlockKind } from "../../../shared/types/content";
    import { blockText, payload } from "../../../shared/content/blocks";
    import { type PageSession } from "../Knowledge/page-session.svelte";
    import { perform } from "../Knowledge/feedback.svelte";
    import { readingTabs } from "../Tab/activity.svelte";
    import { tabState } from "../Tab/state.svelte";
    import ReferenceView from "../Knowledge/ReferenceView.svelte";
    import ReferencePreview from "./ReferencePreview.svelte";
    import TargetPicker from "../Knowledge/TargetPicker.svelte";
    import Toolbar from "./Toolbar.svelte";
    import SuggestionMenu from "../base/SuggestionMenu.svelte";
    import { codeKeys, pasteCode } from "./code-edit";
    import { fold, reveal, skipFold, visibleCaret } from "./folding";
    import { inputAction, convertPrefix, restoreLiteral } from "./input-conversion";
    import { insertItems, slashTrigger, type Trigger } from "./slash";
    import { BlockSelection, adjacent, bandThreshold, movingBlocks, selectionDecorations, wholeSelection } from "./block-selection";
    import { moveBlocks, dropAt, relativeDrop, type Drop } from "./block-move";
    import { dragPreview } from "./drag-preview";
    import { trackPointer } from "./pointer-gesture";
    import { blockPosition, clickPage, handleRowAtHeight, inMargin, intersectingBlocks } from "./page-pointer";
    import { blankBlock, blockData, blockJSON, canNest, documentEdit, indexDoc, kindOf, pageDocument, removesReference, subtree, type Location } from "./document";
    import { backlinkRow, documentLabels, documentViews } from "./document-view.svelte";
    import { clipboardRows, editing, located, remoteEdit, selectionIn, syncInsert } from "./transactions";
    import { pasteBlocks, readClipboard, writeClipboard, type BlockClipboard } from "./clipboard";
    import { borders, borderPlugin } from "./sync-border";
    import { inverse, patchDocument, replay } from "./reconcile";
    import { anchors } from "../Tab/anchors";
    let { session, tabId, pageAnchor = false }: { session: PageSession; tabId: string; pageAnchor?: boolean } = $props();
    let root: HTMLDivElement, host: HTMLDivElement, editor = $state.raw<Editor | null>(null);
    let linkGlyph: HTMLSpanElement;
    let portal = $state<HTMLElement>();
    let backlinkElement: HTMLDivElement | undefined;
    let workspaceId = "", pasting = $state(false);
    type PasteChoice = { clipboard: BlockClipboard; bookmark: SelectionBookmark; x: number; y: number };
    let pasteChoice = $state.raw<PasteChoice | null>(null), pendingPaste: PasteChoice | null = null;
    const locked = $derived(pasting || !!pasteChoice || readingTabs.has(tabId) || session.state.loading || !!session.state.page?.attributes.deleted);
    type Handle = { id: string; pos: number; top: number; left: number; kind: ContentBlockKind; shared: boolean; folded: boolean; children: boolean };
    let handle = $state.raw<Handle | null>(null), menu = $state(false), picker = $state<"inline" | "reference" | "sync" | null>(null);
    let multiple = $state(false);
    let pickerVersion = 0, menuOrigin: SelectionBookmark | null = null, bodyOpen = $state(false);
    let caret: SelectionBookmark | null = null, preview = $state.raw<{ target: Target; pos: number; anchor: HTMLElement } | null>(null);
    let pickerPosition = $state<{ x: number; y: number; left: number; right: number; bottom: number }>();
    let hoveredReference: HTMLElement | null = null, previewTimer: ReturnType<typeof setTimeout> | undefined;
    let slash = $state.raw<Trigger | null>(null), suggestionIndex = $state(0);
    const suggestions = $derived(slash ? insertItems(slash.query) : []);
    function caretBounds(): DOMRect {
        if (!editor || editor.isDestroyed) return new DOMRect();
        const { left, top, bottom } = editor.view.coordsAtPos(editor.state.selection.head);
        return new DOMRect(left, top, 0, bottom - top);
    }
    function insertSuggestion(index: number): void {
        const item = suggestions[index], range = slash, instance = editor;
        if (!item || !range || !instance || locked || instance.view.composing) return;
        slash = null;
        const tr = instance.state.tr.delete(range.from, range.to), loc = located(tr);
        if (!loc) return;
        if (item.kind === "inline" || item.kind === "reference" || item.kind === "sync") {
            instance.view.dispatch(tr);
            const el = instance.view.nodeDOM(loc.pos);
            if (el instanceof HTMLElement) placeHandle(el, loc);
            pick(item.kind);
            return;
        }
        const empty = !loc.node.firstChild!.content.size && (loc.node.childCount === 1 || canNest(item.kind));
        const start = empty ? loc.pos : loc.pos + loc.node.nodeSize;
        let node = blankBlock(instance.schema, item.kind);
        if (empty) {
            if (node.type.name === "pageBlock") node = node.copy(loc.node.content);
            node = node.type.create({ ...node.attrs, blockId: loc.node.attrs.blockId, collapsed: loc.node.attrs.collapsed }, node.content);
        }
        tr.replaceWith(start, empty ? start + loc.node.nodeSize : start, node);
        instance.view.dispatch(selectionIn(tr, start + (node.isAtom ? node.nodeSize : 2)).scrollIntoView());
        instance.view.focus();
    }
    function suggestionKey(event: KeyboardEvent): boolean {
        if (!slash) return false;
        if (event.key === "Escape") slash = null;
        else if (event.key === "Enter") {
            if (suggestions.length) insertSuggestion(suggestionIndex); else slash = null;
        }
        else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            const count = suggestions.length;
            if (count) suggestionIndex = (suggestionIndex + count + (event.key === "ArrowUp" ? -1 : 1)) % count;
        }
        else return false;
        return true;
    }
    let literal: { before: EditorState; after: EditorState } | null = null;
    let brackets: SelectionBookmark | null = null;
    function applyInput(instance: Editor, action: ContentBlockKind | "inline"): void {
        const before = instance.state;
        if (action === "inline") {
            const end = before.selection.head;
            pick("inline");
            if (picker) brackets = TextSelection.create(before.doc, end - 2, end).getBookmark();
            return;
        }
        session.checkpoint();
        instance.view.dispatch(convertPrefix(before, action));
        session.checkpoint();
        literal = { before, after: instance.state };
    }
    function editingCommand(command: EditingCommand): void {
        if (!editor) return;
        if (command === "blockMenu") {
            keyboardBlock(); return;
        }
        if (menuOrigin) restoreBookmark(menuOrigin);
        if (command === "inlineReference") {
            pick("inline"); return;
        }
        menuOrigin = null;
        editor.view.focus();
        if (command === "undo" || command === "redo") {
            void session.undo(command); return;
        }
        if (command === "selectAll") editor.commands.selectAll();
        else document.execCommand(command);
    }
    function context(event: MouseEvent): void {
        if (!editor || !(event.target instanceof Element) || event.target.closest(".handle")) return;
        if (editor.view.composing || event.target.closest(".editor-backlinks")) {
            event.preventDefault(); event.stopPropagation(); return;
        }
        if (event.target !== host) {
            const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            if (pos !== undefined && (pos < editor.state.selection.from || pos > editor.state.selection.to)) editor.view.dispatch(selectionIn(editor.state.tr, pos));
        }
        menuOrigin = editor.state.selection.getBookmark();
        if (!host.contains(event.target)) {
            event.preventDefault();
            host.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY }));
        }
    }
    function setBlockMenu(value: boolean): void {
        if (value && (!editor || editor.view.composing)) return;
        if (value) {
            menuOrigin = editor!.state.selection.getBookmark();
            const loc = target();
            const places = loc ? selectedBlocks(loc) : [];
            multiple = places.length > 1;
            if (multiple && handle) {
                const parents = places.filter(p => p.node.type.name === "pageBlock" && p.node.childCount > 1);
                handle = { ...handle, children: !!parents.length, folded: !!parents.length && parents.every(p => p.node.attrs.collapsed) };
            }
        }
        menu = value;
    }
    function pasteOpen(value: boolean): void {
        if (!value && pasteChoice) cancelPaste();
    }
    function restoreBookmark(bookmark: SelectionBookmark): void {
        if (!editor || editor.isDestroyed) return;
        const selection = bookmark.resolve(editor.state.doc);
        if (!selection.eq(editor.state.selection)) editor.view.dispatch(editor.state.tr.setSelection(selection));
    }
    function restoreEditor(): void {
        if (picker || pasting || pasteChoice || !editor || editor.isDestroyed) return;
        if (!editor.view.dom.isConnected || editor.view.dom.closest("[data-tabs-content][hidden]")) return;
        if (menuOrigin) restoreBookmark(menuOrigin);
        menuOrigin = null;
        editor.view.focus();
    }
    function cancelPicker(): void {
        if (caret) restoreBookmark(caret);
        close(); void tick().then(restoreEditor);
    }
    function cancelPaste(): void {
        const saved = pasteChoice?.bookmark;
        pasteChoice = null; pendingPaste = null;
        if (saved) restoreBookmark(saved);
        void tick().then(restoreEditor);
    }
    function keyboardBlock(): boolean {
        if (!editor || locked || editor.view.composing) return false;
        const sel = editor.state.selection;
        const selection = wholeSelection(sel);
        const loc = selection ? { pos: selection.first, node: editor.state.doc.nodeAt(selection.first)! } : located(editor.state);
        if (!loc || loc.node.type.name === "pageTitle") return false;
        const element = editor.view.nodeDOM(loc.pos);
        if (!(element instanceof HTMLElement)) return false;
        placeHandle(element, loc); setBlockMenu(true);
        return true;
    }
    async function offerPaste(clipboard: BlockClipboard): Promise<void> {
        const instance = editor;
        if (!instance || locked) return;
        const at = instance.view.coordsAtPos(instance.state.selection.from);
        const choice = pendingPaste = { clipboard, bookmark: instance.state.selection.getBookmark(), x: at.left, y: at.bottom };
        pasting = true;
        try {
            if (!await session.flush() || instance.isDestroyed) return;
            const available = await window.api.pages.syncBlocks(clipboard.workspaceId, clipboard.ids);
            if (instance.isDestroyed || pendingPaste !== choice) return;
            pasteChoice = choice;
            if (!available) await paste(false);
        }
        finally {
            pasting = false;
            if (!pasteChoice) pendingPaste = null;
        }
    }
    async function paste(synced: boolean): Promise<void> {
        const choice = pasteChoice, instance = editor;
        if (!choice || !instance || instance.isDestroyed) return;
        pasteChoice = null; pasting = true;
        try {
            if (!await session.flush() || instance.isDestroyed) return;
            const current = synced ? await window.api.pages.syncBlocks(choice.clipboard.workspaceId, choice.clipboard.ids) : undefined;
            if (synced && !current) throw new LabloomError({ kind: "block-sync-unavailable" });
            if (current) await session.objects(current.map(block => block.id));
            if (instance.isDestroyed) return;
            const state = instance.state.apply(instance.state.tr.setSelection(choice.bookmark.resolve(instance.state.doc)));
            const planned = pasteBlocks(state, choice.clipboard, current ?? undefined);
            pendingPaste = null;
            let saved = false;
            await session.action(async (token, writeId) => {
                const result = await window.api.pages.commitEdit({ ...planned.edit, pageId: session.state.page!.id, batch: 0, ...(synced ? { sync: choice.clipboard.ids } : {}) }, session.source, token, writeId);
                saved = result.status === "saved";
                return result;
            });
            if (saved && !instance.isDestroyed) instance.view.dispatch(selectionIn(instance.state.tr, Math.min(planned.selection, instance.state.doc.content.size)));
        }
        finally {
            pasting = false;
            pendingPaste = null;
            if (!instance.isDestroyed) instance.view.focus();
        }
    }
    function clearPreview(): void {
        clearTimeout(previewTimer); hoveredReference = null; preview = null;
    }
    function hoverReference(event: PointerEvent): void {
        const link = event.target instanceof Element ? event.target.closest<HTMLElement>(".inline-reference") : null;
        if (link === hoveredReference) return;
        clearPreview();
        if (!link || !editor) return;
        hoveredReference = link;
        previewTimer = setTimeout(() => {
            if (!editor || !link.isConnected) return;
            preview = { target: { kind: link.dataset.targetKind as Target["kind"], id: link.dataset.inlineTarget! }, pos: editor.view.posAtDOM(link, 0), anchor: link };
        }, 300);
    }
    let bands = $state.raw<DOMRect[]>([]);
    function paintBands(view: EditorView): void {
        const selected = view.state.selection;
        const ranges = selected instanceof BlockSelection ? selected.ranges.filter(r => r.$to.index() - r.$from.index() > bandThreshold) : [];
        if (!ranges.length) {
            if (bands.length) bands = [];
            return;
        }
        const bounds = root.getBoundingClientRect();
        bands = ranges.flatMap(({ $from, $to }) => {
            const first = view.nodeDOM($from.pos), last = view.nodeDOM($to.pos - $to.nodeBefore!.nodeSize);
            if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) return [];
            const a = first.getBoundingClientRect(), b = last.getBoundingClientRect();
            return [new DOMRect(a.left - bounds.left, a.top - bounds.top, a.width, b.bottom - a.top)];
        });
    }
    let marquee = $state.raw<DOMRect | null>(null);
    function marginDown(event: PointerEvent): void {
        const instance = editor;
        if (!instance || event.button !== 0 || gesture || instance.view.composing) return;
        const folded = event.target instanceof HTMLElement && event.target.closest<HTMLElement>("[data-folded]");
        if (!locked && folded && event.target === folded && event.clientX < folded.getBoundingClientRect().left) {
            event.preventDefault();
            const pos = blockPosition(instance.view, folded), node = instance.state.doc.nodeAt(pos);
            if (node) instance.view.dispatch(fold(instance.state.tr, { pos, node }));
            return;
        }
        const selected = wholeSelection(instance.state.selection);
        const block = event.target instanceof Element && event.target.closest<HTMLElement>("[data-block-id]");
        if (event.shiftKey && selected && block && block.dataset.kind !== "title") {
            event.preventDefault();
            instance.view.dispatch(instance.state.tr.setSelection(new BlockSelection(instance.state.doc, selected.first, blockPosition(instance.view, block))));
            instance.view.focus(); return;
        }
        if (!inMargin(instance.view, root, event)) return;
        const origin = root.getBoundingClientRect();
        const x = event.clientX - origin.left, y = event.clientY - origin.top;
        const initial = instance.state.selection;
        gesture = trackPointer(root, event, "marquee", {
            move(point) {
                const bounds = root.getBoundingClientRect(), start = { x: x + bounds.left, y: y + bounds.top };
                const left = Math.min(start.x, point.x), right = Math.max(start.x, point.x), top = Math.min(start.y, point.y), bottom = Math.max(start.y, point.y);
                marquee = new DOMRect(left - bounds.left, top - bounds.top, right - left, bottom - top);
                const hits = intersectingBlocks(instance.view, new DOMRect(left, top, right - left, bottom - top));
                if (!hits) {
                    if (wholeSelection(instance.state.selection)) instance.view.dispatch(selectionIn(instance.state.tr, instance.state.selection.from + 1));
                    return;
                }
                const [a, b] = start.y <= point.y ? hits : [hits[1], hits[0]];
                const current = instance.state.selection;
                if (!(current instanceof BlockSelection && current.first === a && current.last === b))
                    instance.view.dispatch(instance.state.tr.setSelection(new BlockSelection(instance.state.doc, a, b)));
            },
            end(dragged, cancelled, point) {
                gesture = null; marquee = null;
                if (cancelled) {
                    if (instance.state.doc === initial.$from.doc) instance.view.dispatch(instance.state.tr.setSelection(initial));
                }
                else if (!dragged) clickPage(instance.view, point.x, point.y, !locked);
                else instance.view.focus();
            }
        });
    }
    function selectedBlocks(loc: Location): Location[] {
        const selection = editor && wholeSelection(editor.state.selection);
        if (selection && selection.ranges.some(r => loc.pos >= r.$from.pos && loc.pos < r.$to.pos)) return selection.places();
        return [loc];
    }
    function relocate(places: Location[], position: number | null, select: boolean): boolean {
        const instance = editor;
        if (!instance || position === null || locked) return false;
        const moved = moveBlocks(instance.state, places, position);
        if (!moved) return false;
        if (select) moved.tr.setSelection(new BlockSelection(moved.tr.doc, moved.start, moved.start + places.slice(0, -1).reduce((n, p) => n + p.node.nodeSize, 0)));
        else {
            const offset = instance.state.selection.head - places[0].pos;
            if (offset > 0 && offset < places[0].node.nodeSize) selectionIn(moved.tr, moved.start + offset);
        }
        session.checkpoint(); instance.view.dispatch(moved.tr.scrollIntoView()); session.checkpoint(); instance.view.focus();
        return true;
    }
    function move(direction: -1 | 1): void {
        const instance = editor, loc = target() ?? (instance ? located(instance.state) : null);
        const places = loc ? selectedBlocks(loc) : [];
        close();
        if (instance && places.length && places[0].node.type.name !== "pageTitle")
            relocate(places, relativeDrop(instance.state.doc, places, direction < 0 ? "up" : "down"), !!wholeSelection(instance.state.selection));
    }
    function close(): void {
        pickerVersion++;
        menu = false;
        menuOrigin = null;
        picker = null;
        handle = null;
        caret = null;
        brackets = null;
    }
    let gesture: (() => void) | null = null;
    let indicator = $state.raw<Drop | null>(null);
    const handleAnchor = { getBoundingClientRect: (): DOMRect => root.querySelector(".handle button")?.getBoundingClientRect() ?? new DOMRect() };
    function handleDown(event: PointerEvent): void {
        const instance = editor, loc = target();
        if (event.button !== 0 || !instance || !loc || locked || instance.view.composing) return;
        const places = selectedBlocks(loc), doc = instance.state.doc;
        const elements = places.map(p => instance.view.nodeDOM(p.pos) as HTMLElement);
        const grabbed = instance.view.nodeDOM(loc.pos) as HTMLElement, origin = grabbed.getBoundingClientRect();
        const grip = { x: event.clientX - origin.left, y: event.clientY - origin.top };
        const indent = parseFloat(getComputedStyle(root).getPropertyValue("--ui-editor-indent"));
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Immutable ancestry lookup for this pointer gesture.
        const ids = new Set<string>();
        for (const { node } of places) {
            ids.add(node.attrs.blockId);
            node.descendants(child => {
                if (child.attrs.blockId) ids.add(child.attrs.blockId);
                return child.type.name === "pageBlock";
            });
        }
        let ghost: ReturnType<typeof dragPreview> | undefined;
        gesture = trackPointer(root, event, "drag", {
            move(point) {
                if (!ghost) {
                    ghost = dragPreview(elements, grabbed, grip);
                    instance.view.dispatch(instance.state.tr.setMeta(movingBlocks, places));
                }
                ghost.move(point);
                const next = dropAt(instance.view, point.x - grip.x, point.y, indent);
                if (next) {
                    const at = doc.resolve(next.pos);
                    for (let d = at.depth; d > 0; d--) if (ids.has(at.node(d).attrs.blockId)) {
                        indicator = null; return;
                    }
                }
                const bounds = root.getBoundingClientRect();
                indicator = next && !places.some(p => next.pos >= p.pos && next.pos <= p.pos + p.node.nodeSize)
                    ? { ...next, left: next.left - bounds.left, right: next.right - bounds.left, top: next.top - bounds.top } : null;
            },
            end(dragged, cancelled) {
                gesture = null;
                ghost?.close();
                if (ghost && !instance.isDestroyed && doc === instance.state.doc)
                    instance.view.dispatch(instance.state.tr.setMeta(movingBlocks, []));
                const next = indicator; indicator = null;
                if (cancelled || locked || doc !== instance.state.doc) return;
                if (!dragged) {
                    setBlockMenu(!menu); return;
                }
                if (next) relocate(places, next.pos, !!wholeSelection(instance.state.selection));
                handle = null;
            }
        });
    }
    function hover(event: PointerEvent): void {
        if (gesture) return;
        if (editor?.view.composing) return;
        hoverReference(event);
        if (!editor || locked || menu || picker || !(event.target instanceof Element) || event.target.closest(".handle")) return;
        const el = handleRowAtHeight(editor.view, event.clientY);
        if (!el) {
            handle = null;
            return;
        }
        const pos = blockPosition(editor.view, el), node = editor.state.doc.nodeAt(pos);
        if (node && node.attrs.blockId === el.dataset.blockId) placeHandle(el, { pos, node });
    }
    function placeHandle(el: HTMLElement, loc: { node: DocNode; pos: number }): void {
        const line = el.querySelector<HTMLElement>("[data-body],td p,.reference-title") ?? el;
        const rect = el.getBoundingClientRect(), first = line.getBoundingClientRect(), container = root.getBoundingClientRect();
        const height = parseFloat(getComputedStyle(line).lineHeight) || first.height;
        handle = {
            id: loc.node.attrs.blockId, pos: loc.pos, top: first.top - container.top + Math.min(first.height, height) / 2, left: rect.left - container.left,
            kind: kindOf(loc.node), shared: el.classList.contains("sync-block"), folded: !!loc.node.attrs.collapsed, children: loc.node.type.name === "pageBlock" && loc.node.childCount > 1
        };
    }
    function target(): { node: DocNode; pos: number } | null {
        const node = handle && editor?.state.doc.nodeAt(handle.pos);
        return node && node.attrs.blockId === handle?.id ? { pos: handle!.pos, node } : null;
    }
    function pick(mode: typeof picker): void {
        if (!editor || locked || editor.view.composing) return;
        const selected = located(editor.state);
        const loc = mode === "inline" ? selected : target();
        if (!loc) return close();
        if (mode === "inline") {
            const rect = editor.view.coordsAtPos(editor.state.selection.head), bounds = root.closest(".group-content")?.getBoundingClientRect() ?? root.getBoundingClientRect();
            pickerPosition = { x: rect.left, y: rect.bottom, left: bounds.left, right: bounds.right, bottom: bounds.bottom };
            handle = { id: loc.node.attrs.blockId, pos: loc.pos, top: 0, left: 0, kind: kindOf(loc.node), shared: false, folded: false, children: false };
        }
        pickerVersion++;
        caret = menuOrigin ?? editor.state.selection.getBookmark();
        menuOrigin = null;
        menu = false;
        picker = mode;
    }
    function choose(destination: Target, label: string): void {
        const instance = editor, mode = picker, request = ++pickerVersion;
        if (!instance || !target()) return close();
        void perform(async () => {
            const existing = mode === "sync" ? indexDoc(instance.state.doc).get(destination.id)?.[0].node : null;
            if (mode === "sync" && !existing) await session.objects([destination.id]);
            if (request !== pickerVersion || instance.isDestroyed) return;
            const loc = target(), saved = brackets ?? caret;
            close();
            if (!loc || instance.isDestroyed) return;
            const tr = instance.state.tr, pos = loc.pos + loc.node.nodeSize;
            if (mode === "inline" && saved) tr.setSelection(saved.resolve(tr.doc)).replaceSelectionWith(instance.schema.nodes.inlineReference.create({ target: destination, label }));
            else if (mode === "sync") {
                const node = existing ?? instance.schema.nodeFromJSON(subtree(destination.id, session.state.page!.blocks)), parent = tr.doc.resolve(loc.pos);
                for (let d = parent.depth; d > 0; d--) if (indexDoc(node).has(parent.node(d).attrs.blockId) || destination.id === parent.node(d).attrs.blockId) throw new LabloomError({ kind: "block-cycle" });
                tr.insert(pos, node).setMeta(syncInsert, true);
            }
            else tr.insert(pos, instance.schema.nodes.blocked_reference.create({ target: destination }));
            instance.view.dispatch(tr);
            await tick();
            if (!instance.isDestroyed) instance.view.focus();
        });
    }
    function convert(kind: ContentBlockKind): void {
        const loc = target(), instance = editor;
        const places = loc ? selectedBlocks(loc) : [];
        close();
        if (!instance || !places.length) return;
        void perform(async () => {
            const tr = instance.state.tr;
            for (const { pos, node } of places.slice().reverse()) {
                if (kind === kindOf(node)) continue;
                const data = blockData(node);
                if (data.children.length && !canNest(kind)) throw new LabloomError({ kind: "block-move-children" });
                if (data.type === "table" && node.textContent.trim()) throw new LabloomError({ kind: "block-move-table" });
                if (["hr", "table"].includes(kind) && node.textContent.trim()) throw new LabloomError({ kind: "block-move-text" });
                const body = { ...payload(kind), inline: data.payload.inline, collapsed: data.payload.collapsed };
                const json = blockJSON({ ...data, type: kind, payload: body }, data.children.map(id => subtree(id, session.state.page!.blocks)));
                tr.replaceWith(pos, pos + node.nodeSize, instance.schema.nodeFromJSON(json));
            }
            if (tr.docChanged) {
                const selected = wholeSelection(instance.state.selection);
                if (selected && places.length > 1) tr.setSelection(new BlockSelection(tr.doc, tr.mapping.map(selected.first, -1), tr.mapping.map(selected.last, -1)));
                instance.view.dispatch(tr);
            }
            instance.view.focus();
        });
    }
    function act(action: "delete" | "fold" | "unsync" | "row" | "column"): void {
        const loc = target(), instance = editor;
        const places = loc ? selectedBlocks(loc) : [];
        const collapse = !handle?.folded;
        close();
        if (!loc || !instance) return;
        const { node, pos } = loc;
        if (action === "delete") {
            const deletion = { pageId: session.state.page!.id, blockIds: places.map(place => place.node.attrs.blockId as string) };
            void perform(() => session.action((token, writeId) => window.api.pages.deleteBlock(deletion, session.source, token, writeId)));
            return;
        }
        if (places.length > 1) {
            const tr = instance.state.tr;
            if (action === "fold") for (const p of places) fold(tr, p, collapse);
            if (tr.docChanged) instance.view.dispatch(tr);
            instance.view.focus(); return;
        }
        if (action === "row" || action === "column") {
            if (located(instance.state)?.pos !== pos) instance.commands.setTextSelection(pos + 4);
            if (action === "row") instance.commands.addRowAfter(); else instance.commands.addColumnAfter();
        }
        else instance.view.dispatch(instance.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...(action === "fold" ? { collapsed: !node.attrs.collapsed } : { blockId: null }) }));
        instance.view.focus();
    }
    onMount(() => {
        const page = session.state.page!, inputHost = host;
        void perform(async () => {
            const state = await window.api.startup.getState();
            if (state.status === "ready") workspaceId = state.workspace.id;
        });
        const views = documentViews(linkGlyph.firstElementChild!, (element, target) => {
            const component = mount(ReferenceView, { target: element, props: { target, session } });
            return () => {
                void unmount(component);
            };
        });
        portal = root.closest<HTMLElement>(":popover-open") ?? undefined;
        const links = backlinkElement = document.createElement("div");
        const backlinks = pageAnchor ? mount(Backlinks, { target: links, props: {
            get links() {
                return session.state.backlinks;
            }, onopen: (id, otherGroup, anchorId) => openPage(id, { currentGroup: true, otherGroup, anchorId })
        } }) : null;
        const history = History.extend({
            addProseMirrorPlugins: () => [], addCommands: () => ({
                undo: () => ({ dispatch }) => {
                    const available = session.state.dirty || session.state.history.canUndo;
                    if (dispatch && available) void session.undo("undo");
                    return available;
                },
                redo: () => ({ dispatch }) => {
                    const available = session.state.history.canRedo && !session.state.dirty;
                    if (dispatch && available) void session.undo("redo");
                    return available;
                }
            })
        });
        let held: { maps: Mapping } | null = null;
        let compositionDoc: DocNode | null = null;
        const instance = new Editor({
            element: inputHost, content: pageDocument(page), editable: !locked,
            extensions: [...views, history, editing, Extension.create({ name: "syncBorders", addProseMirrorPlugins: () => [visibleCaret(), selectionDecorations(), borderPlugin(() => session.state.page?.sharedUses ?? {}), ...pageAnchor ? [backlinkRow(links, () => !!session.state.backlinks.length)] : []] })],
            editorProps: {
                attributes: { tabindex: "0", class: "editor-document" },
                handleKeyDown(_view, event) {
                    if (isComposingKey(event) || instance.view.composing) return false;
                    if (literal && event.key === "Backspace" && !locked && literal.after.doc === instance.state.doc && literal.after.selection.eq(instance.state.selection)) {
                        const previous = literal.before;
                        literal = null;
                        instance.view.dispatch(restoreLiteral(instance.state, previous)); session.checkpoint();
                        return true;
                    }
                    if (codeKeys(_view, event) || suggestionKey(event)) return true;
                    if ((menu || bodyOpen) && event.key === "Escape") {
                        menu = false; bodyOpen = false; event.preventDefault();
                        restoreEditor(); return true;
                    }
                    if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "/") {
                        if (keyboardBlock()) {
                            event.preventDefault(); return true;
                        }
                    }
                    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
                        event.preventDefault(); event.stopPropagation();
                        if (wholeSelection(instance.state.selection) && keyboardBlock()) return true;
                        const rect = instance.view.coordsAtPos(instance.state.selection.head);
                        host.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left, clientY: rect.bottom }));
                        return true;
                    }
                    if (!locked && event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "Enter") {
                        const loc = located(instance.state);
                        if (loc) {
                            const tr = fold(instance.state.tr, loc);
                            if (tr.docChanged) _view.dispatch(tr);
                        }
                        return true;
                    }
                    if (event.key.startsWith("Arrow") && skipFold(_view, event)) return true;
                    const selected = wholeSelection(instance.state.selection);
                    if (selected) {
                        if (event.ctrlKey && event.key.toLowerCase() === "a" && instance.state.doc.childCount > 1) {
                            const doc = instance.state.doc;
                            _view.dispatch(instance.state.tr.setSelection(new BlockSelection(doc, doc.firstChild!.nodeSize, doc.content.size - doc.lastChild!.nodeSize))); return true;
                        }
                        if (event.key === "Escape") {
                            _view.dispatch(selectionIn(instance.state.tr, selected.first + 1)); return true;
                        }
                        if (event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                            const dir = event.key === "ArrowUp" ? -1 : 1;
                            const next = adjacent(instance.state.doc, selected.last, dir, dir < 0);
                            if (next !== null) _view.dispatch(instance.state.tr.setSelection(new BlockSelection(instance.state.doc, selected.first, next)).scrollIntoView());
                            return true;
                        }
                        if (!locked && (event.key === "Tab" || event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key))) {
                            const places = selected.places();
                            relocate(places, relativeDrop(instance.state.doc, places, event.key === "Tab" ? (event.shiftKey ? "outdent" : "indent") : event.key === "ArrowUp" ? "up" : "down"), true);
                            return true;
                        }
                        if (!locked && (event.key === "Delete" || event.key === "Backspace")) {
                            _view.dispatch(instance.state.tr.setSelection(selected).deleteSelection().scrollIntoView()); return true;
                        }
                        if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key.length === 1 || event.key === "Enter")) {
                            _view.dispatch(selectionIn(instance.state.tr, selected.first + 2));
                            if (event.key === "Enter") return true;
                        }
                    }
                    if (locked) return false;
                    if (event.altKey && !event.ctrlKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
                        handle = null; move(event.key === "ArrowUp" ? -1 : 1); return true;
                    }
                    const key = event.code.replace("Digit", "");
                    const kind = event.ctrlKey && event.altKey && !event.shiftKey ? ({ "0": "paragraph", "1": "heading_1", "2": "heading_2", "3": "heading_3" } as const)[key as "0"] : event.ctrlKey && event.shiftKey && !event.altKey ? ({ "7": "ordered_list", "8": "unordered_list" } as const)[key as "7"] : undefined;
                    const loc = located(instance.state);
                    if (!kind || !loc || loc.node.type.name === "pageTitle") return false;
                    handle = { id: loc.node.attrs.blockId, pos: loc.pos, top: 0, left: 0, kind: kindOf(loc.node), shared: false, folded: false, children: false };
                    convert(kind); return true;
                },
                handleTextInput(view, from, to, text) {
                    if (locked || view.composing) return false;
                    const action = inputAction(view.state, from, to, text);
                    if (!action) return false;
                    view.dispatch(view.state.tr.insertText(text, from, to));
                    applyInput(instance, action);
                    return true;
                },
                handlePaste(view, event, slice) {
                    const data = event.clipboardData;
                    if (!data) return false;
                    const loc = located(view.state);
                    if (loc && kindOf(loc.node) === "code") {
                        const text = data.getData("text/plain").replace(/\r\n?/gu, "\n");
                        if (text) pasteCode(view, text);
                        return true;
                    }
                    const internal = data.getData("application/x-labloom-blocks");
                    if (internal) {
                        const clipboard = readClipboard(view.state.schema, internal);
                        if (clipboard) {
                            void perform(() => offerPaste(clipboard)); return true;
                        }
                    }
                    const html = data.getData("text/html"), plain = data.getData("text/plain");
                    if (located(view.state)?.node.type.name === "pageTable") return false;
                    const elements = html ? [...new DOMParser().parseFromString(html, "text/html").querySelectorAll("li,p")].filter(el => el.tagName === "LI" || !el.closest("li")) : [];
                    if (elements.some(el => el.tagName === "LI") || elements.length > 1 || /[\r\n]/u.test(plain)) {
                        const rows = elements.length ? elements.map(el => {
                            const content = el.cloneNode(true) as Element;
                            content.querySelectorAll("ul,ol").forEach(list => list.remove());
                            return { text: content.textContent ?? "", kind: el.tagName !== "LI" ? "paragraph" as const : el.parentElement?.tagName === "OL" ? "ordered_list" as const : "unordered_list" as const };
                        })
                            : plain.replace(/\r\n?/gu, "\n").split("\n").map(text => ({ text, kind: "paragraph" as const }));
                        view.dispatch(clipboardRows(view.state, rows));
                        return true;
                    }
                    return !slice.content.size;
                },
                handleDOMEvents: {
                    copy: (view, e) => copy(view, e, false), cut: (view, e) => copy(view, e, true),
                    compositionstart: () => {
                        clearPreview();
                        const selected = wholeSelection(instance.state.selection);
                        if (selected) instance.view.dispatch(selectionIn(instance.state.tr, selected.first + 2));
                        compositionDoc = instance.state.doc;
                        session.composition(true);
                        return false;
                    },
                    compositionend: (_view, event) => {
                        setTimeout(() => {
                            session.composition(false);
                            if (instance.isDestroyed || locked || instance.view.composing || !event.data && compositionDoc === instance.state.doc) return;
                            const { from, to } = instance.state.selection;
                            const action = inputAction(instance.state, from, to, "");
                            if (action) applyInput(instance, action);
                        }, 0);
                        return false;
                    }
                },
                handleClickOn(_view, _pos, node, _nodePos, event, direct) {
                    if (!direct || node.type.name !== "inlineReference") return false;
                    clearPreview();
                    void perform(() => openTarget(node.attrs.target, event.ctrlKey));
                    return true;
                }
            },
            onTransaction({ editor: ed, transaction, appendedTransactions }) {
                if (gesture && transaction.docChanged) gesture();
                if (transaction.selectionSet || transaction.docChanged) paintBands(ed.view);
                if (literal && (transaction.docChanged || transaction.selectionSet)) literal = null;
                const trs = [transaction, ...appendedTransactions];
                if (!held && !transaction.getMeta(remoteEdit) && (!ed.view.composing || slash) && !locked) {
                    const next = slashTrigger(ed.state, transaction, slash);
                    if (next?.query !== slash?.query) suggestionIndex = 0;
                    slash = next;
                }
                else slash = null;
                for (const tr of trs) {
                    if (handle && tr.docChanged) {
                        const p = tr.mapping.mapResult(handle.pos, 1);
                        if (tr.doc.nodeAt(p.pos)?.attrs.blockId !== handle.id) close();
                        else handle = { ...handle, pos: p.pos };
                    }
                    if (caret) caret = caret.map(tr.mapping);
                    if (brackets) brackets = brackets.map(tr.mapping);
                    if (menuOrigin) menuOrigin = menuOrigin.map(tr.mapping);
                    if (pendingPaste) pendingPaste.bookmark = pendingPaste.bookmark.map(tr.mapping);
                    if (preview) {
                        const pos = tr.mapping.map(preview.pos, 1);
                        preview = tr.doc.nodeAt(pos)?.type.name === "inlineReference" ? { ...preview, pos } : null;
                    }
                }
                if (!trs.some(tr => tr.docChanged)) return;
                if (held) {
                    for (const tr of trs) held.maps.appendMapping(tr.mapping);
                    return;
                }
                if (transaction.getMeta(remoteEdit)) return;
                const before = transaction.before, after = ed.state.doc, edit = documentEdit(before, after);
                if (transaction.getMeta(syncInsert)) {
                    edit.blocks = edit.blocks.filter(b => {
                        const cached = session.state.page!.blocks[b.id];
                        return !cached || JSON.stringify(cached) !== JSON.stringify(b);
                    });
                }
                if (!removesReference(edit, session.state.page!)) {
                    session.stage(edit);
                    return;
                }
                const ticket = held = { maps: new Mapping() };
                const undoSteps = inverse(trs);
                let reverted = false, accepted = false;
                let redoSteps: Step[] = [];
                session.review(edit, () => {
                    if (reverted || ed.isDestroyed) return;
                    const undo = replay(ed.state, undoSteps, ticket.maps);
                    redoSteps = inverse([undo]);
                    ed.view.dispatch(undo.setMeta(remoteEdit, true));
                    ticket.maps = new Mapping();
                    reverted = true;
                }, saved => {
                    accepted = true;
                    if (reverted && !ed.isDestroyed) ed.view.dispatch(replay(ed.state, redoSteps, ticket.maps).setMeta(remoteEdit, true));
                    if (!saved) {
                        session.stage(edit);
                        if (transaction.getMeta("workspace.move")) session.checkpoint();
                    }
                }, () => {
                    held = null;
                    const diff = documentEdit(accepted ? after : before, ed.state.doc);
                    if (diff.blocks.length || diff.pageChildren) session.stage(diff);
                });
            }
        });
        function copy(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
            if (view.state.selection.empty || !event.clipboardData) return false;
            const slice = view.state.selection.content(), data = view.serializeForClipboard(slice);
            const internal = writeClipboard(workspaceId, slice);
            if (internal) event.clipboardData.setData("application/x-labloom-blocks", internal);
            event.clipboardData.setData("text/html", data.dom.innerHTML);
            const { from, to } = view.state.selection;
            const first = located(view.state, from), last = located(view.state, to);
            let plain = data.text;
            if (first?.node.type.name === "codeBlock" && first.pos === last?.pos)
                plain = view.state.doc.textBetween(from, to, "\n", leaf => leaf.attrs.label ?? "");
            else if (slice.content.childCount === 1 && slice.content.firstChild!.type.name === "codeBlock")
                plain = blockText(blockData(slice.content.firstChild!));
            event.clipboardData.setData("text/plain", plain);
            if (cut && instance.isEditable) view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
            event.preventDefault();
            return true;
        }
        editor = instance;
        const geometry = new ResizeObserver(() => {
            if (bands.length) paintBands(instance.view);
        });
        geometry.observe(host);
        const offEditing = registerEditing(instance.view.dom, editingCommand);
        const detachInput = session.input.attach(instance);
        if (!locked) session.input.replay();
        if (!page.blocks[page.titleBlockId].payload.inline.length && !page.attributes.deleted &&
            tabState.groups.find(group => group.id === tabState.focusedGroupId)?.activeTabId === tabId) instance.commands.focus("start", { scrollIntoView: false });
        function hold(event: Event): void {
            if (!readingTabs.has(tabId) || page.attributes.deleted) return;
            if (event instanceof KeyboardEvent && isComposingKey(event)) return;
            if (event instanceof MouseEvent) {
                const at = instance.view.posAtCoords({ left: event.clientX, top: event.clientY });
                if (at) instance.view.dispatch(selectionIn(instance.state.tr, at.pos));
                instance.view.dom.focus({ preventScroll: true });
            }
            else if (event instanceof KeyboardEvent) session.input.key(event);
            else if (event instanceof InputEvent && event.inputType === "insertText" && event.data && !event.isComposing) session.input.text(event.data);
            event.preventDefault();
            event.stopImmediatePropagation();
        }
        const inputEvents = ["mousedown", "keydown", "beforeinput", "compositionstart", "paste", "cut", "drop"];
        for (const name of inputEvents) inputHost.addEventListener(name, hold, true);
        const off = session.listen((ids, whole) => {
            const update = patchDocument(instance.state, session.state.page!, ids, whole);
            instance.view.dispatch((update ?? instance.state.tr).setMeta(borders, true));
        });
        function outside(e: PointerEvent): void {
            if (slash && !(e.target instanceof Element && e.target.closest(".suggestion-menu"))) slash = null;
            if (preview && e.target instanceof Element && !e.target.closest(".editor-reference-preview,.inline-reference")) preview = null;
        }
        document.addEventListener("pointerdown", outside, true);
        return () => {
            off();
            geometry.disconnect(); gesture?.();
            offEditing();
            clearPreview();
            detachInput();
            for (const name of inputEvents) inputHost.removeEventListener(name, hold, true);
            document.removeEventListener("pointerdown", outside, true);
            instance.destroy();
            if (backlinks) void unmount(backlinks);
            pasteChoice = null;
            pendingPaste = null;
            editor = null;
        };
    });
    $effect(() => {
        const instance = editor, enabled = !locked;
        if (!enabled) slash = null;
        if (instance && instance.isEditable !== enabled) untrack(() => instance.setEditable(enabled, false));
    });
    $effect(() => {
        const visible = pageAnchor && !!session.state.backlinks.length, instance = editor;
        if (instance && backlinkElement && backlinkElement.isConnected !== visible)
            untrack(() => instance.view.dispatch(instance.state.tr));
    });
    $effect(() => {
        const request = pageAnchor && anchors.get(tabId);
        if (editor && request && (!locked || session.state.page?.attributes.deleted)) {
            anchors.delete(tabId);
            const loc = indexDoc(editor.state.doc).get(request.blockId)?.[0];
            if (loc) {
                const instance = editor, tr = reveal(instance.state.tr, loc.pos);
                if (tr.docChanged && !locked) {
                    session.checkpoint(); instance.view.dispatch(tr); session.checkpoint();
                }
                (instance.view.nodeDOM(loc.pos) as HTMLElement | null)?.scrollIntoView({ block: "center" });
            }
        }
    });
    $effect(() => {
        const shown = tabState.groups.some(group => group.activeTabId === tabId);
        if (editor) editor.view.dom.tabIndex = shown ? 0 : -1;
    });
</script>