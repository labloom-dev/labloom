<ContextMenu.Root>
    <ContextMenu.Trigger class={className}>{@render children()}</ContextMenu.Trigger>
    <ContextMenu.Content class="compact-menu" strategy="fixed" collisionPadding={4}>
        {#snippet child({ props, wrapperProps })}
            <TopLayer props={wrapperProps}>
                <div {...props}>
                    {#each items as item (item.label)}
                        <ContextMenu.Item class="compact-item" disabled={item.disabled} onSelect={item.run}>{item.label}<kbd>{item.shortcut ?? ""}</kbd></ContextMenu.Item>
                    {/each}
                </div>
            </TopLayer>
        {/snippet}
    </ContextMenu.Content>
</ContextMenu.Root>
<script lang="ts">
    import { ContextMenu } from "bits-ui";
    import { type Snippet } from "svelte";
    import TopLayer from "../base/TopLayer.svelte";
    let { items, children, className = "" }: { items: { label: string; shortcut?: string; disabled?: boolean; run: () => void }[]; children: Snippet; className?: string } = $props();
</script>