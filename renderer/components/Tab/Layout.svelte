{#if node.type === "group"}
    <Group groupId={node.groupId} />
{:else}
    <div
        class="split"
        class:vertical={node.direction === "vertical"}
        bind:clientWidth={width}
        bind:clientHeight={height}
    >
        <div class="pane" style:flex={`${node.ratio} 1 0`}>
            <Layout node={node.children[0]} path={[...path, 0]} />
        </div>
        <div class="divider">
            <Resizer
                direction={node.direction === "horizontal" ? "vertical" : "horizontal"}
                origin={availableSize * node.ratio}
                min={availableSize * 0.1}
                max={availableSize * 0.9}
                changeCB={resize}
                overflowMargin={32}
                onMinExceeded={() => closeSplitSide(path, 0)}
                onMaxExceeded={() => closeSplitSide(path, 1)}
            />
        </div>
        <div class="pane" style:flex={`${1 - node.ratio} 1 0`}>
            <Layout node={node.children[1]} path={[...path, 1]} />
        </div>
    </div>
{/if}


<style>
    .split, .pane {
        display: flex;
        flex: 1;
        min-width: 0;
        min-height: 0;
    }
    .split.vertical {
        flex-direction: column;
    }
    .divider {
        flex: 0 0 5px;
        touch-action: none;
    }
</style>


<script lang="ts">
    import Layout from "./Layout.svelte";
    import Group from "./Group.svelte";
    import Resizer from "../utils/Resizer.svelte";
    import type { LayoutNode } from "./defs";
    import { closeSplitSide, resizeSplit } from "./api";

    let { node, path = [] }: { node: LayoutNode; path?: number[] } = $props();
    let width = $state(0);
    let height = $state(0);
    const availableSize = $derived(node.type === "split" ? Math.max(0, (node.direction === "horizontal" ? width : height) - 5) : 0);

    function resize(value: number): void {
        if (availableSize > 0) resizeSplit(path, Math.max(0.1, Math.min(0.9, value / availableSize)));
    }
</script>