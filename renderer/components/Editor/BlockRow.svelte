{#if !block}
    <div class="missing">缺失块 <button disabled={locked} onclick={() => action("remove")}>移除此位置</button></div>
{:else if !ancestors.includes(block.id)}
    <div class="block-row" bind:this={element} class:heading={block.type.startsWith("heading_")} class:quote={block.type === "blockquote" || block.type === "callout"} class:code={block.type === "code"} data-block-id={block.id} data-block-type={block.type}>
        <div class="line">
            <details class="block-menu">
                <summary>⋮</summary>
                <div class="menu-content">
                    <select value={block.type} disabled={locked || block.type === "source" || block.type === "table" && !!blockText(block).trim()} onchange={event => changeType(event.currentTarget.value as ContentBlock["type"])}>
                        {#each kinds as [value, label] (value)}
                            <option {value} disabled={block.children.length > 0 && ["heading_1", "heading_2", "heading_3", "code", "table", "hr"].includes(value) || block.payload.inline.length > 0 && ["table", "hr"].includes(value)}>{label}</option>
                        {/each}
                        {#if block.type === "source"}
                            <option value="source">来源片段</option>
                        {/if}
                        {#if block.type === "blocked_reference"}
                            <option value="blocked_reference">引用</option>
                        {/if}
                    </select>
                    <button disabled={locked} onclick={() => append()}>在后面添加块</button>
                    <button disabled={locked || !canNest} onclick={addChild}>添加子块</button>
                    <button disabled={locked || index === 0} onclick={() => action("move-up")}>上移</button>
                    <button disabled={locked || index === ids.length - 1} onclick={() => action("move-down")}>下移</button>
                    <button disabled={locked || ["source", "table", "hr", "blocked_reference"].includes(block.type)} onclick={() => picker = "reference"}>添加行内引用</button>
                    <button disabled={locked} onclick={() => picker = "block-reference"}>在后面引用页面或块</button>
                    <button disabled={locked} onclick={() => picker = "sync"}>在后面放入同步块</button>
                    <button disabled={locked} onclick={() => action("clone")}>解除此位置的同步</button>
                    <button disabled={locked} onclick={() => action("duplicate")}>在后面创建当前块副本</button>
                    <button disabled={locked} onclick={() => action("remove")}>移除此位置</button>
                    <button disabled={locked} onclick={deleteBlock}>删除块的所有内容</button>
                </div>
            </details>
            {#if block.children.length}
                <button class="fold" disabled={locked} onclick={() => edit({ ...block!, payload: { ...block!.payload, collapsed: !block!.payload.collapsed } })}>{block.payload.collapsed ? "▸" : "▾"}</button>
            {/if}
            {#if block.type === "unordered_list" || block.type === "ordered_list"}
                <span class="list-marker">{block.type === "ordered_list" ? `${index + 1}.` : "•"}</span>
            {/if}
            <div class="body">
                {#if block.type === "hr"}
                    <hr />
                {:else if block.type === "blocked_reference" && block.payload.target}
                    <ReferenceView target={block.payload.target} />
                {:else if block.type === "blocked_reference"}
                    <span class="missing">{blockText(block) || "旧引用未记录目标"}</span>
                {:else if block.type === "source"}
                    <blockquote class="source">{block.payload.source?.quote}<small>原文摘录</small></blockquote>
                {:else if block.type === "table"}
                    <div class="table-wrap">
                        <table>
                            <tbody>
                                {#each block.payload.table?.content ?? [] as row, ri (ri)}
                                    <tr>
                                        {#each row.content ?? [] as cell, ci (ci)}
                                            <td>
                                                <InlineEditor inline={(cell.content?.[0]?.content ?? []) as InlineNode[]} readonly={locked} history={session.state.history} onchange={inline => tableCell(ri, ci, inline)} onhistory={direction => void session.undo(direction)} />
                                            </td>
                                        {/each}
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                    <div class="table-actions">
                        <button disabled={locked} onclick={() => resizeTable("row")}>添加行</button>
                        <button disabled={locked} onclick={() => resizeTable("column")}>添加列</button>
                    </div>
                {:else}
                    <InlineEditor inline={block.payload.inline} readonly={locked} codeBlock={block.type === "code"} history={session.state.history} onchange={inline => edit({ ...block!, payload: { ...block!.payload, inline } })} onsplit={split} onhistory={direction => void session.undo(direction)} oncomposition={session.composition} />
                {/if}
            </div>
        </div>
        {#if picker}
            <TargetPicker mode={picker === "sync" ? "sync" : "reference"} onselect={choose} onclose={() => picker = null} />
        {/if}
        {#if block.children.length && !block.payload.collapsed}
            <div class="children">
                {#each block.children as childId, childIndex (childIndex)}
                    <BlockRow {session} blockId={childId} containerId={block.id} index={childIndex} ancestors={[...ancestors, block.id]} {tabId} />
                {/each}
            </div>
        {/if}
    </div>
{:else}
    <p class="missing">此位置包含循环，无法继续展开。</p>
{/if}

<style>
    .block-row { color: var(--dc-c-fg-default); font-size: var(--dc-font-size, 15px); line-height: 1.8; margin: 5px 0; }
    .line { display: flex; align-items: flex-start; min-width: 0; gap: 7px; }
    .body { flex: 1; min-width: 0; }
    .heading { font-weight: 750; font-size: 23px; margin-top: 20px; }
    [data-block-type="heading_2"] { font-size: 20px; }
    [data-block-type="heading_3"] { font-size: 17px; }
    .quote { padding: 6px 12px; border-left: 3px solid var(--c-gold); background: var(--c-cream); }
    .code { padding: 10px; border-radius: 7px; background: var(--c-cream); }
    .children { margin-left: 28px; padding-left: 10px; border-left: 1px solid var(--c-line); font-weight: normal; }
    .block-menu { position: relative; flex: 0 0 18px; font-size: 14px; font-weight: normal; color: var(--c-muted); }
    summary { list-style: none; cursor: pointer; text-align: center; padding-top: 3px; }
    .menu-content { position: absolute; top: 28px; left: 0; z-index: 30; width: 225px; padding: 8px; border: 1px solid var(--c-line); border-radius: 8px; background: var(--c-paper); box-shadow: 2px 4px 12px #0002; }
    .menu-content button, select { display: block; width: 100%; padding: 6px 9px; text-align: left; font-size: 12px; background: var(--c-paper); color: var(--c-ink); }
    .menu-content button:hover { background: var(--c-sage); }
    .fold, .list-marker { padding-top: 3px; color: var(--c-muted); }
    .missing { margin: 8px 0; padding: 8px; border: 1px dashed var(--c-line); color: var(--c-muted); font-size: 12px; }
    .missing button { margin-left: 12px; text-decoration: underline; }
    .source { margin: 0; padding: 14px; border-left: 3px solid var(--c-gold); background: var(--c-cream); white-space: pre-wrap; user-select: text; }
    .source small { display: block; margin-top: 8px; color: var(--c-muted); }
    .table-wrap { overflow-x: auto; }
    table { border-collapse: collapse; min-width: 100%; font-size: 14px; }
    td { border: 1px solid var(--c-line); padding: 5px 10px; min-width: 120px; vertical-align: top; }
    .table-actions { display: flex; gap: 15px; color: var(--c-muted); font-size: 11px; }
</style>

<script lang="ts">
    import { blockText, payload } from "../../../shared/content/blocks";
    import { type ContentBlock, type InlineNode, type RichNode, type Target } from "../../../shared/types/content";
    import { type PageSession, mutate, perform } from "../Knowledge/state.svelte";
    import InlineEditor from "./InlineEditor.svelte";
    import BlockRow from "./BlockRow.svelte";
    import ReferenceView from "../Knowledge/ReferenceView.svelte";
    import TargetPicker from "../Knowledge/TargetPicker.svelte";

    let { session, blockId, containerId, index, tabId, ancestors = [] }: { session: PageSession; blockId: string; containerId: string; index: number; tabId: string; ancestors?: string[] } = $props();
    const page = $derived(session.state.page!);
    const block = $derived(page.blocks[blockId]);
    const ids = $derived(containerId === page.id ? page.children : page.blocks[containerId]?.children ?? []);
    const locked = $derived(session.state.loading || session.state.saving || !!page.attributes.deleted);
    const canNest = $derived(block && ["paragraph", "unordered_list", "ordered_list", "blockquote", "callout"].includes(block.type));
    let element = $state<HTMLDivElement>();
    let picker = $state<"reference" | "block-reference" | "sync" | null>(null);
    const kinds: [ContentBlock["type"], string][] = [["paragraph", "正文"], ["heading_1", "一级标题"], ["heading_2", "二级标题"], ["heading_3", "三级标题"], ["unordered_list", "无序列表"], ["ordered_list", "有序列表"], ["blockquote", "引用文字"], ["callout", "提示"], ["code", "代码"], ["table", "表格"], ["hr", "分隔线"]];
    const edit = (value: ContentBlock): void => session.block(value);
    const cell = (): RichNode => ({ type: "tableCell", content: [{ type: "paragraph", content: [] }] });
    function changeType(type: ContentBlock["type"]): void {
        if (!block) return;
        if (["table", "hr"].includes(type) && block.children.length) return;
        const body = { ...payload(type), inline: block.payload.inline, ...(type === "table" ? { table: { type: "table", content: [{ type: "tableRow", content: [cell(), cell()] }, { type: "tableRow", content: [cell(), cell()] }] } } : {}) };
        edit({ ...block, type, payload: body });
    }
    function append(inline: InlineNode[] = [], type: ContentBlock["type"] = "paragraph"): void {
        const id = crypto.randomUUID(), next = [...ids];
        next.splice(index + 1, 0, id);
        session.children(containerId, next, [{ id, type, payload: { ...payload(type), inline }, children: [] }]);
    }
    function split(before: InlineNode[], after: InlineNode[]): void {
        if (!block) return;
        edit({ ...block, payload: { ...block.payload, inline: before } });
        append(after, block.type.includes("list") ? block.type : "paragraph");
        requestAnimationFrame(() => {
            element?.nextElementSibling?.querySelector<HTMLElement>(".tiptap")?.focus();
        });
    }
    function addChild(): void {
        const id = crypto.randomUUID();
        session.children(block.id, [...block.children, id], [{ id, type: "paragraph", payload: payload("paragraph"), children: [] }]);
    }
    function action(action: "remove" | "clone" | "duplicate" | "move-up" | "move-down"): void {
        void perform(async () => {
            if (!await session.save()) return;
            const current = session.state.page!, children = containerId === current.id ? current.children : current.blocks[containerId].children;
            if (await mutate({ type: "place", action, tabId, position: { pageId: current.id, kind: containerId === current.id ? "page" : "block", containerId, index, children: [...children] } })) await session.refresh();
        });
    }
    function deleteBlock(): void {
        void perform(async () => {
            if (!await session.save()) return;
            if (await mutate({ type: "delete-block", tabId, pageId: page.id, blockId, version: session.state.page!.blockVersions[blockId] })) await session.refresh();
        });
    }
    function choose(target: Target, label: string): void {
        const mode = picker;
        picker = null;
        if (mode === "reference") edit({ ...block, payload: { ...block.payload, inline: [...block.payload.inline, { type: "inlineReference", attrs: { target, label } }] } });
        else if (mode === "block-reference") {
            const id = crypto.randomUUID(), next = [...ids];
            next.splice(index + 1, 0, id);
            session.children(containerId, next, [{ id, type: "blocked_reference", payload: { ...payload("blocked_reference"), target }, children: [] }]);
        }
        else void perform(async () => {
            if (!await session.save()) return;
            const current = session.state.page!, children = containerId === current.id ? current.children : current.blocks[containerId].children;
            if (await mutate({ type: "place", action: "insert", blockId: target.id, tabId, position: { pageId: page.id, kind: containerId === page.id ? "page" : "block", containerId, index: index + 1, children: [...children] } })) await session.refresh();
        });
    }
    function tableCell(row: number, col: number, inline: InlineNode[]): void {
        const table = JSON.parse(JSON.stringify(block.payload.table)) as RichNode;
        table.content![row].content![col].content![0].content = inline as RichNode[];
        edit({ ...block, payload: { ...block.payload, table } });
    }
    function resizeTable(direction: "row" | "column"): void {
        const table = JSON.parse(JSON.stringify(block.payload.table)) as RichNode;
        if (direction === "row") table.content!.push({ type: "tableRow", content: Array.from({ length: table.content![0].content!.length }, cell) });
        else table.content!.forEach(row => row.content!.push(cell()));
        edit({ ...block, payload: { ...block.payload, table } });
    }
</script>