<aside>
    <div class="workspace-label">
        <span class="workspace-avatar">知</span>
        <div><strong title={workspace.name}>{workspace.name}</strong><span>我的个人知识空间</span></div>
    </div>
    <nav aria-label="主导航">
        <p class="section-label">我的工作台 <span>WORKSPACE</span></p>
        {#each destinations.filter(item => item.type !== "settings" && item.type !== "about") as item (item.type)}
            <button class="nav-item" class:active={activeType === item.type} aria-current={activeType === item.type ? "page" : undefined} onclick={() => openDestination(item.type)} title={item.title} aria-label={item.title}>
                <Icon name={item.icon} size={20} /><span>{item.title}</span>

            </button>
        {/each}
    </nav>
    {#if pinned.length}<section class="pinned"><p class="section-label">固定页面</p>{#each pinned as page (page.id)}<button class="pin" onclick={() => openPage(page.id)}><Icon name="pen" size={14} /><span>{page.title || "未命名"}</span></button>{/each}</section>{/if}
    <div class="garden-note">
        <div class="small-bloom"><Bloom /></div>
        <strong>一点一滴，慢慢生长。</strong>
        <p>每一个小想法，<br />都有长成大树的可能。</p>
        <span class="note-star"><Icon name="star" size={20} /></span>
    </div>
    <div class="bottom">
        <button class="nav-item" class:active={activeType === "settings"} onclick={() => openDestination("settings")} title="偏好设置" aria-label="偏好设置" aria-current={activeType === "settings" ? "page" : undefined}><Icon name="settings" /><span>偏好设置</span></button>
        <button class="about-link" onclick={() => openDestination("about")}>LABLOOM <span>Where ideas take root.</span></button>
    </div>
</aside>


<style>
    .pin { display: flex; align-items: center; gap: 9px; padding: 7px 12px; width: 100%; text-align: left; font-size: 11px; }
    .pin span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pin:hover { background: var(--c-sage); border-radius: 6px; }
    aside {
        display: flex;
        flex-direction: column;
        gap: 22px;
        flex: 0 0 230px;
        min-height: 0;
        padding: 25px 18px 16px;
        border-right: 1.5px solid var(--c-ink);
        background: var(--c-sidebar-background);
        overflow-y: auto;
    }
    .workspace-label {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 4px;
    }
    .workspace-avatar {
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        flex-shrink: 0;
        border: 1px solid #a5b58e;
        border-radius: 10px;
        background: var(--c-sage);
        font-size: 14px;
    }
    .workspace-label div {
        min-width: 0;
    }
    .workspace-label strong {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
    }
    .workspace-label div > span {
        display: block;
        margin-top: 5px;
        color: var(--c-muted);
        font-size: 10px;
    }
    .section-label {
        display: flex;
        justify-content: space-between;
        margin: 0 8px 12px;
        color: var(--c-muted);
        font-size: 10px;
    }
    .section-label span {
        font-size: 8px;
        letter-spacing: 1px;
    }
    .nav-item {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 43px;
        margin-bottom: 5px;
        padding: 10px 13px;
        border: 1.5px solid transparent;
        border-radius: 10px;
        color: var(--c-muted);
        text-align: left;
        font-size: 12px;
        font-weight: 700;
    }
    .nav-item:hover {
        background: var(--c-cream);
        color: var(--c-ink);
    }
    .nav-item.active {
        border-color: var(--c-ink);
        background: var(--c-gold-light);
        box-shadow: 2px 2px 0 var(--c-ink);
        color: var(--c-ink);
    }
    .garden-note {
        position: relative;
        margin: auto 3px 0;
        padding: 0 12px 16px;
        border: 1px dashed #c8b997;
        border-radius: 12px;
        background: repeating-linear-gradient(-45deg, var(--c-note-stripe, #faf6eb), var(--c-note-stripe, #faf6eb) 5px, var(--c-note-line, #f5f0e4) 5px, var(--c-note-line, #f5f0e4) 6px);
        text-align: center;
    }
    .small-bloom {
        width: 108px;
        margin: -6px auto 0;
        transform: rotate(-6deg);
    }
    .garden-note strong {
        font-size: 11px;
    }
    .garden-note p {
        margin: 8px 0 0;
        color: var(--c-muted);
        font-size: 10px;
        line-height: 1.8;
    }
    .note-star {
        position: absolute;
        right: 14px;
        top: 16px;
        color: #a88135;
        font-size: 20px;
    }
    .bottom {
        margin-top: auto;
    }
    .about-link {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 17px 0 0 14px;
        color: var(--c-muted);
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 1.5px;
        text-align: left;
    }
    .about-link span {
        font-size: 9px;
        font-weight: 500;
        letter-spacing: 0;
    }
    @media (max-width: 1050px) {
        aside {
            flex-basis: 196px;
            padding-inline: 12px;
        }
        .section-label span {
            display: none;
        }
    }
    @media (max-width: 720px) {
        aside {
            flex-basis: 66px;
            gap: 16px;
            padding: 18px 8px;
        }
        .workspace-label, .garden-note, .section-label, .about-link, .nav-item span {
            display: none;
        }
        .nav-item {
            justify-content: center;
            padding: 12px;
        }
    }
    @media (max-height: 710px) {
        .garden-note {
            display: none;
        }
    }
</style>


<script lang="ts">
    import type { Workspace } from "../../../shared/types/startup";
    import { tabState } from "../Tab/state.svelte";
    import Icon from "../utils/Icon.svelte";
    import Bloom from "../utils/Bloom.svelte";
    import { destinations, openDestination, openPage } from "./navigation";
    import { type PageSummary } from "../../../shared/types/content";
    import { knowledgeState } from "../Knowledge/state.svelte";

    let { workspace }: { workspace: Workspace } = $props();
    let pinned = $state<PageSummary[]>([]);
    $effect(() => {
        void knowledgeState.change.seq; let active = true; void window.api.knowledge.list({ pinned: true, limit: 50 }).then(result => {
            if (active) pinned = result.items;
        }, () => {}); return () => {
            active = false;
        };
    });
    const activeType = $derived.by(() => {
        const group = tabState.groups.find(group => group.id === tabState.focusedGroupId);
        return group?.tabs.find(tab => tab.id === group.activeTabId)?.type;
    });
</script>