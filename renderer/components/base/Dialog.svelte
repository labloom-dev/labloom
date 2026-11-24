<script lang="ts">
    import { Dialog } from "bits-ui";
    import { tick, type Snippet } from "svelte";
    import TopLayer from "./TopLayer.svelte";
    import "./controls.css";

    let { title, open = $bindable(false), locked = false, trigger, children, restoreFocus }: {
        title: string; open?: boolean; locked?: boolean;
        trigger?: NonNullable<Dialog.TriggerProps["child"]>; children: Snippet;
        restoreFocus?: () => HTMLElement | null | undefined;
    } = $props();

    let content: HTMLElement | null = $state(null);

    function setOpen(next: boolean): void {
        if (next || !locked) open = next;
    }
    function focusInput(event: Event): void {
        event.preventDefault();
        requestAnimationFrame(() => {
            if (!open || !content?.isConnected) return;
            const first = content.querySelector<HTMLElement>("input:not([disabled]), textarea:not([disabled])")
                ?? content.querySelector<HTMLElement>("button:not([disabled]), [tabindex='0']");
            (first ?? content).focus({ preventScroll: true });
        });
    }
    function restore(event: Event): void {
        if (!restoreFocus) return;
        event.preventDefault();
        void tick().then(() => restoreFocus?.()?.focus({ preventScroll: true }));
    }
</script>

<Dialog.Root bind:open={() => open, setOpen}>
    {#if trigger}<Dialog.Trigger child={trigger} />{/if}
    {#if open}
        <TopLayer>
            <Dialog.Overlay class="ui-scrim" />
            <Dialog.Content class="ui-popup ui-dialog" bind:ref={content} aria-describedby={undefined} onOpenAutoFocus={focusInput} onCloseAutoFocus={restore}
                escapeKeydownBehavior={locked ? "ignore" : "close"} interactOutsideBehavior={locked ? "ignore" : "close"}>
                <Dialog.Title class="ui-dialog-title">{title}</Dialog.Title>
                {@render children()}
            </Dialog.Content>
        </TopLayer>
    {/if}
</Dialog.Root>