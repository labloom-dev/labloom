<script lang="ts">
    import { Tooltip } from "bits-ui";
    import "./controls.css";

    let { text, shortcut, delay = 450, open = $bindable(false), trigger }: {
        text: string;
        shortcut?: string;
        delay?: number;
        open?: boolean;
        trigger: NonNullable<Tooltip.TriggerProps["child"]>;
    } = $props();
</script>

<Tooltip.Provider delayDuration={delay}>
    <Tooltip.Root bind:open>
        <Tooltip.Trigger child={trigger} />
        <Tooltip.Portal>
            <Tooltip.Content class="ui-popup ui-tooltip" sideOffset={4} collisionPadding={8}>
                {text}{#if shortcut}<kbd class="ui-shortcut">{shortcut}</kbd>{/if}
            </Tooltip.Content>
        </Tooltip.Portal>
    </Tooltip.Root>
</Tooltip.Provider>