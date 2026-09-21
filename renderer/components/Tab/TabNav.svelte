<div style:color={color}>
    <button disabled={!canBack} title="Back">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html arrowLeft}
    </button>
    <button disabled={!canForward} title="Forward">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html arrowRight}
    </button>
</div>


<style>
    button {
        height: var(--icon-size-medium);
        width: var(--icon-size-medium);
        padding: 4px;
    }
    div {
        display: flex;
        flex-flow: row nowrap;
        align-items: center;
        gap: 8px;
        height: 100%;
    }
    button:disabled {
        opacity: 0.4;
    }
</style>


<script lang="ts">
    import arrowLeft from "../../assets/carbon--arrow-left.svg?raw";
    import arrowRight from "../../assets/carbon--arrow-right.svg?raw";

    type Props = {
        color?: string;
        panelOpened: boolean;
        canBack: boolean;
        canForward: boolean;
    };

    let { color = "inherit", canBack, canForward }: Props = $props();
</script>