<div class="editor" class:compact>
    {#if !readonly}
        <div class="block-toolbar" aria-label="文档编辑工具">
            <select aria-label="块类型" onchange={setBlock}><option value="paragraph">正文</option><option value="heading1">一级标题</option><option value="heading2">二级标题</option><option value="heading3">三级标题</option><option value="bullet">项目列表</option><option value="ordered">编号列表</option><option value="quote">引用段落</option><option value="code">代码块</option></select>
            <button onclick={() => editor?.chain().focus().undo().run()} title="撤销">撤销</button><button onclick={() => editor?.chain().focus().redo().run()} title="重做">重做</button>
            <button onclick={() => moveBlock(-1)} title="上移当前内容块">上移</button><button onclick={() => moveBlock(1)} title="下移当前内容块">下移</button><span></span><button onclick={() => showURL = !showURL}>网址</button><button onclick={insertImage}>图片</button><button onclick={insertTable}>表格</button><button onclick={() => showLinks = !showLinks}>页面链接</button>
        </div>
        {#if inTable}<div class="block-toolbar"><span>表格操作</span><button onclick={() => tableCommand(addRowAfter)}>添加行</button><button onclick={() => tableCommand(addColumnAfter)}>添加列</button><button onclick={() => tableCommand(deleteRow)}>删除行</button><button onclick={() => tableCommand(deleteColumn)}>删除列</button><button onclick={() => tableCommand(deleteTable)}>删除表格</button></div>{/if}
        {#if showURL}<form class="link-picker" onsubmit={setURL}><input aria-label="链接网址" bind:value={url} type="url" placeholder="https://example.org" required /><button class="button">插入网址</button><button class="button" type="button" onclick={() => { editor?.chain().focus().unsetLink().run(); showURL = false; }}>移除网址链接</button></form>{/if}
        {#if showLinks}<form class="link-picker" onsubmit={findPages}><input bind:value={linkQuery} aria-label="查找链接目标" placeholder="搜索要引用或同步的页面" /><button class="button">查找</button><select bind:value={linkMode} aria-label="链接形式"><option value="reference">引用</option><option value="sync">同步</option></select>{#if linkMode === "sync"}<label><input type="checkbox" bind:checked={linkWritable} />可写</label>{/if}<div class="link-results">{#each linkResults as result (result.id)}<div class="target-row"><button type="button" onclick={() => insertReference(result)}>{result.title}</button><button type="button" onclick={() => chooseBlocks(result)}>选择内容块</button></div>{/each}</div>{#if blockTarget}<div class="link-results"><strong>{blockTarget.title} 的内容块</strong>{#each blockOptions as block}<button type="button" onclick={() => insertReference(blockTarget!, String(block.attrs?.uid))}>{documentText(block).slice(0, 100) || block.type}</button>{/each}</div>{/if}</form>{/if}
    {/if}
    {#if message}<p class="notice error" role="alert">{message}</p>{/if}
    <div class="editor-body" spellcheck="false"><Toolbar {editor} /><div bind:this={element}></div></div>
    {#if !readonly && !compact}<footer><span>选中文字可以调整格式与颜色。Tab 缩进列表，Shift + Tab 取消缩进。</span><span>{saving ? "正在保存…" : dirty ? "等待保存" : "已保存到工作区"}</span></footer>{/if}
</div>


<style>
    .editor { min-width: 0; }
    .block-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; padding: 9px; border-bottom: 1px solid var(--c-line); }
    .block-toolbar select, .block-toolbar button { padding: 7px 8px; border: 1px solid transparent; border-radius: 7px; background: transparent; font-size: 11px; }
    .block-toolbar button:hover { background: var(--c-gold-light); border-color: var(--c-tab-header-border); }
    .block-toolbar select { max-width: 130px; border-color: var(--c-tab-header-border); background: var(--c-paper); }
    .block-toolbar > span { flex: 1; }
    .editor-body { container-type: inline-size; background: var(--c-paper); min-height: 330px; border-radius: 12px; }
    .compact .editor-body { min-height: 80px; }
    .compact :global(.tiptap.ProseMirror) { min-height: 80px; padding: 18px 12px; }
    footer { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding: 13px 18px; border-top: 1px solid var(--c-line); color: var(--c-muted); font-size: 10px; }
    .link-picker { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; padding: 15px; background: var(--c-gold-light); font-size: 12px; }
    .link-picker input:not([type="checkbox"]), .link-picker select { min-width: 0; padding: 8px 10px; border: 1px solid var(--c-tab-header-border); border-radius: 7px; background: var(--c-paper); }
    .link-picker > input { flex: 1; }
    .link-results { width: 100%; max-height: 200px; overflow: auto; }
    .link-results button { display: block; width: 100%; padding: 9px; border-radius: 7px; text-align: left; }
    .target-row { display: flex; align-items: center; gap: 10px; }
    .target-row button:last-child { width: auto; flex-shrink: 0; font-size: 10px; text-decoration: underline; }
    .link-results button:hover { background: var(--c-paper); }
    .notice { margin: 12px; }
    .editor :global(.tiptap h1), .editor :global(.tiptap h2), .editor :global(.tiptap h3) { line-height: 1.5; margin: 18px 0 10px; }
    .editor :global(.tiptap blockquote) { border-left: 3px solid var(--c-gold); margin: 12px 0; padding: 5px 18px; background: var(--c-cream); }
    .editor :global(.tiptap pre) { padding: 16px; white-space: pre-wrap; border-radius: 10px; background: var(--c-cream); font-family: var(--dc-font-mono); }
    .editor :global(.tiptap li) { margin: 4px 0; }
    .editor :global(.document-image) { display: block; max-width: 100%; height: auto; border-radius: 8px; }
    .editor :global(table) { table-layout: fixed; width: 100%; border-collapse: collapse; margin: 15px 0; }
    .editor :global(td), .editor :global(th) { padding: 8px; border: 1px solid var(--c-tab-header-border); vertical-align: top; }
    .editor :global(th) { background: var(--c-gold-light); }
    .editor :global(a) { color: var(--c-accent); text-decoration: underline; }
    .editor :global(.ProseMirror-selectednode) { outline: 2px solid var(--c-border-focus); outline-offset: 2px; }
</style>


<script lang="ts">
    import { onMount, untrack } from "svelte";
    import { Editor } from "@tiptap/core";
    import { Selection, type Command } from "@tiptap/pm/state";
    import { addRowAfter, addColumnAfter, deleteRow, deleteColumn, deleteTable } from "@tiptap/pm/tables";
    import { documentText } from "../../../shared/utils/document";
    import type { DocumentNode, PageSummary, RichDocument } from "../../../shared/types/knowledge";
    import StarterKit from "@tiptap/starter-kit";
    import History from "@tiptap/extension-history";
    import Document from "@tiptap/extension-document";
    import Text from "@tiptap/extension-text";
    import Dropcursor from "@tiptap/extension-dropcursor";
    import Placeholder from "@tiptap/extension-placeholder";
    import Paragraph from "./extensions/block/Paragraph";
    import trailingP from "./extensions/technical/trailingP";
    import ClearMarksOnEmptyBlock from "./extensions/ClearMarksOnEmptyBlock";
    import bold from "./extensions/mark/bold";
    import italic from "./extensions/mark/italic";
    import underline from "./extensions/mark/underline";
    import strike from "./extensions/mark/strike";
    import bgColor from "./extensions/mark/bgColor";
    import fgColor from "./extensions/mark/fgColor";
    import code from "./extensions/mark/code";
    import { BlockIdentity, LocalImage, TableEditing, Table, TableCell, TableHeader, TableRow, pageReference } from "./extensions/content.svelte";
    import Toolbar from "./Toolbar.svelte";
    import { sessions, editPage } from "../Knowledge/state.svelte";

    let { pageId, blockId, readonly = false, compact = false, ancestors = [pageId] }: { pageId: string; blockId?: string; readonly?: boolean; compact?: boolean; ancestors?: string[] } = $props();
    let element: HTMLDivElement;
    let editor = $state.raw<Editor | null>(null);
    let message = $state("");
    let inTable = $state(false);
    let showURL = $state(false);
    let url = $state("");
    let blockTarget = $state<PageSummary | null>(null);
    let blockOptions = $state<DocumentNode[]>([]);
    let showLinks = $state(false);
    let linkQuery = $state("");
    let linkResults = $state<PageSummary[]>([]);
    let linkMode = $state<"reference" | "sync">("reference");
    let linkWritable = $state(false);
    const dirty = $derived(sessions[pageId]?.dirty);
    const saving = $derived(sessions[pageId]?.saving);
    const document = $derived.by((): RichDocument => {
        const document = sessions[pageId]?.page?.document ?? { type: "doc", content: [{ type: "paragraph" }] };
        if (!blockId) return document;
        const block = document.content.find(node => node.attrs?.uid === blockId);
        return { type: "doc", content: block ? [block] : [{ type: "paragraph" }] };
    });

    onMount(() => {
        const instance = new Editor({
            element, editable: !readonly,
            editorProps: { handleKeyDown(view, event) {
                if ((event.ctrlKey || event.metaKey) && (event.key === "Home" || event.key === "End") && !event.shiftKey) {
                    event.preventDefault();
                    view.dispatch(view.state.tr.setSelection(event.key === "Home" ? Selection.atStart(view.state.doc) : Selection.atEnd(view.state.doc)).scrollIntoView());
                    return true;
                }
                return false;
            }, handleClick(_view, _position, event) {
                const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
                if (link && (readonly || event.ctrlKey || event.metaKey)) { event.preventDefault(); void window.api.knowledge.openURL(link.href).catch(error => { message = String(error); }); return true; }
                return false;
            } },
            extensions: [
                StarterKit.configure({ document: false, paragraph: false, text: false, bold: false, italic: false, underline: false, strike: false, code: false, undoRedo: false, dropcursor: false, trailingNode: false, link: { openOnClick: false, autolink: false } }),
                History, ClearMarksOnEmptyBlock, trailingP, Document, Paragraph, Text,
                Placeholder.configure({ emptyEditorClass: "dc-editor-empty", emptyNodeClass: "dc-empty", placeholder: "写下一个想法，让它从这里开始生长…" }),
                Dropcursor.configure({ color: "var(--dc-c-drop-cursor)", width: 2 }),
                bold, italic, underline, strike, bgColor, fgColor, code, BlockIdentity, LocalImage, TableEditing, Table, TableRow, TableCell, TableHeader, pageReference(ancestors)
            ],
            content: $state.snapshot(document),
            onSelectionUpdate: ({ editor: instance }) => { inTable = instance.isActive("table"); },
            onUpdate: ({ editor: instance }) => {
                inTable = instance.isActive("table");
                const next = instance.getJSON() as RichDocument;
                if (!blockId) editPage(pageId, { document: next });
                else {
                    const full: RichDocument = structuredClone($state.snapshot(sessions[pageId].page!.document));
                    const index = full.content.findIndex(node => node.attrs?.uid === blockId);
                    if (index >= 0) { full.content.splice(index, 1, ...next.content); editPage(pageId, { document: full }); }
                }
            }
        });
        editor = instance;
        return () => instance.destroy();
    });
    $effect(() => {
        const instance = editor;
        if (instance && !instance.isDestroyed && instance.isEditable === readonly) instance.setEditable(!readonly);
        const snapshot = $state.snapshot(document);
        if (!instance || instance.isDestroyed) return;
        untrack(() => { if (JSON.stringify(instance.getJSON()) !== JSON.stringify(snapshot)) instance.commands.setContent(snapshot, { emitUpdate: false }); });
    });

    function tableCommand(command: Command): void { editor?.chain().focus().command(({ state, dispatch }) => command(state, dispatch)).run(); }
    function moveBlock(direction: -1 | 1): void {
        editor?.chain().focus().command(({ state, tr, dispatch }) => {
            const index = state.selection.$from.index(0);
            const next = index + direction;
            if (index < 0 || index >= state.doc.childCount || next < 0 || next >= state.doc.childCount) return false;
            let position = 0;
            for (let i = 0; i < index; i++) position += state.doc.child(i).nodeSize;
            const block = state.doc.child(index);
            const destination = position + direction * state.doc.child(next).nodeSize;
            if (dispatch) { tr.delete(position, position + block.nodeSize).insert(destination, block); tr.setSelection(Selection.near(tr.doc.resolve(destination + 1))); }
            return true;
        }).run();
    }
    function setURL(event: SubmitEvent): void {
        event.preventDefault();
        try {
            const parsed = new URL(url);
            if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("请使用不含凭据的 HTTP 或 HTTPS 网址。");
            if (editor?.state.selection.empty) editor.chain().focus().insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: parsed.href } }] }).run();
            else editor?.chain().focus().setLink({ href: parsed.href }).run();
            showURL = false; url = "";
        }
        catch (error) { message = error instanceof Error ? error.message : "网址无效。"; }
    }
    async function chooseBlocks(page: PageSummary): Promise<void> {
        try { const record = await window.api.knowledge.get(page.id); blockTarget = page; blockOptions = record.document.content.filter(node => node.attrs?.uid); }
        catch (error) { message = error instanceof Error ? error.message : "内容块读取失败。"; }
    }
    function setBlock(event: Event): void {
        const value = (event.currentTarget as HTMLSelectElement).value;
        const chain = editor?.chain().focus();
        if (!chain) return;
        if (value === "paragraph") chain.setParagraph().run();
        else if (value.startsWith("heading")) chain.toggleHeading({ level: Number(value.at(-1)) as 1 | 2 | 3 }).run();
        else if (value === "bullet") chain.toggleBulletList().run();
        else if (value === "ordered") chain.toggleOrderedList().run();
        else if (value === "quote") chain.toggleBlockquote().run();
        else if (value === "code") chain.toggleCodeBlock().run();
    }
    async function insertImage(): Promise<void> {
        try { const src = await window.api.knowledge.importImage(); if (src && editor && !editor.isDestroyed) editor.chain().focus().insertContent({ type: "image", attrs: { src, alt: "本地图片" } }).run(); }
        catch (error) { message = error instanceof Error ? error.message : "图片导入失败。"; }
    }
    function insertTable(): void {
        editor?.chain().focus().insertContent({ type: "table", content: Array.from({ length: 3 }, (_, row) => ({ type: "tableRow", content: Array.from({ length: 3 }, () => ({ type: row ? "tableCell" : "tableHeader", content: [{ type: "paragraph" }] })) })) }).run();
    }
    async function findPages(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        try { linkResults = (await window.api.knowledge.list({ keyword: linkQuery, limit: 20 })).items; }
        catch (error) { message = error instanceof Error ? error.message : "搜索失败。"; }
    }
    function insertReference(page: PageSummary, targetBlockId?: string): void {
        editor?.chain().focus().insertContent({ type: "pageReference", attrs: { targetId: page.id, blockId: targetBlockId ?? null, title: page.title, linkId: crypto.randomUUID(), mode: linkMode, writable: linkMode === "sync" && linkWritable } }).run();
        showLinks = false;
    }
</script>