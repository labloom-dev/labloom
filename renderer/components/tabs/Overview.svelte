<section class="workspace-page overview">
    <header class="page-heading">
        <div><span class="eyebrow">MY LITTLE KNOWLEDGE GARDEN</span><h1>我的花园 <span class="heading-spark"><Icon name="flower" size={30} /></span></h1><p>收集好奇，连接想法。今天也让知识长大一点。</p></div>
        <span class="date"><Icon name="calendar" size={16} />{date}</span>
    </header>

    <div class="welcome-card paper-card">
        <div class="welcome-copy">
            <span class="welcome-label">给好奇心留一块地方 <span><Icon name="star" size={13} /></span></span>
            <h2>每个想法，都值得<span>生根发芽。</span></h2>
            <p>从一篇论文、一段阅读或一个小小的灵感开始，<br />慢慢编织属于你的知识世界。</p>
            <div class="welcome-actions"><button class="button primary" onclick={() => openDestination("papers")}><Icon name="book" size={15} />开始阅读</button><button class="text-button" onclick={() => createPage()}>记下一个想法 <Icon name="arrow" size={16} /></button></div>
        </div>
        <div class="hero-art"><span class="art-label">a little idea, a little bloom</span><Bloom /><span class="art-caption">GROW AT YOUR OWN PACE</span></div>
    </div>

    {#if error}<div class="notice error" role="alert">{error} <button class="text-button" onclick={load}>重新加载</button></div>{/if}
    <div class="stats" aria-busy={pending}>
        {#each stats as stat (stat.label)}
            <button class="stat-card" onclick={() => openDestination(stat.destination)}>
                <span class="stat-icon {stat.tone}"><Icon name={stat.icon} size={23} /></span>
                <span class="stat-copy"><span>{stat.label}</span><strong>{pending || error || stat.value === undefined ? "—" : stat.value}<small> {stat.unit}</small></strong></span>
                <span class="stat-caption">{stat.caption} <Icon name="arrow" size={13} /></span>
            </button>
        {/each}
    </div>

    <div class="dashboard-grid">
        <section class="paper-card feed-card">
            <header class="card-heading"><h2><span class="heading-icon"><Icon name="feed" size={18} /></span>新知来信</h2><button class="text-button" onclick={() => openDestination("feed")}>全部动态 <Icon name="arrow" size={14} /></button></header>
            {#if pending}
                <div class="empty-state" role="status"><strong>正在整理你的来信…</strong><p>读取已保存在工作区的订阅内容。</p></div>
            {:else if error}
                <div class="empty-state"><Icon name="feed" size={30} /><strong>暂时没能读到订阅</strong><p>已有内容仍保留在工作区，可以重试加载。</p><button class="button" onclick={load}>重新加载</button></div>
            {:else if feedState?.items.length}
                <div class="latest-list">
                    {#each feedState.items.slice(0, 3) as item (item.id)}
                        <button class="latest-item" onclick={() => openFeedItem(item)}>
                            <span class="item-top"><span class="source-label">{item.sourceName}</span><span>{item.isRead ? "已读" : "未读"}</span></span>
                            <strong>{item.title}</strong><span class="item-summary">{item.summary || "打开订阅，查看这条内容。"}</span>
                        </button>
                    {/each}
                </div>
            {:else}
                <div class="empty-state letters"><span class="letter-icon"><Icon name="feed" size={30} /><span><Icon name="star" size={22} /></span></span><strong>第一封新知来信，还在路上</strong><p>订阅你喜欢的论文方向或实验室博客，<br />让值得阅读的内容在这里相遇。</p><button class="button" onclick={() => openDestination("feed")}><Icon name="plus" size={14} />添加我的第一个订阅</button></div>
            {/if}
        </section>
        <section class="paper-card start-card">
            <header class="card-heading"><h2><span class="heading-icon sage"><Icon name="book" size={18} /></span>从这里开始</h2><span class="badge">一步一步来</span></header>
            <div class="steps">
                <button onclick={() => openDestination("feed")}><span class="step-number">01</span><span><strong>发现值得读的内容</strong><small>连接 RSS、arXiv 与研究博客</small></span><Icon name="arrow" size={15} /></button>
                <button onclick={() => openDestination("papers")}><span class="step-number sage">02</span><span><strong>给阅读留一点时间</strong><small>打开 PDF，专心读一篇论文</small></span><Icon name="arrow" size={15} /></button>
                <button onclick={() => openDestination("settings")}><span class="step-number lilac">03</span><span><strong>让阅读更合心意</strong><small>调整主题、字号与动效</small></span><Icon name="arrow" size={15} /></button>
            </div>
            <div class="little-note"><span><Icon name="star" size={28} /></span><p>知识不必一次成林。<br /><strong>今天种下一颗种子就很好。</strong></p></div>
        </section>
    </div>
    <section class="paper-card recent-pages"><header class="card-heading"><h2>最近整理</h2><button class="text-button" onclick={() => openDestination("library")}>全部页面 <Icon name="arrow" size={14} /></button></header>{#each recent as page (page.id)}<button class="recent-page" onclick={() => openPage(page.id)}><strong>{page.title || "未命名"}</strong><span>{page.excerpt || "还没有正文"}</span></button>{:else}<p>从一篇笔记开始，让想法慢慢生长。</p>{/each}</section>
    <footer class="page-footer"><span><Icon name="flower" size={12} /> 知织，你的知识，慢慢生长</span><span>Where ideas take root.</span></footer>
</section>


<style>
    .recent-pages { margin-top: 22px; padding: 22px; }
    .recent-page { display: flex; justify-content: space-between; gap: 20px; width: 100%; padding: 14px 0; text-align: left; border-bottom: 1px dashed var(--c-line); font-size: 12px; }
    .recent-page span { color: var(--c-muted); max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .recent-pages > p { color: var(--c-muted); font-size: 12px; }
    .heading-spark {
        display: inline-block;
        margin-left: 6px;
        color: #b18c42;
        font-size: 30px;
        transform: rotate(-13deg);
    }
    .date {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 8px 11px;
        border: 1px solid var(--c-tab-header-border);
        border-radius: 8px;
        background: var(--c-paper);
        color: var(--c-muted);
        font-size: 10px;
    }
    .welcome-card {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        padding: 28px 34px;
        background: var(--c-gold-light);
        overflow: hidden;
    }
    .welcome-copy {
        position: relative;
        z-index: 1;
    }
    .welcome-label {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 5px 9px;
        border: 1px solid #cfb77f;
        border-radius: 6px;
        color: var(--c-accent);
        font-size: 10px;
        transform: rotate(-2deg);
    }
    .welcome-label span {
        color: #b18c42;
    }
    h2 {
        margin: 19px 0 12px;
        font-size: clamp(22px, 2.4vw, 30px);
        font-weight: 900;
        letter-spacing: -.7px;
        line-height: 1.5;
    }
    .welcome-copy h2 span {
        display: inline-block;
        text-decoration: underline;
        text-decoration-color: var(--c-gold);
        text-decoration-thickness: 6px;
        text-underline-offset: -2px;
        text-decoration-skip-ink: none;
    }
    .welcome-copy p {
        margin: 0;
        color: var(--c-muted);
        font-size: 12px;
        line-height: 1.9;
    }
    .welcome-actions {
        display: flex;
        align-items: center;
        gap: 22px;
        margin-top: 24px;
    }
    .text-button {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        color: var(--c-muted);
        font-size: 11px;
        font-weight: 800;
    }
    .text-button:hover {
        color: var(--c-ink);
        text-decoration: underline;
        text-underline-offset: 4px;
    }
    .hero-art {
        position: relative;
        width: 250px;
        flex-shrink: 0;
        padding-top: 12px;
        transform: rotate(3deg);
    }
    .art-label {
        display: block;
        text-align: center;
        color: var(--c-muted);
        font-size: 13px;
        font-style: italic;
    }
    .art-caption {
        display: block;
        text-align: center;
        color: var(--c-muted);
        font-size: 8px;
        font-weight: 800;
        letter-spacing: 1.8px;
    }
    .notice {
        margin-top: 22px;
    }
    .stats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 17px;
        margin: 25px 0;
    }
    .stat-card {
        display: grid;
        grid-template-columns: 43px 1fr;
        align-items: center;
        gap: 11px 14px;
        padding: 19px 20px 14px;
        border: 1.5px solid var(--c-tab-header-border);
        border-radius: 13px;
        background: var(--c-paper);
        text-align: left;
    }
    .stat-card:hover {
        border-color: var(--c-ink);
    }
    .stat-icon {
        display: grid;
        place-items: center;
        width: 43px;
        height: 43px;
        border: 1.5px solid var(--c-ink);
        border-radius: 12px;
        background: var(--c-gold-light);
        transform: rotate(-5deg);
    }
    .sage {
        background: var(--c-sage);
    }
    .lilac {
        background: var(--c-lilac);
    }
    .stat-copy > span {
        display: block;
        color: var(--c-muted);
        font-size: 10px;
    }
    .stat-copy strong {
        display: block;
        margin-top: 3px;
        font-size: 29px;
        font-weight: 900;
        line-height: 1;
    }
    .stat-copy small {
        color: var(--c-muted);
        font-size: 10px;
        font-weight: 500;
    }
    .stat-caption {
        display: flex;
        justify-content: space-between;
        grid-column: 1 / -1;
        padding-top: 10px;
        border-top: 1px dashed var(--c-line);
        color: var(--c-muted);
        font-size: 10px;
    }
    .dashboard-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
        gap: 24px;
    }
    .card-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 60px;
        padding: 14px 19px;
        border-bottom: 1px solid var(--c-line);
    }
    .card-heading h2 {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0;
        font-size: 14px;
        letter-spacing: 0;
    }
    .heading-icon {
        display: grid;
        place-items: center;
        width: 29px;
        height: 29px;
        border: 1px solid var(--c-ink);
        border-radius: 8px;
        background: var(--c-gold-light);
        transform: rotate(-5deg);
    }
    .heading-icon.sage {
        background: var(--c-sage);
    }
    .letters {
        min-height: 263px;
    }
    .letter-icon {
        position: relative;
        display: grid;
        place-items: center;
        width: 58px;
        height: 55px;
        margin-bottom: 4px;
        border: 1.5px solid var(--c-ink);
        border-radius: 11px;
        background: var(--c-gold-light);
        box-shadow: 3px 3px 0 #e0d4b8;
        transform: rotate(-8deg);
    }
    .letter-icon > span {
        position: absolute;
        right: -17px;
        top: -10px;
        color: #ba9145;
        font-size: 23px;
    }
    .steps {
        padding: 6px 18px;
    }
    .steps button {
        display: flex;
        align-items: center;
        gap: 11px;
        width: 100%;
        padding: 15px 0;
        text-align: left;
        border-bottom: 1px dashed var(--c-line);
    }
    .steps button:last-child {
        border: 0;
    }
    .steps button:hover strong {
        color: var(--c-accent);
    }
    .step-number {
        display: grid;
        place-items: center;
        flex-shrink: 0;
        width: 30px;
        height: 32px;
        border: 1px solid var(--c-tab-header-border);
        border-radius: 8px;
        background: var(--c-gold-light);
        font-size: 12px;
        font-weight: 900;
    }
    .step-number.sage {
        background: var(--c-sage);
    }
    .step-number.lilac {
        background: var(--c-lilac);
    }
    .steps button > span:nth-child(2) {
        flex: 1;
    }
    .steps strong {
        display: block;
        font-size: 11px;
    }
    .steps small {
        display: block;
        margin-top: 6px;
        color: var(--c-muted);
        font-size: 10px;
    }
    .little-note {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 0 17px 17px;
        padding: 11px 15px;
        border-radius: 8px;
        background: var(--c-cream);
    }
    .little-note > span {
        color: #a88a48;
        font-size: 30px;
    }
    .little-note p {
        margin: 0;
        color: var(--c-muted);
        font-size: 10px;
        line-height: 1.8;
    }
    .little-note strong {
        font-weight: 600;
    }
    .latest-list {
        padding: 0 19px;
    }
    .latest-item {
        display: block;
        width: 100%;
        padding: 17px 0;
        border-bottom: 1px dashed var(--c-line);
        text-align: left;
    }
    .latest-item:last-child {
        border: 0;
    }
    .latest-item:hover strong {
        color: var(--c-accent);
    }
    .item-top {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        color: var(--c-muted);
        font-size: 9px;
    }
    .source-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .latest-item strong, .item-summary {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        overflow: hidden;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        line-height: 1.7;
    }
    .latest-item strong {
        margin-top: 7px;
        font-size: 12px;
    }
    .item-summary {
        margin-top: 5px;
        -webkit-line-clamp: 1;
        line-clamp: 1;
        color: var(--c-muted);
        font-size: 10px;
    }
    .page-footer {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        padding-top: 27px;
        color: var(--c-muted);
        font-size: 9px;
    }
    @container (max-width: 760px) {
        .hero-art {
            width: 170px;
        }
        .welcome-card {
            padding: 25px;
        }
        .dashboard-grid {
            grid-template-columns: 1fr;
        }
        .stat-card {
            padding: 15px 12px 12px;
            gap: 10px;
        }
        .stat-caption {
            font-size: 9px;
        }
    }
    @container (max-width: 540px) {
        .hero-art {
            display: none;
        }
        .stats {
            grid-template-columns: 1fr;
            gap: 10px;
        }
        .stat-card {
            grid-template-columns: 40px 1fr 1fr;
        }
        .stat-caption {
            grid-column: auto;
            border: 0;
            padding: 0;
        }
        .stat-copy strong {
            font-size: 24px;
        }
        .page-footer > span:last-child {
            display: none;
        }
    }
</style>


<script lang="ts">
    import { onMount } from "svelte";
    import { type FeedState } from "../../../shared/types/feed";
    import Bloom from "../utils/Bloom.svelte";
    import Icon, { type IconName } from "../utils/Icon.svelte";
    import { openDestination, openPage, createPage, type Destination } from "../layout/navigation";
    import { openFeedItem } from "../Feed/navigation.svelte";
    import { type PageSummary } from "../../../shared/types/content";
    import { registerList } from "../Knowledge/state.svelte";
    import { visits } from "../Tab/activity.svelte";

    let { tabId }: { tabId: string } = $props();
    let feedState = $state<FeedState | null>(null);
    let counts = $state<{ pages: number; papers: number; tasks: number } | null>(null);
    let recent = $state<PageSummary[]>([]);
    let pending = $state(true);
    let error = $state("");
    let date = $state(today());
    let loading = false;
    let active = true;
    const stats = $derived([
        { label: "花园中的页面", value: counts?.pages, unit: "页", caption: "连接积累的想法", icon: "library", tone: "gold", destination: "library" },
        { label: "收藏的文献", value: counts?.papers, unit: "篇", caption: "随时回来阅读", icon: "book", tone: "sage", destination: "papers" },
        { label: "待完成任务", value: counts?.tasks, unit: "项", caption: "给研究留出时间", icon: "calendar", tone: "lilac", destination: "calendar" }
    ] satisfies { label: string; value: number | undefined; unit: string; caption: string; icon: IconName; tone: string; destination: Destination }[]);

    function today(): string {
        return new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
    }

    async function load(): Promise<void> {
        if (loading) return;
        loading = true;
        pending = true;
        error = "";
        try {
            const [result, pages, papers, todo, doing] = await Promise.all([window.api.feed.getState({}), window.api.knowledge.list({ limit: 5 }), window.api.knowledge.list({ kind: "paper", limit: 1 }), window.api.knowledge.list({ kind: "task", attributes: { task_status: "todo" }, limit: 1 }), window.api.knowledge.list({ kind: "task", attributes: { task_status: "doing" }, limit: 1 })]);
            if (active) {
                feedState = result; counts = { pages: pages.total, papers: papers.total, tasks: todo.total + doing.total }; recent = pages.items;
            }
        }
        catch (cause) {
            if (active) error = cause instanceof Error ? cause.message : "暂时无法读取订阅内容。";
        }
        finally {
            loading = false;
            if (active) pending = false;
        }
    }

    onMount(() => {
        const release = registerList(tabId, change => change.pages, load);
        const timer = setInterval(() => {
            date = today(); visits.refresh(tabId);
        }, 60000);
        return () => {
            active = false; clearInterval(timer); release();
        };
    });
</script>