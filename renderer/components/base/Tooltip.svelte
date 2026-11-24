<script lang="ts">
    import { Tooltip } from "bits-ui";
    import TopLayer from "./TopLayer.svelte";
    import "./controls.css";

    let { text, shortcut, delay = 450, anchor, open = $bindable(false), trigger, canOpen }: {
        text: string;
        shortcut?: string;
        delay?: number;
        open?: boolean;
        anchor?: HTMLElement;
        trigger?: NonNullable<Tooltip.TriggerProps["child"]>;
        canOpen?: (element: HTMLElement) => boolean;
    } = $props();

    let triggerElement = $state<HTMLElement | null>(null);

    function setOpen(value: boolean): void {
        open = value && (!canOpen || !!triggerElement && canOpen(triggerElement));
    }
</script>

<Tooltip.Provider delayDuration={delay}>
    <Tooltip.Root bind:open={() => open, setOpen}>
        {#if trigger}<Tooltip.Trigger bind:ref={triggerElement} child={trigger} />{/if}
        <Tooltip.Content class="ui-popup ui-tooltip" customAnchor={anchor} strategy="fixed" sideOffset={4} collisionPadding={8}>
            {#snippet child({ props, wrapperProps })}
                <TopLayer props={wrapperProps}><div {...props}>{text}{#if shortcut}<kbd class="ui-shortcut">{shortcut}</kbd>{/if}</div></TopLayer>
            {/snippet}
        </Tooltip.Content>
    </Tooltip.Root>
</Tooltip.Provider>