<script lang="ts">
    import { Popover } from "bits-ui";
    import { type Snippet } from "svelte";
    import TopLayer from "./TopLayer.svelte";
    import "./controls.css";

    let { label, trigger, children, contentProps = {}, open = $bindable(false), align = "start", side = "bottom" }: {
        label: string;
        trigger?: NonNullable<Popover.TriggerProps["child"]>;
        children: Snippet;
        open?: boolean;
        contentProps?: Pick<Popover.ContentProps, "ref" | "class" | "style" | "customAnchor" | "sideOffset" | "onOpenAutoFocus" | "onCloseAutoFocus" | "trapFocus" | "collisionPadding" | "onInteractOutside">;
        align?: Popover.ContentProps["align"];
        side?: Popover.ContentProps["side"];
    } = $props();
</script>

<Popover.Root bind:open>
    {#if trigger}<Popover.Trigger child={trigger} />{/if}
    <Popover.Content {side} {align} strategy="fixed" sideOffset={4} collisionPadding={8} {...contentProps} class={["ui-popup ui-popover", contentProps.class]} aria-label={label}>
        {#snippet child({ props, wrapperProps })}
            <TopLayer props={wrapperProps}><div {...props}>{@render children()}</div></TopLayer>
        {/snippet}
    </Popover.Content>
</Popover.Root>