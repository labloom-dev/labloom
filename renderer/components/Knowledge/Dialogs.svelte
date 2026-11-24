<script lang="ts">
    import { answer, confirmation } from "./confirmation.svelte";
    import { knowledgeState, notify } from "./feedback.svelte";
    import { message, t } from "../../i18n.svelte";
    import ConfirmDialog from "../base/ConfirmDialog.svelte";
    import IconButton from "../base/IconButton.svelte";
    import TopLayer from "../base/TopLayer.svelte";
    import VirtualRows from "../base/VirtualRows.svelte";

    const request = $derived(confirmation.current);
    const names = $derived(request?.names ?? []);
    const clearError = (): void => {
        knowledgeState.error = "";
    };
    const clearNotice = (): void => notify("");
</script>

{#if knowledgeState.error || knowledgeState.notice}
    {@const error = knowledgeState.error}
    {@const close = error ? clearError : clearNotice}
    <TopLayer onEscape={close}>
        <div class="toast" class:error role={error ? "alert" : "status"}>
            <div>
                {error ? message(error) : knowledgeState.notice}
                {#if error && error.diagnostic}
                    <details>
                        <summary>{t("dialog.details")}</summary>
                        <div class="diagnostic">{error.diagnostic}</div>
                    </details>
                {/if}
            </div>
            <IconButton icon="close" label={t("dialog.close")} onclick={close} />
        </div>
    </TopLayer>
{/if}

{#if request}
    {#key request}
        <ConfirmDialog open={true} title={request.heading()} body={request.text()} danger={request.danger}
            preventScroll={false} dismissOutside={false}
            cancelLabel={t("dialog.cancel")} confirmLabel={t("dialog.confirm")} onconfirm={() => answer(true)} oncancel={() => answer(false)}>
            {#if names.length}
                <div class="names">
                    <VirtualRows items={names} role="list" aria-label={t("dialog.affectedPages")} tabindex={0}>
                        {#snippet row(name, index)}
                            <div class="page-name" role="listitem" aria-posinset={index + 1} aria-setsize={names.length}>
                                {name || t("dialog.untitled")}
                            </div>
                        {/snippet}
                    </VirtualRows>
                </div>
            {/if}
        </ConfirmDialog>
    {/key}
{/if}

<style>
    .toast {
        position: fixed;
        inset: auto var(--ui-space-5) var(--ui-space-5) auto;
        display: flex;
        align-items: flex-start;
        gap: var(--ui-space-4);
        max-width: min(var(--ui-search-width), calc(100vw - 2 * var(--ui-space-5)));
        padding: var(--ui-space-3) var(--ui-space-4);
        border: var(--ui-stroke) solid var(--ui-border);
        border-radius: var(--ui-radius-panel);
        background: var(--ui-surface-popup);
        color: var(--ui-text);
        box-shadow: var(--ui-shadow-popup);
        font-size: var(--ui-font-body);
        overflow-wrap: anywhere;
    }
    .toast > div { min-width: 0; align-self: center; }
    .toast.error { border-color: var(--ui-danger); color: var(--ui-text-danger); }
    .toast :global(.ui-icon-button) { flex: none; }
    summary { cursor: pointer; margin-top: var(--ui-space-2); }
    .diagnostic { margin-top: var(--ui-space-2); max-height: 40vh; overflow: auto; white-space: pre-wrap; user-select: text; }
    .names { margin-bottom: var(--ui-space-5); }
    .names :global(.virtual-rows) { max-height: calc(10 * var(--ui-row-height)); }
    .page-name { display: flex; align-items: center; width: max-content; min-width: 100%; height: var(--ui-row-height); white-space: nowrap; }
</style>