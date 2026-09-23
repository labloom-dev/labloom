<header class="titlebar">
    <img src={icon} alt="" />
    <span>知织 · Labloom</span>
</header>

<main class="onboarding">
    <div class="welcome">
        <img class="logo" src={icon} alt="知织" />
        <h1>{state ? "欢迎使用知织" : "正在打开工作区"}</h1>
        <p class="intro">选择一个工作文件夹，开始整理你的文献、笔记与研究。</p>

        {#if state?.status === "needs-workspace"}
            {#if state.notice}
                <p class="message notice" role="status">{state.notice}</p>
            {/if}
            {#if state.error}
                <div class="message error" role="alert">
                    <strong>暂时无法进入工作区</strong>
                    <p>{state.error}</p>
                    {#if state.lastWorkspace}
                        <p class="path">{state.lastWorkspace.path}</p>
                    {/if}
                    <button class="retry" disabled={pending} onclick={onretry}>重试</button>
                </div>
            {/if}
            <div class="actions">
                <button class="choice primary" disabled={pending || !state.canChoose} onclick={() => onchoose("create")}>
                    <span class="symbol">＋</span>
                    <strong>创建工作区</strong>
                    <span>选择一个空文件夹，开始新的研究。</span>
                </button>
                <button class="choice" disabled={pending || !state.canChoose} onclick={() => onchoose("open")}>
                    <svg class="folder" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" />
                        <path d="M3 9h18" />
                    </svg>
                    <strong>打开已有工作区</strong>
                    <span>选择之前使用的工作文件夹。</span>
                </button>
            </div>
        {/if}

        <p class="status" role="status">{pending ? "正在处理，请稍候…" : "工作区保存在本机，请选择一个便于长期保存的位置。"}</p>
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
        background: var(--c-surface);
        color: var(--c-popover-text);
    }
    .welcome {
        width: min(100%, 660px);
        margin: auto;
        text-align: center;
    }
    .logo {
        width: 64px;
        height: 64px;
        -webkit-user-drag: none;
    }
    h1 {
        margin: 16px 0 12px;
        font-size: 28px;
        font-weight: 600;
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
        border: 1px solid var(--c-popover-border);
        border-radius: 12px;
        text-align: left;
        color: inherit;
        font-family: inherit;
    }
    .choice.primary {
        background: var(--c-surface-focus);
        border-color: var(--c-border-focus);
    }
    .choice:hover:not(:disabled) {
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
    import icon from "../../assets/icon.png";
    import type { StartupState, WorkspaceAction } from "../../../shared/types/startup";
    type Props = {
        state: StartupState | null;
        pending: boolean;
        onchoose: (action: WorkspaceAction) => void;
        onretry: () => void;
    };

    let { state, pending, onchoose, onretry }: Props = $props();
</script>