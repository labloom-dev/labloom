<script lang="ts">
    import { Popover } from "bits-ui";
    import type { Snippet } from "svelte";
    import "./controls.css";

    let { label, trigger, children, open = $bindable(false), align = "start", side = "bottom" }: {
        label: string;
        trigger: NonNullable<Popover.TriggerProps["child"]>;
        children: Snippet;
        open?: boolean;
        align?: Popover.ContentProps["align"];
        side?: Popover.ContentProps["side"];
    } = $props();
</script>

<Popover.Root bind:open>
    <Popover.Trigger child={trigger} />
    <Popover.Portal>
        <Popover.Content class="ui-popup ui-popover" aria-label={label} {side} {align} sideOffset={4} collisionPadding={8}>
            {@render children()}
        </Popover.Content>
    </Popover.Portal>
</Popover.Root>