<script lang="ts">
    import { AlertDialog } from "bits-ui";
    import type { Snippet } from "svelte";
    import { isComposingKey } from "../../../shared/content/commands";
    import Button from "./Button.svelte";
    import TopLayer from "./TopLayer.svelte";

    let { title, body, confirmLabel, cancelLabel, danger = false, open = $bindable(false), trigger, children, preventScroll = true, dismissOutside = true, onconfirm, oncancel }: {
        title: string;
        body: string;
        confirmLabel: string;
        cancelLabel: string;
        danger?: boolean;
        open?: boolean;
        trigger?: NonNullable<AlertDialog.TriggerProps["child"]>;
        children?: Snippet;
        preventScroll?: boolean;
        dismissOutside?: boolean;
        onconfirm: () => void;
        oncancel?: () => void;
    } = $props();
    let content = $state<HTMLElement | null>(null);
    function focusContent(event: Event): void {
        if (trigger) return;
        event.preventDefault();
        const dialog = content;
        requestAnimationFrame(() => {
            if (dialog?.isConnected) dialog.focus({ preventScroll: true });
        });
    }
    function changeOpen(next: boolean): void {
        if (open && !next) oncancel?.();
        open = next;
    }
    function confirm(): void {
        if (!open) return;
        open = false;
        onconfirm();
    }
    function defaultAction(event: KeyboardEvent): void {
        if (event.key !== "Enter" || isComposingKey(event) || event.repeat || event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        confirm();
    }
</script>

<AlertDialog.Root bind:open={() => open, changeOpen}>
    {#if trigger}<AlertDialog.Trigger child={trigger} />{/if}
    {#if open}<TopLayer>
        <AlertDialog.Overlay class="ui-scrim" />
        <AlertDialog.Content class="ui-popup ui-dialog" bind:ref={content} onOpenAutoFocus={focusContent}
            {preventScroll} onkeydown={defaultAction} interactOutsideBehavior={dismissOutside ? "close" : "ignore"}>
            <AlertDialog.Title class="ui-dialog-title">{title}</AlertDialog.Title>
            <AlertDialog.Description>
                {#snippet child({ props })}<div {...props} class="ui-dialog-body">{body}</div>{/snippet}
            </AlertDialog.Description>
            {@render children?.()}
            <div class="ui-dialog-actions">
                <AlertDialog.Cancel>
                    {#snippet child({ props })}<Button {...props}>{cancelLabel}</Button>{/snippet}
                </AlertDialog.Cancel>
                <AlertDialog.Action onclick={confirm}>
                    {#snippet child({ props })}<Button {...props} variant={danger ? "danger" : "primary"}>{confirmLabel}</Button>{/snippet}
                </AlertDialog.Action>
            </div>
        </AlertDialog.Content>
    </TopLayer>{/if}
</AlertDialog.Root>

<style>
    .ui-dialog-body { white-space: pre-line; overflow-wrap: anywhere; }
</style>