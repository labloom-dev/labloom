{#if knowledgeState.error}
    <div class="notice error toast" popover="manual" {@attach element => showLayer(element, clearError)}><div>{message(knowledgeState.error)}{#if knowledgeState.error.diagnostic}<details><summary>{t("dialog.details")}</summary><div data-paragraph>{knowledgeState.error.diagnostic}</div></details>{/if}</div><button onclick={clearError}>{t("dialog.close")}</button></div>
{:else if knowledgeState.notice}
    <div class="notice toast" role="status" popover="manual" {@attach element => showLayer(element, clearNotice)}>{knowledgeState.notice}<button onclick={clearNotice}>{t("dialog.close")}</button></div>
{/if}
{#if confirmation.resolve}
    <div class="shade" popover="manual" {@attach element => showLayer(element, () => answer(false))} role="dialog" aria-modal="true" aria-label={confirmation.heading()}>
        <section class="paper-card confirmation">
            <h2>{confirmation.heading()}</h2>
            <div data-paragraph>{confirmation.text()}</div>
            {#if confirmation.names.length}
                <ul>
                    {#each confirmation.names as name, index (index)}
                        <li>{name || t("dialog.untitled")}</li>
                    {/each}
                </ul>
            {/if}
            <footer>
                <button class="button" onclick={() => answer(false)}>{t("dialog.cancel")}</button>
                <button class="button primary" onclick={() => answer(true)}>{t("dialog.confirm")}</button>
            </footer>
        </section>
    </div>
{/if}
<style>
    .shade { position: fixed; inset: var(--ui-titlebar-height) 0 0; width: auto; height: auto; margin: 0; border: 0; color: var(--ui-text); display: grid; place-items: center; padding: 24px; background: var(--ui-surface-scrim); }
    .confirmation { width: min(520px, 100%); max-height: 80vh; padding: 24px; overflow: auto; }
    h2 { margin: 0 0 16px; font-size: 19px; }
    :where([data-paragraph]), li { font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
    :where([data-paragraph]) { white-space: pre-line; }
    ul { max-height: 240px; overflow: auto; }
    footer { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
    .toast { position: fixed; inset: auto var(--ui-space-5) var(--ui-space-5) auto; margin: 0; color: var(--ui-text); max-width: min(600px, calc(100vw - 2 * var(--ui-space-5))); display: flex; gap: var(--ui-space-5); box-shadow: var(--ui-shadow-popup); }
</style>
<script lang="ts">
    import { answer, confirmation } from "./confirmation.svelte";
    import { knowledgeState, notify } from "./feedback.svelte";
    import { message, t } from "../../i18n.svelte";
    import { showLayer } from "../base/top-layer";

    const clearError = (): void => {
        knowledgeState.error = "";
    };
    const clearNotice = (): void => notify("");
</script>