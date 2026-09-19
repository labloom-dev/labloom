{#if node.type === "group"}
    <section
        class="group"
        class:focused={tabState.focusedGroupId === node.groupId}
        onpointerdown={() => node.type === "group" && focusGroup(node.groupId)}
        onfocusin={() => node.type === "group" && focusGroup(node.groupId)}
    >
        <div class="group-header">
            <List groupId={node.groupId} />
            <button title="新增测试 Tab" onclick={() => {
                if (node.type !== "group") return;
                addTab(node.groupId, { id: getTabID(), title: "新 Tab", type: "overview" });
            }}>+</button>
            <button onclick={() => node.type === "group" && splitGroup(node.groupId, "horizontal")}>◧</button>
            <button onclick={() => node.type === "group" && splitGroup(node.groupId, "vertical")}>⬒</button>
            <button disabled={tabState.groups.length === 1} onclick={() => node.type === "group" && closeGroup(node.groupId)}>×</button>
        </div>
        <div class="group-content"><Content groupId={node.groupId} /></div>
    </section>
{:else}
    <div class="split" class:vertical={node.direction === "vertical"}>
        <div class="pane" style:flex={`${node.ratio} 1 0`}>
            <Layout node={node.children[0]} path={[...path, 0]} />
        </div>
        <button
            class="divider"
            class:vertical={node.direction === "vertical"}
            onpointerdown={startResize}
            onpointermove={dragResize}
            onpointerup={stopResize}
            onpointercancel={stopResize}
            onkeydown={resizeWithKeyboard}
        ></button>
        <div class="pane" style:flex={`${1 - node.ratio} 1 0`}>
            <Layout node={node.children[1]} path={[...path, 1]} />
        </div>
    </div>
{/if}


<style>
    .group, .split, .pane { display: flex; flex: 1; min-width: 0; min-height: 0; }
    .group { flex-direction: column; overflow: hidden; }
    .group-header { display: flex; flex-shrink: 0; background: #eee; border-bottom: 1px solid #ccc; }
    .focused > .group-header { border-bottom-color: #557cdb; }
    .group-content { flex: 1; min-height: 0; overflow: auto; }
    .split.vertical { flex-direction: column; }
    .divider { flex: 0 0 5px; padding: 0; border: 0; border-radius: 0; background: #ddd; cursor: col-resize; touch-action: none; }
    .divider.vertical { cursor: row-resize; }
    .divider:hover, .divider:focus-visible { background: #557cdb; }
</style>


<script lang="ts">
    import Layout from "./Layout.svelte";
    import List from "./List.svelte";
    import Content from "./Content.svelte";
    import type { LayoutNode } from "./defs";
    import { addTab, getTabID, closeGroup, focusGroup, resizeSplit, splitGroup } from "./api";
    import { tabState } from "./state.svelte";

    let { node, path = [] }: { node: LayoutNode; path?: number[] } = $props();

    function startResize(event: PointerEvent): void {
        if (event.button !== 0) return;
        event.preventDefault();
        (event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
    }

    function dragResize(event: PointerEvent): void {
        const divider = event.currentTarget as HTMLButtonElement;
        if (!divider.hasPointerCapture(event.pointerId) || node.type !== "split") return;
        const rect = divider.parentElement!.getBoundingClientRect();
        const horizontal = node.direction === "horizontal";
        const length = (horizontal ? rect.width : rect.height) - 5;
        if (length <= 0) return;
        const position = horizontal ? event.clientX - rect.left : event.clientY - rect.top;
        resizeSplit(path, Math.max(0.1, Math.min(0.9, (position - 2.5) / length)));
    }

    function stopResize(event: PointerEvent): void {
        const divider = event.currentTarget as HTMLButtonElement;
        if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
    }

    function resizeWithKeyboard(event: KeyboardEvent): void {
        if (node.type !== "split") return;
        const decrease = node.direction === "horizontal" ? "ArrowLeft" : "ArrowUp";
        const increase = node.direction === "horizontal" ? "ArrowRight" : "ArrowDown";
        if (event.key !== decrease && event.key !== increase) return;
        event.preventDefault();
        resizeSplit(path, Math.max(0.1, Math.min(0.9, node.ratio + (event.key === increase ? 0.05 : -0.05))));
    }
</script>