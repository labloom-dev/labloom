<header class="titlebar">
    <img src={icon} alt="" />
    <span>{t("startup.brand")}</span>
</header>

<main class="onboarding">
    <div class="welcome">

        <div class="welcome-art"><Bloom /></div>
        <h1>{t(state ? "startup.welcome" : "startup.opening")}</h1>
        <p class="intro">{t("startup.intro")}</p>

        {#if state?.status === "needs-workspace"}
            {#if state.notice}
                <p class="message notice" role="status">{t("startup.configBackup", { path: state.notice.path })}</p>
            {/if}
            {#if state.error}
                <div class="message error" role="alert">
                    <strong>{t("startup.failed")}</strong>
                    <p>{message(state.error)}</p>
                    {#if state.error.diagnostic}<details><summary>{t("dialog.details")}</summary><p>{state.error.diagnostic}</p></details>{/if}
                    {#if state.attemptedPath || state.lastWorkspace}
                        <p class="path">{state.attemptedPath ?? state.lastWorkspace?.path}</p>
                    {/if}
                    <button class="retry" disabled={pending} onclick={onretry}>{t("startup.retry")}</button>
                </div>
            {/if}
            <div class="actions">
                <button class="choice primary" disabled={pending || !state.canChoose} onclick={() => onchoose("create")}>
                    <span class="symbol">＋</span>
                    <strong>{t("startup.create")}</strong>
                    <span>{t("startup.createHint")}</span>
                </button>
                <button class="choice" disabled={pending || !state.canChoose} onclick={() => onchoose("open")}>
                    <svg class="folder" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" />
                        <path d="M3 9h18" />
                    </svg>
                    <strong>{t("startup.open")}</strong>
                    <span>{t("startup.openHint")}</span>
                </button>
            </div>
        {/if}

        <p class="status" role="status">{t(pending ? "startup.pending" : "startup.localHint")}</p>
    </div>
</main>


<style>
    .titlebar {
        -webkit-app-region: drag;
        display: flex;
        align-items: center;
        gap: 8px;
        height: max(37px, calc(env(titlebar-area-height, 36px) + 1px));
        flex-shrink: 0;
        padding-left: calc(env(titlebar-area-x, 0px) + 12px);
        padding-right: 150px;
        color: var(--c-search-trigger-text);
        background: var(--c-navbar-background);
        font-size: 12px;
    }
    .titlebar img {
        width: 20px;
        height: 20px;
        -webkit-user-drag: none;
    }
    .onboarding {
        flex: 1;
        min-height: 0;
        overflow: auto;
        display: flex;
        padding: 32px 28px;
        background-color: var(--c-cream);
        background-image: radial-gradient(var(--c-dots, #d9cfb9) .85px, transparent .85px);
        background-size: 18px 18px;
        color: var(--c-popover-text);
    }
    .welcome {
        width: min(100%, 730px);
        margin: auto;
        text-align: center;
    }
    .welcome-art {
        width: 190px;
        margin: 8px auto 0;
        transform: rotate(-4deg);
    }
    h1 {
        margin: 16px 0 12px;
        font-size: 32px;
        font-weight: 900;
    }
    p {
        line-height: 1.6;
    }
    .intro {
        margin: 0 0 28px;
        color: var(--c-search-trigger-text);
        font-size: 14px;
    }
    .actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
    }
    .choice {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
        padding: 24px;
        border: 1.5px solid var(--c-ink);
        border-radius: 15px;
        background: var(--c-paper);
        box-shadow: var(--c-shadow);
        transition: transform .15s;
        text-align: left;
        color: inherit;
        font-family: inherit;
    }
    .choice.primary {
        background: var(--c-surface-focus);
        border-color: var(--c-ink);
    }
    .choice:hover:not(:disabled) {
        transform: translateY(-3px);
        border-color: var(--c-accent);
        background: var(--c-surface-hover);
    }
    button:focus-visible {
        outline: 2px solid var(--c-accent);
        outline-offset: 3px;
    }
    button:disabled {
        opacity: .55;
        cursor: wait;
    }
    .choice strong {
        font-size: 16px;
        font-weight: 600;
    }
    .choice > span:last-child {
        color: var(--c-search-secondary-text);
        font-size: 13px;
        line-height: 1.5;
    }
    .symbol, .folder {
        color: var(--c-accent);
        height: 28px;
    }
    .symbol {
        font-size: 28px;
        line-height: 28px;
    }
    .status {
        margin: 24px 0 0;
        color: var(--c-search-secondary-text);
        font-size: 12px;
    }
    .message {
        margin: 0 0 20px;
        padding: 16px;
        border: 1px solid var(--c-popover-border);
        border-radius: 8px;
        text-align: left;
        font-size: 13px;
        overflow-wrap: anywhere;
        white-space: pre-wrap;
        user-select: text;
    }
    .message p {
        margin: 8px 0;
    }
    .notice {
        background: var(--c-surface-focus);
    }
    .error {
        background: var(--c-surface-hover);
    }
    .path {
        color: var(--c-search-secondary-text);
    }
    .retry {
        padding: 5px 12px;
        margin-top: 4px;
        border: 1px solid var(--c-popover-border);
        border-radius: 5px;
        color: var(--c-accent);
        font-family: inherit;
    }
    @media (max-width: 560px) {
        .actions {
            grid-template-columns: 1fr;
        }
        .choice {
            padding: 18px;
        }
    }
</style>


<script lang="ts">
    import Bloom from "../utils/Bloom.svelte";
    import icon from "../../assets/icon.png";
    import type { StartupState, WorkspaceAction } from "../../../shared/types/startup";
    import { message, t } from "../../i18n.svelte";
    type Props = {
        state: StartupState | null;
        pending: boolean;
        onchoose: (action: WorkspaceAction) => void;
        onretry: () => void;
    };

    let { state, pending, onchoose, onretry }: Props = $props();
</script>