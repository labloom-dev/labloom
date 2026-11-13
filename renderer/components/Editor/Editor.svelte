    <div class="editor content" class:paper={session.state.page?.kind === "paper"} bind:this={root} role="presentation" onclick={bottomClick} oncontextmenu={context} onpointermove={hover} onpointerleave={() => {
        if (!menu && !picker) handle = null;
        clearPreview();
    }}>
        <div bind:this={host}></div>
        {#if handle && !locked}
            <div class="handle" style:top={handle.top + "px"} style:left={handle.left + "px"}>
                <button aria-label="块菜单" title="块菜单" onmousedown={keep} onclick={() => {
                    menu = !menu; picker = null;
                }} oncontextmenu={event => {
                    event.preventDefault(); event.stopPropagation(); menu = true; picker = null;
                }}>⠿</button>
                {#if handle.shared}
                    <button class="unsync" onmousedown={keep} onclick={() => act("unsync")}>解除此位置的同步</button>
                {/if}
                {#if menu}
                    <div class="block-menu">
                        {#if handle.kind !== "source"}
                            <div class="conversion"><button onmousedown={keep} onkeydown={event => {
                                if (event.key === "ArrowRight") (event.currentTarget.nextElementSibling?.querySelector("button") as HTMLButtonElement)?.focus();
                            }}>转换为 ▸</button><div class="conversion-list compact-menu">
                                {#each kinds as item (item[0])}<button class="compact-item" onmousedown={keep} onclick={() => convert(item[0])}><span class="kind-icon">{kindIcons[item[0]]}</span>{item[1]}<kbd>{conversionShortcuts[item[0]] ?? ""}</kbd></button>{/each}
                            </div></div>
                        {/if}
                        {#if handle.kind === "table"}
                            <button onmousedown={keep} onclick={() => act("row")}>添加行</button>
                            <button onmousedown={keep} onclick={() => act("column")}>添加列</button>

                        {/if}
                        <button onmousedown={keep} onclick={() => pick("reference")}>在后面插入链接引用</button>
                        <button onmousedown={keep} onclick={() => pick("sync")}>在后面放入同步块</button>
                        {#if handle.children}<button onmousedown={keep} onclick={() => act("fold")}>{handle.folded ? "展开子块" : "折叠子块"}</button>{/if}
                        <button onmousedown={keep} onclick={() => move(-1)}>上移<kbd>Alt+↑</kbd></button>
                        <button onmousedown={keep} onclick={() => move(1)}>下移<kbd>Alt+↓</kbd></button>
                        <button onmousedown={keep} onclick={() => act("delete")}>删除块</button>
                    </div>
                {/if}
            </div>
        {/if}
    </div>
<div class="compact-menu body-context" popover="auto" bind:this={contextMenu} role="menu" onkeydown={contextKeys}>
    {#each bodyMenu as item (item.label)}<button class="compact-item" role="menuitem" onmousedown={keep} onclick={() => { contextMenu?.hidePopover(); item.run(); }}>{item.label}<kbd>{item.shortcut}</kbd></button>{/each}
</div>
{#if picker === "inline" && pickerPosition}<InlineTargetPicker position={pickerPosition} bounds={pickerBounds} onselect={choose} onclose={close} />
{:else if picker}
    <div class="picker-layer"><TargetPicker mode={picker === "sync" ? "sync" : "reference"} onselect={choose} onclose={close} /></div>
{/if}
{#if preview}
    <div class="preview" popover="manual" {@attach element => element.showPopover()} style:left={preview.x + "px"} style:top={preview.y + "px"}><ReferenceView {session} target={preview.target} /></div>
{/if}
{#if editor}<Toolbar {editor} {session} />{/if}

<style>
    .body-context { position: fixed; inset: auto; margin: 0; }
    .body-context button { width: 100%; }
    .editor { position: relative; min-height: calc(var(--pane-height, 100vh) - var(--pagebar-height)); min-width: 0; color: var(--dc-c-fg-default); background: var(--dc-c-bg-default); }
    .editor.paper { min-height: var(--editor-min-height); }
    .editor :global(.tiptap) { outline: none; min-height: var(--editor-min-height); padding: 16px 32px 20px 44px; user-select: text; }
    .editor :global([data-block-id]) { position: relative; min-width: 0; margin: 0; scroll-margin-top: 110px; }
    .editor :global(.tiptap h1) { font-size: 30px; margin-bottom: 14px; }
    .editor :global([data-body]), .editor :global(td p), .editor :global(th p) { margin: 0; min-height: 1.8em; line-height: 1.8; overflow-wrap: anywhere; }
    .editor :global(.focused-empty > [data-body]:has(>br:only-child)::before), .editor :global(h1.focused-empty:has(>br:only-child)::before) { content: "输入内容…"; color: var(--c-muted); opacity: .65; pointer-events: none; position: absolute; }
    .editor :global(h1:has(>br:only-child)::before) { content: "未命名"; }
    .editor :global([data-block-id] > [data-block-id]) { margin-left: 25px; }
    .editor :global([data-folded] > [data-block-id]) { display: none; }
    .editor :global([data-kind=heading_1] > p) { font-size: 24px; font-weight: 700; }
    .editor :global([data-kind=heading_2] > p) { font-size: 21px; font-weight: 700; }
    .editor :global([data-kind=heading_3] > p) { font-size: 18px; font-weight: 700; }
    .editor :global([data-kind=unordered_list] > p), .editor :global([data-kind=ordered_list] > p) { display: list-item; margin-left: 1.5em; }
    .editor :global([data-kind=ordered_list] > p) { list-style: decimal; }
    .editor :global([data-kind=blockquote]), .editor :global([data-kind=source]) { border-left: 3px solid var(--c-muted); padding-left: 12px; }
    .editor :global([data-kind=callout]), .editor :global([data-kind=code]) { background: var(--c-cream); padding-inline: 12px; border-radius: 4px; }
    .editor :global([data-kind=code] > p) { font-family: "JetBrains Mono",monospace; }
    .editor :global(.sync-block) { outline: 2px solid var(--dc-c-fg-blue, #4878b9); outline-offset: -1px; border-radius: 4px; padding-inline: 6px; }
    .editor :global(.inline-reference) { color: var(--dc-c-fg-blue); border-bottom: 1px dashed; cursor: pointer; white-space: nowrap; }
    .editor :global(.ProseMirror-selectednode) { background: var(--c-selection); }
    .editor :global(table) { border-collapse: collapse; width: 100%; table-layout: fixed; }
    .editor :global(td), .editor :global(th) { border: 1px solid var(--c-line); padding: 4px 8px; }
    .handle { position: absolute; z-index: 7; }
    .handle > button { color: var(--c-muted); cursor: pointer; height: 25px; }
    .handle .unsync { position: absolute; left: 26px; top: -20px; font-size: var(--font-min); background: var(--c-paper); white-space: nowrap; }
    .block-menu, .preview { border: 1px solid var(--c-line); background: var(--c-paper); border-radius: 6px; padding: 6px; box-shadow: 0 3px 12px #0002; }
    .block-menu { position: absolute; top: var(--panel-row-height); left: 0; width: 220px; font-size: var(--font-body); }
    .block-menu button { display: flex; align-items: center; width: 100%; height: var(--menu-row-height); padding: 0 6px; text-align: left; gap: 8px; }
    .block-menu kbd { margin-left: auto; color: var(--c-muted); font: inherit; font-size: var(--font-secondary); }
    .conversion { position: relative; }
    .conversion-list { display: none; position: absolute; top: 0; left: 100%; min-width: 240px; }
    .conversion:hover .conversion-list, .conversion:focus-within .conversion-list { display: block; }
    .kind-icon { width: 18px; text-align: center; }
    .block-menu button:hover { background: var(--c-sage); }
    .picker-layer { position: fixed; z-index: 80; inset: 0; display: grid; place-items: center; background: #0003; }
    .preview { position: fixed; z-index: 55; inset: auto; margin: 0; width: min(320px, 80vw); pointer-events: none; }
</style>
<script lang="ts">
    import { mount, onMount, unmount, untrack } from "svelte";
    import { Editor, Extension } from "@tiptap/core";
    import History from "@tiptap/extension-history";
    import { Slice, type Node as DocNode } from "@tiptap/pm/model";
    import { TextSelection, type SelectionBookmark } from "@tiptap/pm/state";
    import type { EditorView } from "@tiptap/pm/view";
    import { Mapping, type Step } from "@tiptap/pm/transform";
    import { conversionShortcuts, commands } from "../../../shared/content/commands";
    import { registerEditing, type EditingCommand } from "../layout/commands";
    import { openTarget } from "../layout/navigation";
    import InlineTargetPicker from "../Knowledge/InlineTargetPicker.svelte";
    import { type Target, type ContentBlockKind } from "../../../shared/types/content";
    import { payload } from "../../../shared/content/blocks";
    import { kinds } from "../../../shared/content/block-labels";
    import { type PageSession, perform } from "../Knowledge/state.svelte";
    import { readingTabs } from "../Tab/activity.svelte";
    import { tabState } from "../Tab/state.svelte";
    import ReferenceView from "../Knowledge/ReferenceView.svelte";
    import TargetPicker from "../Knowledge/TargetPicker.svelte";
    import Toolbar from "./Toolbar.svelte";
    import { blankBlock, blockData, blockJSON, canNest, documentEdit, documentExtensions, indexDoc, kindOf, pageDocument, referenceBlock, removesReference, subtree } from "./document";
    import { clipboardRows, editing, located, remoteEdit, selectionIn, shallowPaste, syncInsert } from "./transactions";
    import { borders, borderPlugin } from "./sync-border";
    import { inverse, patchDocument, replay } from "./reconcile";
    let { session, tabId, anchorId }: { session: PageSession; tabId: string; anchorId?: string } = $props();
    let root: HTMLDivElement, host: HTMLDivElement, editor = $state.raw<Editor | null>(null);
    let contextMenu = $state<HTMLDivElement>();
    const locked = $derived(readingTabs.has(tabId) || session.state.loading || !!session.state.page?.attributes.deleted);
    type Handle = { id: string; pos: number; top: number; left: number; kind: ContentBlockKind; shared: boolean; folded: boolean; children: boolean };
    let handle = $state.raw<Handle | null>(null), menu = $state(false), picker = $state<"inline" | "reference" | "sync" | null>(null);
    let caret: SelectionBookmark | null = null, preview = $state.raw<{ target: Target; pos: number; x: number; y: number } | null>(null);
    const kindIcons: Record<string, string> = { paragraph: "¶", heading_1: "H₁", heading_2: "H₂", heading_3: "H₃", unordered_list: "•", ordered_list: "1.", blockquote: "❞", callout: "ⓘ", code: "‹›", table: "▦", hr: "—" };
    let pickerPosition = $state<{ x: number; y: number } | null>(null), pickerBounds = $state({ left: 0, right: window.innerWidth, bottom: window.innerHeight });
    let hoveredReference: HTMLElement | null = null, previewTimer: ReturnType<typeof setTimeout> | undefined;
    const bodyMenu: { label: string; shortcut: string; run: () => void }[] = [...(["cut", "copy", "paste"] as const).map(id => ({ label: commands[id].label, shortcut: commands[id].shortcut, run: () => editingCommand(id) })), { label: "插入行内引用", shortcut: "", run: () => editingCommand("inlineReference") }];
    function editingCommand(command: EditingCommand): void {
        if (!editor) return;
        if (command === "inlineReference") {
            pick("inline"); return;
        }
        editor.view.focus();
        if (command === "undo" || command === "redo") {
            void session.undo(command); return;
        }
        if (command === "selectAll") editor.commands.selectAll();
        else document.execCommand(command);
    }
    function context(event: MouseEvent): void {
        if (!editor || event.target instanceof Element && event.target.closest(".handle")) return;
        const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        if (pos !== undefined && (pos < editor.state.selection.from || pos > editor.state.selection.to)) editor.view.dispatch(selectionIn(editor.state.tr, pos));
        caret = editor.state.selection.getBookmark();
        event.preventDefault();
        if (contextMenu) {
            contextMenu.showPopover();
            const bounds = root.closest(".group-content")?.getBoundingClientRect() ?? root.getBoundingClientRect();
            const menu = contextMenu.getBoundingClientRect();
            contextMenu.style.left = Math.max(bounds.left, Math.min(event.clientX, bounds.right - menu.width)) + "px";
            contextMenu.style.top = Math.max(bounds.top, Math.min(event.clientY, window.innerHeight - menu.height - 4)) + "px";
            contextMenu.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
        }
    }
    function contextKeys(event: KeyboardEvent): void {
        if (event.isComposing || !contextMenu) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const items = [...contextMenu.querySelectorAll<HTMLButtonElement>("button")], index = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
        }
        else if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); contextMenu.hidePopover(); editor?.view.focus(); }
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
            const rect = link.getBoundingClientRect(), bounds = root.closest(".group-content")?.getBoundingClientRect() ?? root.getBoundingClientRect();
            preview = { target: { kind: link.dataset.targetKind as Target["kind"], id: link.dataset.inlineTarget! }, pos: editor.view.posAtDOM(link, 0), x: Math.max(bounds.left, Math.min(rect.left, bounds.right - 320)), y: Math.min(rect.bottom + 4, window.innerHeight - 180) };
        }, 300);
    }
    function bottomClick(event: MouseEvent): void {
        if (!editor || locked || ![root, host, editor.view.dom].includes(event.target as HTMLDivElement)) return;
        const last = editor.view.dom.lastElementChild?.getBoundingClientRect();
        if (!last || event.clientY >= last.bottom) {
            const node = editor.state.doc.lastChild;
            if (node && kindOf(node) === "paragraph" && !node.textContent && node.childCount === 1) {
                editor.commands.focus("end");
            }
            else add();
        }
    }
    function move(direction: -1 | 1): void {
        const loc = target() ?? (editor ? located(editor.state) : null), instance = editor;
        close();
        if (!loc || !instance || loc.node.type.name === "pageTitle") return;
        const at = instance.state.doc.resolve(loc.pos), index = at.index() - 1;
        if (index + direction < 0 || index + direction >= at.parent.childCount - 1) return;
        const position = { pageId: session.state.page!.id, containerId: at.depth ? at.parent.attrs.blockId as string : session.state.page!.id, index, blockId: loc.node.attrs.blockId as string };
        void perform(() => session.action(token => window.api.knowledge.place({ position, action: direction < 0 ? "move-up" : "move-down", tabId }, token)));
    }
    function placeholder(): void {
        if (!editor || !host) return;
        host.querySelectorAll(".focused-empty").forEach(el => el.classList.remove("focused-empty"));
        const loc = located(editor.state);
        if (loc && editor.view.hasFocus() && !loc.node.textContent) (editor.view.nodeDOM(loc.pos) as HTMLElement | null)?.classList.add("focused-empty");
    }
    const keep = (event: MouseEvent): void => event.preventDefault();
    function close(): void {
        menu = false;
        picker = null;
        handle = null;
        caret = null;
    }
    function hover(event: PointerEvent): void {
        hoverReference(event);
        if (!editor || locked || menu || picker || !(event.target instanceof Element) || event.target.closest(".handle")) return;
        let el = event.target.closest<HTMLElement>("[data-block-id]");
        if (!el && handle && event.clientX < root.getBoundingClientRect().left + handle.left + 38) return;
        if (!el && event.clientX < root.getBoundingClientRect().left + 44) el = document.elementFromPoint(root.getBoundingClientRect().left + 48, event.clientY)?.closest("[data-block-id]") ?? null;
        if (!el || el.dataset.kind === "title") {
            handle = null;
            return;
        }
        const view = editor.view;
        const loc = indexDoc(editor.state.doc).get(el.dataset.blockId!)?.find(place => view.nodeDOM(place.pos) === el);
        if (!loc) return;
        const rect = el.getBoundingClientRect(), container = root.getBoundingClientRect();
        handle = {
            id: loc.node.attrs.blockId, pos: loc.pos, top: rect.top - container.top, left: Math.max(2, rect.left - container.left - 25),
            kind: kindOf(loc.node), shared: el.classList.contains("sync-block"), folded: !!loc.node.attrs.collapsed, children: loc.node.type.name === "pageBlock" && loc.node.childCount > 1
        };
    }
    function target(): { node: DocNode; pos: number } | null {
        const node = handle && editor?.state.doc.nodeAt(handle.pos);
        return node && node.attrs.blockId === handle?.id ? { pos: handle!.pos, node } : null;
    }
    function add(): void {
        if (!editor || locked) return;
        const tr = editor.state.tr, pos = tr.doc.content.size;
        editor.view.dispatch(selectionIn(tr.insert(pos, blankBlock(editor.schema)), pos + 2).scrollIntoView());
        editor.view.focus();
    }
    function pick(mode: typeof picker): void {
        if (!editor) return;
        const selected = located(editor.state);
        const loc = mode === "inline" ? selected : target();
        if (!loc) return close();
        if (mode === "inline") {
            const rect = editor.view.coordsAtPos(editor.state.selection.head), bounds = root.closest(".group-content")?.getBoundingClientRect() ?? root.getBoundingClientRect();
            pickerPosition = { x: rect.left, y: rect.bottom };
            pickerBounds = { left: bounds.left, right: bounds.right, bottom: bounds.bottom };
            handle = { id: loc.node.attrs.blockId, pos: loc.pos, top: 0, left: 0, kind: kindOf(loc.node), shared: false, folded: false, children: false };
        }
        caret = (selected?.pos === loc.pos ? editor.state.selection : TextSelection.near(editor.state.doc.resolve(loc.pos + 2))).getBookmark();
        menu = false;
        picker = mode;
    }
    function choose(destination: Target, label: string): void {
        const instance = editor, mode = picker;
        if (!instance || !target()) return close();
        void perform(async () => {
            const existing = mode === "sync" ? indexDoc(instance.state.doc).get(destination.id)?.[0].node : null;
            if (mode === "sync" && !existing) await session.objects([destination.id]);
            const loc = target(), saved = caret;
            close();
            if (!loc || instance.isDestroyed) return;
            const tr = instance.state.tr, pos = loc.pos + loc.node.nodeSize;
            if (mode === "inline" && saved) tr.setSelection(saved.resolve(tr.doc)).replaceSelectionWith(instance.schema.nodes.inlineReference.create({ target: destination, label }));
            else if (mode === "sync") {
                const node = existing ?? instance.schema.nodeFromJSON(subtree(destination.id, session.state.page!.blocks)), parent = tr.doc.resolve(loc.pos);
                for (let d = parent.depth; d > 0; d--) if (indexDoc(node).has(parent.node(d).attrs.blockId) || destination.id === parent.node(d).attrs.blockId) throw new Error("块包含关系不能形成循环。");
                tr.insert(pos, node).setMeta(syncInsert, true);
            }
            else tr.insert(pos, instance.schema.nodes.blocked_reference.create({ target: destination }));
            instance.view.dispatch(tr);
            instance.view.focus();
        });
    }
    function convert(kind: ContentBlockKind): void {
        const loc = target(), instance = editor;
        close();
        if (!loc || !instance || kind === kindOf(loc.node)) return;
        void perform(async () => {
            const data = blockData(loc.node);
            if (data.children.length && !canNest(kind)) throw new Error("请先移出此块的子块。");
            if (data.type === "table" && loc.node.textContent.trim()) throw new Error("请先移出表格内容。");
            if (["hr", "table"].includes(kind) && loc.node.textContent.trim()) throw new Error("请先移出块内文字。");
            const body = { ...payload(kind), inline: data.payload.inline, collapsed: data.payload.collapsed };
            const json = blockJSON({ ...data, type: kind, payload: body }, data.children.map(id => subtree(id, session.state.page!.blocks)));
            instance.view.dispatch(instance.state.tr.replaceWith(loc.pos, loc.pos + loc.node.nodeSize, instance.schema.nodeFromJSON(json)));
            instance.view.focus();
        });
    }
    function act(action: "delete" | "fold" | "unsync" | "row" | "column"): void {
        const loc = target(), instance = editor;
        close();
        if (!loc || !instance) return;
        const { node, pos } = loc;
        if (action === "delete") {
            void perform(() => session.action(token => window.api.knowledge.deleteBlock({ pageId: session.state.page!.id, tabId, blockId: node.attrs.blockId }, token)));
            return;
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
        const card = referenceBlock.extend({
            addNodeView: () => ({ node }) => {
                const dom = document.createElement("div");
                dom.dataset.kind = "blocked_reference";
                dom.dataset.blockId = node.attrs.blockId;
                dom.contentEditable = "false";
                const component = node.attrs.target ? mount(ReferenceView, { target: dom, props: { target: node.attrs.target, session } }) : null;
                if (!component) dom.textContent = "引用目标缺失";
                return {
                    dom, stopEvent: e => e.target instanceof Element && !!e.target.closest("button"), destroy: () => {
                        if (component) void unmount(component);
                    }
                };
            }
        });
        const history = History.extend({
            addProseMirrorPlugins: () => [], addCommands: () => ({
                undo: () => ({ dispatch }) => {
                    if (dispatch) void session.undo("undo");
                    return session.state.dirty || session.state.history.canUndo;
                },
                redo: () => ({ dispatch }) => {
                    if (dispatch) void session.undo("redo");
                    return !!session.state.history.redo.length;
                }
            })
        });
        let held: { maps: Mapping } | null = null;
        const instance = new Editor({
            element: inputHost, content: pageDocument(page), editable: !locked,
            extensions: [...documentExtensions.filter(e => e !== referenceBlock), card, history, editing, Extension.create({ name: "syncBorders", addProseMirrorPlugins: () => [borderPlugin(() => session.state.page?.sharedUses ?? {})] })],
            editorProps: {
                attributes: { tabindex: "0" },
                handleKeyDown(_view, event) {
                    if (event.isComposing) return false;
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
                handlePaste(view, event, slice) {
                    const data = event.clipboardData;
                    if (!data) return false;
                    const internal = data.getData("application/x-labloom-blocks");
                    if (internal) {
                        const paste = shallowPaste(Slice.fromJSON(view.state.schema, JSON.parse(internal)));
                        const inherited: string[] = [];
                        paste.content.descendants(node => {
                            if (node.attrs.blockId) inherited.push(node.attrs.blockId);
                        });
                        view.dispatch(view.state.tr.replaceSelection(paste).setMeta("workspace.paste", true).setMeta("workspace.inherited", inherited).scrollIntoView());
                        return true;
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
                        session.composition(true);
                        return false;
                    },
                    compositionend: () => {
                        setTimeout(() => session.composition(false), 0);
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
                placeholder();
                const trs = [transaction, ...appendedTransactions];
                for (const tr of trs) {
                    if (handle && tr.docChanged) {
                        const p = tr.mapping.mapResult(handle.pos, 1);
                        if (tr.doc.nodeAt(p.pos)?.attrs.blockId !== handle.id) close();
                        else handle = { ...handle, pos: p.pos };
                    }
                    if (caret) caret = caret.map(tr.mapping);
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
                if (transaction.getMeta(syncInsert) || transaction.getMeta("workspace.paste")) {
                    const inherited = new Set<string>(transaction.getMeta("workspace.inherited") ?? []);
                    edit.blocks = edit.blocks.filter(b => {
                        const cached = session.state.page!.blocks[b.id];
                        if (cached && JSON.stringify(cached) === JSON.stringify(b)) return false;
                        if (!inherited.has(b.id) || indexDoc(before).has(b.id)) return true;
                        session.state.page!.blocks[b.id] = b;
                        return false;
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
                    if (!saved) session.stage(edit);
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
            event.clipboardData.setData("application/x-labloom-blocks", JSON.stringify(slice.toJSON()));
            event.clipboardData.setData("text/html", data.dom.innerHTML);
            event.clipboardData.setData("text/plain", data.text);
            if (cut && instance.isEditable) view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
            event.preventDefault();
            return true;
        }
        editor = instance;
        const offEditing = registerEditing(instance.view.dom, editingCommand);
        instance.on("focus", placeholder);
        instance.on("blur", placeholder);
        const detachInput = session.input.attach(instance);
        if (!locked) session.input.replay();
        if (!page.blocks[page.titleBlockId].payload.inline.length && !page.attributes.deleted &&
            tabState.groups.find(group => group.id === tabState.focusedGroupId)?.activeTabId === tabId) instance.commands.focus("start", { scrollIntoView: false });
        function hold(event: Event): void {
            if (!readingTabs.has(tabId) || page.attributes.deleted) return;
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
            if (e.target instanceof Element && !e.target.closest(".handle,.picker-layer,.inline-picker,.block-menu")) close();
            if (preview && e.target instanceof Element && !e.target.closest(".preview,.inline-reference")) preview = null;
        }
        document.addEventListener("pointerdown", outside, true);
        return () => {
            off();
            offEditing();
            clearPreview();
            detachInput();
            for (const name of inputEvents) inputHost.removeEventListener(name, hold, true);
            document.removeEventListener("pointerdown", outside, true);
            instance.destroy();
            editor = null;
        };
    });
    $effect(() => {
        const instance = editor, enabled = !locked;
        if (instance && instance.isEditable !== enabled) untrack(() => instance.setEditable(enabled, false));
    });
    $effect(() => {
        if (editor && anchorId) {
            const loc = indexDoc(editor.state.doc).get(anchorId)?.[0];
            if (loc) (editor.view.nodeDOM(loc.pos) as HTMLElement | null)?.scrollIntoView({ block: "center" });
        }
    });
    $effect(() => {
        const shown = tabState.groups.some(group => group.activeTabId === tabId);
        if (editor) editor.view.dom.tabIndex = shown ? 0 : -1;
    });
</script>