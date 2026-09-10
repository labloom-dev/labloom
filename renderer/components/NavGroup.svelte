<div style:color>
    {#if panelOpened}
        <button>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html panelClose}
        </button>
    {:else}
        <button>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html panelOpen}
        </button>
    {/if}
    <button disabled={!canBack}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html arrowLeft}
    </button>
    <button disabled={!canForward}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html arrowRight}
    </button>
</div>


<style>
    button {
        color: inherit;
    }
    button:disabled {
        opacity: 0.4;
    }
</style>


<script lang="ts">
    import panelOpen from "../assets/carbon--side-panel-open.svg?raw";
    import panelClose from "../assets/carbon--side-panel-close.svg?raw";
    import arrowLeft from "../assets/carbon--arrow-left.svg?raw";
    import arrowRight from "../assets/carbon--arrow-right.svg?raw";

    type Props = {
        color?: string;
        panelOpened: boolean;
        canBack: boolean;
        canForward: boolean;
    };

    let { color = "inherit", panelOpened, canBack, canForward }: Props = $props();
</script>