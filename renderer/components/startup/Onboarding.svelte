<script lang="ts">
    import type { StartupState, WorkspaceAction } from "../../../shared/types/startup";
    import { message, t } from "../../i18n.svelte";
    import Button from "../base/Button.svelte";
    import TextButton from "../base/TextButton.svelte";
    import TitleBar from "../layout/TitleBar.svelte";
    import icon from "../../assets/icon.png";

    let { state: startup, pending, onchoose, onretry }: {
        state: StartupState | null;
        pending: boolean;
        onchoose: (action: WorkspaceAction) => void;
        onretry: () => void;
    } = $props();

    const detailsId = $props.id();
    let details = $state(false);

    function choose(action: WorkspaceAction): void {
        details = false;
        onchoose(action);
    }
    function retry(): void {
        details = false;
        onretry();
    }
</script>

<TitleBar class="startup-titlebar">
    <img src={icon} alt="" draggable="false" />
    <span>{t("app.name")}</span>
</TitleBar>

<main class="onboarding">
    <div class="content">
        {#if startup?.status === "needs-workspace"}
            <div class="name">{t("app.name")}</div>
            <section>
                <h2>{t("startup.start")}</h2>
                <div class="actions" aria-busy={pending}>
                    <TextButton class="workspace-link" icon="add" text={t("startup.newWorkspace")}
                        disabled={pending || !startup.canChoose} onclick={() => choose("create")} />
                    <TextButton class="workspace-link" icon="folder-opened" text={t("startup.openWorkspace")}
                        disabled={pending || !startup.canChoose} onclick={() => choose("open")} />
                </div>
            </section>
            {#if startup.notice}
                <div class="message" role="status">{t("startup.configBackup")}&nbsp;<span class="path">{startup.notice.path}</span></div>
            {/if}
            {#if startup.error}
                {@const path = startup.attemptedPath ?? startup.lastWorkspace?.path}
                <div class="message" role="alert">
                    <div class="error-heading">{t("startup.failed")}</div>
                    <div>{message(startup.error)}</div>
                    {#if path}<div class="path">{path}</div>{/if}
                    {#if startup.error.diagnostic}
                        <TextButton text={t("dialog.details")} icon={details ? "chevron-down" : "chevron-right"}
                            aria-expanded={details} aria-controls={detailsId} onclick={() => details = !details} />
                        <div class="diagnostic" id={detailsId} hidden={!details}>{startup.error.diagnostic}</div>
                    {/if}
                    <div><Button disabled={pending} onclick={retry}>{t("dialog.retry")}</Button></div>
                </div>
            {/if}
        {:else}
            <div role="status">{t("startup.opening")}</div>
        {/if}
    </div>
</main>

<style>
    :global(.startup-titlebar) { display: flex; gap: var(--ui-space-3); padding-inline-end: var(--system-controls); font-size: var(--ui-font-small); }
    img { width: var(--ui-icon-normal); height: var(--ui-icon-normal); }
    .onboarding { flex: 1; min-height: 0; overflow: auto; background: var(--ui-surface-window); color: var(--ui-text); font-size: var(--ui-font-body); }
    .content { max-width: var(--ui-editor-content-width); padding: clamp(var(--ui-space-6), 12vh, calc(4 * var(--ui-space-6))) clamp(var(--ui-space-6), 7vw, calc(4 * var(--ui-space-6))); }
    .name { margin-bottom: var(--ui-space-6); font-size: var(--ui-font-title); font-weight: 600; }
    h2 { margin: 0 0 var(--ui-space-2); font-size: var(--ui-font-body); font-weight: 600; }
    .actions { display: grid; justify-items: start; gap: var(--ui-space-1); }
    .actions :global(.workspace-link:enabled) { color: var(--ui-text-match); }
    .actions :global(.workspace-link) { padding-inline: 0 var(--ui-space-3); }
    .message { margin-top: var(--ui-space-5); }
    .message > div + div, .message > div + :global(.ui-control) { margin-top: var(--ui-space-2); }
    .error-heading { color: var(--ui-text-danger); font-weight: 600; }
    .path, .diagnostic { user-select: text; overflow-wrap: anywhere; }
    .path { color: var(--ui-text-secondary); }
    .diagnostic { white-space: pre-wrap; font-family: var(--ui-font-mono); }
</style>