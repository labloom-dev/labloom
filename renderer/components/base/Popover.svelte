<script lang="ts">
    import { Popover } from "bits-ui";
    import type { Snippet } from "svelte";
    import "./controls.css";

    let { label, trigger, children, contentProps = {}, portal, open = $bindable(false), align = "start", side = "bottom" }: {
        label: string;
        trigger?: NonNullable<Popover.TriggerProps["child"]>;
        children: Snippet;
        open?: boolean;
        portal?: HTMLElement;
        contentProps?: Pick<Popover.ContentProps, "ref" | "class" | "style" | "customAnchor" | "sideOffset" | "onOpenAutoFocus" | "onCloseAutoFocus" | "trapFocus" | "collisionPadding" | "onInteractOutside">;
        align?: Popover.ContentProps["align"];
        side?: Popover.ContentProps["side"];
    } = $props();
</script>

<Popover.Root bind:open>
    {#if trigger}<Popover.Trigger child={trigger} />{/if}
    <Popover.Portal to={portal}>
        <Popover.Content {side} {align} sideOffset={4} collisionPadding={8} {...contentProps} class={["ui-popup ui-popover", contentProps.class]}
            aria-label={label}>
            {@render children()}
        </Popover.Content>
    </Popover.Portal>
</Popover.Root>