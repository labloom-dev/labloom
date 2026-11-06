<header class="titlebar">
    <button class="brand" onclick={() => openDestination("overview")} aria-label="知织首页">
        <span class="brand-mark"><img src={icon} alt="" /></span>
        <span class="wordmark">labloom<span>知织，让灵感生长</span></span>
    </button>
    <GSLauncher />
    <div class="header-actions">
        <span class="local-badge"><span></span> 本地工作区</span>
        <Menu />
    </div>
</header>


<style>
    .titlebar {
        -webkit-app-region: drag;
        display: grid;
        grid-template-columns: 214px minmax(160px, 440px) minmax(120px, 1fr);
        align-items: center;
        gap: 24px;
        height: max(74px, env(titlebar-area-height, 36px));
        flex-shrink: 0;
        padding: 0 max(18px, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))) 0 max(22px, env(titlebar-area-x, 0px));
        border-bottom: 1.5px solid var(--c-ink);
        background: var(--c-navbar-background);
    }
    .titlebar :global(button) {
        -webkit-app-region: no-drag;
    }
    .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        text-align: left;
    }
    .brand-mark {
        display: grid;
        place-items: center;
        width: 40px;
        height: 44px;
        border: 1.5px solid var(--c-ink);
        border-radius: 12px;
        background: var(--c-gold-light);
        transform: rotate(-6deg);
    }
    img {
        width: 30px;
        height: 34px;
        object-fit: contain;
        -webkit-user-drag: none;
    }
    .wordmark {
        font-size: 26px;
        line-height: 1.05;
        font-weight: 900;
        letter-spacing: -.8px;
    }
    .wordmark span {
        display: block;
        margin-top: 5px;
        color: var(--c-muted);
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 1px;
    }
    .header-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 18px;
    }
    .local-badge {
        display: flex;
        align-items: center;
        gap: 7px;
        color: var(--c-muted);
        font-size: 10px;
        white-space: nowrap;
    }
    .local-badge span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #738d63;
        box-shadow: 0 0 0 3px var(--c-sage);
    }
    @media (max-width: 900px) {
        .titlebar {
            grid-template-columns: 168px minmax(120px, 1fr) auto;
            gap: 14px;
        }
        .local-badge {
            display: none;
        }
    }
    @media (max-width: 600px) {
        .titlebar {
            grid-template-columns: 40px minmax(100px, 1fr) auto;
            height: 66px;
            padding-left: max(12px, env(titlebar-area-x, 0px));
            gap: 12px;
        }
        .wordmark {
            display: none;
        }
    }
</style>


<script lang="ts">
    import icon from "../../assets/icon.png";
    import GSLauncher from "../globalSearch/GSLauncher.svelte";
    import Menu from "./Menu.svelte";
    import { openDestination } from "./navigation";
</script>