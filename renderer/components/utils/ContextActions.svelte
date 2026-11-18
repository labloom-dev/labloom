<ContextMenu.Root>
    <ContextMenu.Trigger class={className}>{@render children()}</ContextMenu.Trigger>
    <ContextMenu.Portal>
        <ContextMenu.Content class="compact-menu" collisionPadding={4}>
            {#each items as item (item.label)}
                <ContextMenu.Item class="compact-item" disabled={item.disabled} onSelect={item.run}>{item.label}<kbd>{item.shortcut ?? ""}</kbd></ContextMenu.Item>
            {/each}
        </ContextMenu.Content>
    </ContextMenu.Portal>
</ContextMenu.Root>
<script lang="ts">
    import { ContextMenu } from "bits-ui";
    import type { Snippet } from "svelte";
    let { items, children, className = "" }: { items: { label: string; shortcut?: string; disabled?: boolean; run: () => void }[]; children: Snippet; className?: string } = $props();
</script>