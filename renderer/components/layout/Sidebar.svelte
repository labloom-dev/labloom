<aside>
    <div class="workspace-label">
        <span class="workspace-avatar">知</span>
        <div><strong title={workspace.name}>{workspace.name}</strong><span>我的个人知识空间</span></div>
    </div>
    <button class="button primary new-draft" onclick={openDraft} title="新建知识页面"><Icon name="plus" size={16} /><span>记录一个灵感</span></button>
    <nav aria-label="主导航">
        <p class="section-label">我的工作台 <span>WORKSPACE</span></p>
        {#each destinations.slice(0, 6) as item (item.type)}
            <button class="nav-item" class:active={activeType === item.type} aria-current={activeType === item.type ? "page" : undefined} onclick={() => openDestination(item.type)} title={item.title}>
                <Icon name={item.icon} size={20} /><span>{item.title}</span>

            </button>
        {/each}
    </nav>
    {#if pinned.length}<nav class="pinned" aria-label="固定页面"><p class="section-label">固定的想法</p>{#each pinned as page}<button class="nav-item" onclick={() => openPage(page)} title={page.title}><Icon name="pen" size={17} /><span>{page.title}</span></button>{/each}</nav>{/if}
    <div class="garden-note">
        <div class="small-bloom"><Bloom /></div>
        <strong>一点一滴，慢慢生长。</strong>
        <p>每一个小想法，<br />都有长成大树的可能。</p>
        <span class="note-star"><Icon name="star" size={20} /></span>
    </div>
    <div class="bottom">
        <button class="nav-item" class:active={activeType === "settings"} onclick={() => openDestination("settings")} title="偏好设置"><Icon name="settings" /><span>偏好设置</span></button>
        <button class="about-link" onclick={() => openDestination("about")}>LABLOOM <span>Where ideas take root.</span></button>
    </div>
</aside>


<style>
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
    .new-draft {
        width: 100%;
        flex-shrink: 0;
        transform: rotate(-1deg);
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
        color: #695f4d;
        text-align: left;
        font-size: 12px;
        font-weight: 700;
        transition: background .15s, transform .15s;
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
    .pinned .nav-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .garden-note {
        position: relative;
        margin: auto 3px 0;
        padding: 0 12px 16px;
        border: 1px dashed #c8b997;
        border-radius: 12px;
        background: repeating-linear-gradient(-45deg, #faf6eb, #faf6eb 5px, #f5f0e4 5px, #f5f0e4 6px);
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
        .workspace-label, .garden-note, .section-label, .about-link, .nav-item span, .new-draft span {
            display: none;
        }
        .nav-item, .new-draft {
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
    import { untrack } from "svelte";
    import type { PageSummary } from "../../../shared/types/knowledge";
    import { knowledgeState } from "../Knowledge/state.svelte";
    import type { Workspace } from "../../../shared/types/startup";
    import { tabState } from "../Tab/state.svelte";
    import Icon from "../utils/Icon.svelte";
    import Bloom from "../utils/Bloom.svelte";
    import { destinations, openDestination, openDraft, openPage } from "./navigation";

    let { workspace }: { workspace: Workspace } = $props();
    let pinned = $state<PageSummary[]>([]);
    $effect(() => { knowledgeState.version; untrack(() => { void window.api.knowledge.list({ pinned: true, limit: 30 }).then(result => { pinned = result.items; }).catch(() => {}); }); });
    const activeType = $derived.by(() => {
        const group = tabState.groups.find(group => group.id === tabState.focusedGroupId);
        return group?.tabs.find(tab => tab.id === group.activeTabId)?.type;
    });
</script>