<div class="editor content" bind:this={root} role="presentation" onpointermove={hover} onpointerleave={() => {
    if (!menu && !picker) handle = null;
}}>
    <div bind:this={host}></div>
    {#if handle && !locked}
        <div class="handle" style:top={handle.top + "px"} style:left={handle.left + "px"}>
            <button aria-label="块菜单" title="块菜单" onmousedown={keep} onclick={() => {
                menu = !menu; picker = null;
            }}>⠿</button>
            {#if handle.shared}
                <button class="unsync" onmousedown={keep} onclick={() => act("unsync")}>解除此位置的同步</button>
            {/if}
            {#if menu}
                <div class="block-menu">
                    {#if handle.kind !== "source"}
                        <label>转换为<select value={handle.kind} onchange={e => convert(e.currentTarget.value as ContentBlockKind)}>
                            {#each kinds as item (item[0])}<option value={item[0]}>{item[1]}</option>{/each}
                        </select></label>
                    {/if}
                    {#if handle.kind === "table"}
                        <button onmousedown={keep} onclick={() => act("row")}>添加行</button>
                        <button onmousedown={keep} onclick={() => act("column")}>添加列</button>
                    {:else if handle.kind !== "source" && handle.kind !== "hr" && handle.kind !== "blocked_reference"}
                        <button onmousedown={keep} onclick={() => pick("inline")}>插入行内引用</button>
                    {/if}
                    <button onmousedown={keep} onclick={() => pick("reference")}>在后面插入链接引用</button>
                    <button onmousedown={keep} onclick={() => pick("sync")}>在后面放入同步块</button>
                    {#if handle.children}<button onmousedown={keep} onclick={() => act("fold")}>{handle.folded ? "展开子块" : "折叠子块"}</button>{/if}
                    <button onmousedown={keep} onclick={() => act("delete")}>删除块</button>
                </div>
            {/if}
        </div>
    {/if}
    <button class="add-block" disabled={locked} onclick={add}>＋ 添加块</button>
</div>
{#if picker}
    <div class="picker-layer"><TargetPicker mode={picker === "sync" ? "sync" : "reference"} onselect={choose} onclose={close} /></div>
{/if}
{#if preview}
    <div class="preview"><ReferenceView {session} target={preview.target} /><button onclick={() => preview = null}>关闭预览</button></div>
{/if}
{#if editor && dock}<Toolbar {editor} {dock} />{/if}

<style>
    .editor { position: relative; min-width: 0; color: var(--dc-c-fg-default); background: var(--dc-c-bg-default); }
    .editor :global(.tiptap) { outline: none; min-height: 180px; padding: 16px 32px 20px 44px; user-select: text; }
    .editor :global([data-block-id]) { position: relative; min-width: 0; margin: 0; scroll-margin-top: 110px; }
    .editor :global(.tiptap h1) { font-size: 30px; margin-bottom: 14px; }
    .editor :global([data-body]), .editor :global(td p), .editor :global(th p) { margin: 0; min-height: 1.8em; line-height: 1.8; overflow-wrap: anywhere; }
    .editor :global([data-body]:has(>br:only-child)::before), .editor :global(h1:has(>br:only-child)::before) { content: "输入内容…"; color: var(--c-muted); opacity: .65; pointer-events: none; position: absolute; }
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
    .handle .unsync { position: absolute; left: 26px; top: -20px; font-size: 10px; background: var(--c-paper); white-space: nowrap; }
    .block-menu, .preview { border: 1px solid var(--c-line); background: var(--c-paper); border-radius: 6px; padding: 6px; box-shadow: 0 3px 12px #0002; }
    .block-menu { position: absolute; top: 22px; left: 0; width: 190px; }
    .block-menu button,.block-menu label { display: block; width: 100%; padding: 6px; text-align: left; }
    .block-menu button:hover { background: var(--c-sage); }
    .picker-layer { position: fixed; z-index: 80; inset: 0; display: grid; place-items: center; background: #0003; }
    .preview { position: fixed; z-index: 55; right: 20px; bottom: 20px; max-width: min(420px, 80vw); }
    .add-block { margin: 0 0 24px 44px; color: var(--c-muted); }
</style>
<script lang="ts">
    import { mount, onMount, unmount, untrack } from "svelte";
    import { Editor, Extension } from "@tiptap/core";
    import History from "@tiptap/extension-history";
    import { Slice, type Node as DocNode } from "@tiptap/pm/model";
    import { NodeSelection, TextSelection, type SelectionBookmark } from "@tiptap/pm/state";
    import type { EditorView } from "@tiptap/pm/view";
    import { Mapping, type Step } from "@tiptap/pm/transform";
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
    let { session, tabId, dock }: { session: PageSession; tabId: string; dock?: HTMLDivElement } = $props();
    let root: HTMLDivElement, host: HTMLDivElement, editor = $state.raw<Editor | null>(null);
    const locked = $derived(readingTabs.has(tabId) || session.state.loading || !!session.state.page?.attributes.deleted);
    type Handle = { id: string; pos: number; top: number; left: number; kind: ContentBlockKind; shared: boolean; folded: boolean; children: boolean };
    let handle = $state.raw<Handle | null>(null), menu = $state(false), picker = $state<"inline" | "reference" | "sync" | null>(null);
    let caret: SelectionBookmark | null = null, preview = $state.raw<{ target: Target; pos: number } | null>(null);
    const keep = (event: MouseEvent): void => event.preventDefault();
    function close(): void {
        menu = false;
        picker = null;
        handle = null;
        caret = null;
    }
    function hover(event: PointerEvent): void {
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
        const loc = target();
        if (!loc) return close();
        const selected = located(editor.state);
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
        const page = session.state.page!;
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
                    return session.state.history.canUndo;
                },
                redo: () => ({ dispatch }) => {
                    if (dispatch) void session.undo("redo");
                    return !!session.state.history.redo.length;
                }
            })
        });
        let held: { maps: Mapping } | null = null;
        const instance = new Editor({
            element: host, content: pageDocument(page), editable: !locked,
            extensions: [...documentExtensions.filter(e => e !== referenceBlock), card, history, editing, Extension.create({ name: "syncBorders", addProseMirrorPlugins: () => [borderPlugin(() => session.state.page?.sharedUses ?? {})] })],
            editorProps: {
                attributes: { tabindex: "0" },
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
                handleClickOn(view, _pos, node, nodePos, _event, direct) {
                    if (!direct || node.type.name !== "inlineReference") return false;
                    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)));
                    preview = { target: node.attrs.target, pos: nodePos };
                    return true;
                }
            },
            onTransaction({ editor: ed, transaction, appendedTransactions }) {
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
        for (const name of inputEvents) host.addEventListener(name, hold, true);
        const off = session.listen((ids, whole) => {
            const update = patchDocument(instance.state, session.state.page!, ids, whole);
            instance.view.dispatch((update ?? instance.state.tr).setMeta(borders, true));
        });
        function outside(e: PointerEvent): void {
            if (e.target instanceof Element && !e.target.closest(".handle,.picker-layer")) close();
            if (preview && e.target instanceof Element && !e.target.closest(".preview,.inline-reference")) preview = null;
        }
        document.addEventListener("pointerdown", outside, true);
        return () => {
            off();
            detachInput();
            for (const name of inputEvents) host.removeEventListener(name, hold, true);
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
        const shown = tabState.groups.some(group => group.activeTabId === tabId);
        if (editor) editor.view.dom.tabIndex = shown ? 0 : -1;
    });
</script>