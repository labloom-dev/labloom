<section class="feed" class:reading={detail !== null}>
    <header class="top">
        <div class="heading-copy"><h1>订阅动态</h1></div>
        <p class="summary-line" role="status">{summary}</p>
        <button disabled={!enabled.length || refreshing > 0} onclick={() => refresh()}><Icon name="refresh" size={15} />{refreshing ? "正在刷新…" : "刷新全部"}</button>
        <button class="primary" onclick={() => openForm()}><Icon name="plus" size={15} />添加来源</button>
    </header>
    {#if error}
        <p class="error banner" role="alert"><span>{message(error)}</span><button onclick={() => error = ""}>{t("dialog.close")}</button></p>
    {/if}

    <div class="body">
        <nav class="rail" aria-label="订阅来源">
            <button class="entry" class:active={scope === ""} onclick={() => choose("")}>
                <span class="name">全部内容</span>
                {#if feedState.unreadCount}<span class="count">{feedState.unreadCount}</span>{/if}
            </button>
            <button class="entry" class:active={followed} onclick={() => choose(followedScope)}>
                <span class="name">关注关键词</span>
            </button>
            <h2>来源</h2>
            {#each active as item (item.id)}
                <button class="entry" class:active={sourceId === item.id} title={item.url} onclick={() => choose(item.id)}>
                    <span class="name">{item.name}</span>
                    {#if item.refreshing}<span class="state">刷新中</span>{:else if item.status === "paused"}<span class="state">已暂停</span>{:else if item.error}<span class="state failed">失败</span>{/if}
                    {#if item.unreadCount}<span class="count">{item.unreadCount}</span>{/if}
                </button>
            {:else}
                <p class="hint">还没有订阅来源。</p>
            {/each}
            {#if cancelled.length}
                <details open={cancelled.some(item => item.id === sourceId)}>
                    <summary>已取消（{cancelled.length}）</summary>
                    {#each cancelled as item (item.id)}
                        <button class="entry" class:active={sourceId === item.id} title={item.url} onclick={() => choose(item.id)}>
                            <span class="name">{item.name}</span>
                        </button>
                    {/each}
                </details>
            {/if}
        </nav>

        <div class="list-pane">
            <form class="filters" onsubmit={search}>
                <label class="scope">
                    <span class="sr">查看范围</span>
                    <select value={scope} onchange={event => choose(event.currentTarget.value)}>
                        <option value="">全部内容{feedState.unreadCount ? `（${feedState.unreadCount} 条未读）` : ""}</option>
                        <option value={followedScope}>关注关键词</option>
                        {#each feedState.sources as item (item.id)}
                            <option value={item.id}>{item.name}{item.status === "cancelled" ? "（已取消）" : item.status === "paused" ? "（已暂停）" : item.unreadCount ? `（${item.unreadCount} 条未读）` : ""}</option>
                        {/each}
                    </select>
                </label>
                <label class="search">
                    <span class="sr">搜索标题或摘要</span>
                    <input bind:value={keyword} type="search" placeholder="搜索标题或摘要" oninput={searchSoon} />
                </label>
                <div class="segmented" role="group" aria-label="阅读状态">
                    {#each readOptions as option (option.value)}
                        <button type="button" class:active={read === option.value} aria-pressed={read === option.value} onclick={() => {
                            read = option.value; navigate();
                        }}>{option.label}</button>
                    {/each}
                </div>
                <button type="button" title="切换发布时间的排列方向" onclick={() => {
                    order = order === "newest" ? "oldest" : "newest"; navigate();
                }}>{order === "newest" ? "最新在前" : "最早在前"}</button>
            </form>

            {#if source}
                {@const current = source}
                <div class="context">
                    <div class="context-head"><strong>{current.name}</strong><span class="address" title={current.url}>{current.url}</span></div>
                    <p>{sourceStatus(current)}</p>
                    {#if current.error && current.status !== "cancelled"}
                        <div class="error" role="alert">{message(current.error)}{#if current.error.diagnostic}<details><summary>{t("dialog.details")}</summary>{current.error.diagnostic}</details>{/if}</div>
                    {/if}
                    <div class="actions">
                        {#if current.status === "enabled"}
                            <button disabled={current.refreshing} onclick={() => refresh(current.id)}>{current.refreshing ? "正在刷新…" : current.error ? "重试" : "刷新"}</button>
                        {/if}
                        {#if current.status === "cancelled"}
                            <button onclick={() => setStatus(current.id, "resume")}>恢复订阅</button>
                        {:else}
                            <button onclick={() => openForm(current)}>编辑</button>
                            <button onclick={() => setStatus(current.id, current.status === "paused" ? "resume" : "pause")}>{current.status === "paused" ? "恢复获取" : "暂停"}</button>
                            <button onclick={() => confirming = "cancel"}>取消订阅</button>
                        {/if}
                    </div>
                    {#if confirming === "cancel"}
                        <div class="confirmation">
                            <p>{t("dialog.cancelFeed")}</p>
                            <button onclick={() => setStatus(current.id, "cancel")}>{t("dialog.confirmCancelFeed")}</button>
                            <button onclick={() => confirming = ""}>{t("dialog.keepFeed")}</button>
                        </div>
                    {/if}
                </div>
            {:else if followed}
                <div class="context">
                    <p>标题或摘要包含任一关注关键词的内容会显示在这里。</p>
                    {#if feedState.keywords.length}
                        <div class="chips">
                            {#each feedState.keywords as word (word)}
                                <span class="chip">{word}<button aria-label={`移除关键词 ${word}`} onclick={() => saveKeywords(feedState.keywords.filter(saved => saved !== word))}><Icon name="close" size={12} /></button></span>
                            {/each}
                        </div>
                    {/if}
                    <form class="add" onsubmit={addKeyword}>
                        <input bind:value={newKeyword} maxlength="100" placeholder="添加关键词，例如 diffusion" aria-label="新的关注关键词" />
                        <button type="submit" disabled={!newKeyword.trim()}>添加</button>
                    </form>
                </div>
            {:else if failing.length}
                <div class="context">
                    {#each failing as item (item.id)}
                        <p class="error" role="alert"><span>{item.name}：{message(item.error)}</span><button disabled={item.refreshing} onclick={() => refresh(item.id)}>{item.refreshing ? "正在刷新…" : "重试"}</button></p>
                    {/each}
                </div>
            {/if}

            <div class="list-head">
                <span>{loaded ? `共 ${feedState.total} 条` : "正在读取订阅…"}</span>
                {#if !followed && !keyword.trim() && read !== "read" && unreadInScope}
                    <button class="link" onclick={() => confirming = "read"}>全部标为已读</button>
                {/if}
            </div>
            {#if confirming === "read"}
                <div class="context confirmation">
                    <p>{t("dialog.markRead", { source: source ? source.name : t("dialog.allSources"), count: unreadInScope })}</p>
                    <button onclick={markAll}>{t("dialog.confirmMarkRead")}</button>
                    <button onclick={() => confirming = ""}>{t("dialog.cancel")}</button>
                </div>
            {/if}

            <div class="list" bind:this={list}>
                {#each feedState.items as item (item.id)}
                    <div class="item" class:active={detail?.id === item.id} class:unread={!item.isRead}>
                        <button class="open" onclick={() => open(item)}>
                            <span class="meta metadata">
                                <span>{item.sourceName}</span>
                                <span>{formatDate(item.publishedAt)}</span>
                                {#if item.paperId}<span class="tag">已入库</span>{/if}
                                <span class="sr">{item.isRead ? "已读" : "未读"}</span>
                            </span>
                            <strong>{item.title}</strong>
                            {#if item.authors}<span class="meta">{item.authors}</span>{/if}
                            <span class="excerpt">{item.summary || "来源未提供摘要。"}</span>
                        </button>
                        {#if item.url}
                            <button class="origin" title="在浏览器中打开原文" onclick={() => openOriginal(item.id)}>原文<Icon name="arrow" size={12} /></button>
                        {/if}
                    </div>
                {:else}
                    {#if loaded}
                        <div class="empty-state">
                            <Icon name="feed" size={30} />
                            {#if !active.length && !sourceId}
                                <strong>还没有新知来信</strong>
                                <p>添加论文或博客的订阅来源，开始获取更新。</p>
                                <button onclick={() => openForm()}>添加来源</button>
                            {:else if followed && !feedState.keywords.length}
                                <strong>还没有关注关键词</strong>
                                <p>在上方添加关键词，匹配的论文和文章会集中显示在这里。</p>
                            {:else}
                                <strong>没有匹配的内容</strong>
                                <p>试试刷新来源，或调整上方的筛选条件。</p>
                            {/if}
                        </div>
                    {/if}
                {/each}
                {#if feedState.total > feedPageSize}
                    <div class="pagination">
                        <button disabled={offset === 0} onclick={() => page(-feedPageSize)}>上一页</button>
                        <span>{offset + 1}–{Math.min(offset + feedPageSize, feedState.total)} / {feedState.total}</span>
                        <button disabled={offset + feedPageSize >= feedState.total} onclick={() => page(feedPageSize)}>下一页</button>
                    </div>
                {/if}
            </div>
        </div>

        <article class="reader" bind:this={reader} onscroll={scrolled}>
            {#if detail}
                {@const current = detail}
                <button class="back" onclick={close}>返回列表</button>

                <h2>{current.title}</h2>
                <p class="meta metadata">
                    <span>{current.sourceName}</span>
                    <span>{formatDate(current.publishedAt)}</span>
                </p>
                {#if current.authors}<p class="authors">{current.authors}</p>{/if}
                <div class="actions toolbar">
                    <button disabled={!current.url} onclick={() => openOriginal(current.id)}>打开原文</button>
                    <button onclick={toggleRead}>{current.isRead ? "标为未读" : "标为已读"}</button>
                    {#if current.paperState === "saved" && current.paperId}
                        <button onclick={() => openPaper(current.paperId!)}>已入库 · 打开文献页</button>
                        {#if current.pdfURL && current.pdfStatus !== "saved"}
                            <button disabled={current.pdfStatus === "downloading"} onclick={() => fetchPDF(current.id)}>{current.pdfStatus === "downloading" ? "正在获取 PDF…" : "重新获取 PDF"}</button>
                        {/if}
                    {:else if current.paperState === "none"}
                        <button disabled={importing} onclick={() => importItem(false)}>{importing ? "正在加入…" : "加入文献库"}</button>
                    {/if}
                    <span class="group">
                        <button disabled={selectedIndex <= 0} onclick={() => open(feedState.items[selectedIndex - 1])}>上一篇</button>
                        <button disabled={selectedIndex < 0 || selectedIndex >= feedState.items.length - 1} onclick={() => open(feedState.items[selectedIndex + 1])}>下一篇</button>
                        {#if appearance.loaded}
                            <button aria-label="缩小正文字号" disabled={sizes.indexOf(appearance.readingSize) <= 0} onclick={() => resize(-1)}>A−</button>
                            <button aria-label="放大正文字号" disabled={sizes.indexOf(appearance.readingSize) >= sizes.length - 1} onclick={() => resize(1)}>A+</button>
                        {/if}
                    </span>
                </div>
                {#if current.paperState === "recycled" || current.paperState === "missing"}
                    <div class="context confirmation">
                        <p>{t(current.paperState === "recycled" ? "dialog.reimportRecycled" : "dialog.reimportMissing")}</p>
                        <button disabled={importing} onclick={() => importItem(true)}>{t("dialog.reimport")}</button>
                    </div>
                {/if}
                {#if current.paperState === "saved" && current.pdfStatus === "failed"}
                    <p class="error" role="alert">{message(current.pdfFailure ?? { kind: "pdf-unavailable" })}</p>
                {/if}
                {#if current.content}
                    <div class="content" {@attach show(current.content, current.url)}></div>
                {:else}
                    <p class="content plain">{current.summary || "来源未提供摘要。"}</p>
                {/if}
                <p class="meta note">{current.fullContent ? "以上为来源提供的正文。" : "以上为来源提供的摘要，可能不是全文。"}{current.url ? current.fullContent ? "" : "完整内容请打开原文查看。" : "来源未提供可用的原文链接。"}</p>
            {:else}
                <div class="empty-state"><div class="empty-art"><Bloom /></div><strong>挑一封来信，慢慢读。</strong><p>选择左侧内容，在这里阅读正文或摘要，<br />或打开原文继续探索。</p></div>
            {/if}
        </article>
    </div>

    {#if showForm}
        <div class="shade" role="presentation" onclick={event => {
            if (event.target === event.currentTarget && !saving) showForm = false;
        }} onkeydown={event => {
            if (event.key === "Escape" && !saving) showForm = false;
        }}>
            <div class="dialog" role="dialog" aria-modal="true" aria-label={editing ? "编辑来源" : "添加来源"}>
                {#key editing?.id}
                    <SourceForm source={editing} pending={saving} error={formError} onsave={saveSource} oncancel={() => showForm = false} />
                {/key}
            </div>
        </div>
    {/if}
</section>


<style>
    .feed {
        position: relative;
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        padding: clamp(14px, 2vw, 24px);
        gap: 14px;
        color: var(--c-ink);
        font-size: var(--font-secondary);
        container-type: inline-size;
    }
    .top, .actions, .pagination, .filters, .list-head, .chips, .add {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
    }
    .heading-copy {
        flex: 1;
        min-width: 160px;
    }
    h1 {
        margin: 4px 0 0;
        font-size: 24px;
        font-weight: 900;
    }
    .summary-line {
        margin: 0;
        color: var(--c-muted);
        font-size: var(--font-min);
    }
    .sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
    }
    button, input, select {
        box-sizing: border-box;
        border: 1px solid var(--c-reader-input-border);
        border-radius: var(--control-radius);
        background: var(--c-paper);
        color: inherit;
        font: inherit;
    }
    button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        height: var(--button-height);
        min-height: var(--button-height);
        padding: 0 8px;
        font-weight: 700;
    }
    .top > button {
        height: var(--button-height);
        min-height: var(--button-height);
        border: var(--border-width) solid var(--c-line);
        padding: 0 8px;
        border-radius: var(--control-radius);
    }
    .top > button.primary {
        background: var(--c-gold);
        box-shadow: none;
    }
    button:hover:not(:disabled) {
        background: var(--c-gold-light);
        border-color: var(--c-ink);
    }
    button:disabled, input:disabled, select:disabled {
        opacity: .45;
        cursor: not-allowed;
    }
    button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible {
        outline: var(--focus-width, 2px) solid var(--c-border-focus);
        outline-offset: var(--focus-offset, 2px);
    }
    input[type="search"], input:not([type]), select {
        height: var(--button-height);
        min-width: 0;
        max-width: 100%;
        padding-inline: 10px;
        color: var(--c-ink);
    }
    input::placeholder {
        color: var(--c-search-placeholder);
    }
    .error {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin: 0;
        padding: 10px 12px;
        border: 1px solid var(--c-reader-error-text);
        border-radius: var(--control-radius);
        background: var(--c-peach);
        color: var(--c-reader-error-text);
        line-height: 1.6;
        overflow-wrap: anywhere;
        user-select: text;
    }
    .error button {
        flex: none;
        color: var(--c-ink);
    }

    .body {
        flex: 1;
        display: grid;
        grid-template-columns: 190px clamp(260px, 30%, 380px) minmax(0, 1fr);
        gap: 16px;
        min-height: 0;
    }
    .rail, .list-pane, .reader {
        min-width: 0;
        min-height: 0;
    }
    .rail {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 10px;
        overflow-y: auto;
        border: 1px solid var(--c-tab-header-border);
        border-radius: 0;
        background: var(--c-paper);
    }
    .rail h2, .rail summary {
        margin: 12px 6px 4px;
        color: var(--c-muted);
        font-size: var(--font-min);
        font-weight: 800;
        letter-spacing: 1px;
    }
    .rail summary {
        cursor: pointer;
    }
    .rail details {
        display: flex;
        flex-direction: column;
    }
    .entry {
        justify-content: flex-start;
        width: 100%;
        min-height: var(--button-height);
        padding: 0 8px;
        border-color: transparent;
        background: none;
        text-align: left;
        font-weight: 600;
    }
    .entry.active, .entry.active:hover:not(:disabled) {
        border-color: var(--c-ink);
        background: var(--c-gold-light);
        font-weight: 800;
    }
    .name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .count, .state, .tag {
        flex: none;
        padding: 1px 7px;
        border-radius: 999px;
        font-size: var(--font-min);
        font-weight: 800;
    }
    .count {
        background: var(--c-gold);
    }
    .state, .tag {
        border: 1px solid var(--c-line);
        color: var(--c-muted);
    }
    .state.failed {
        border-color: var(--c-reader-error-text);
        color: var(--c-reader-error-text);
    }
    .hint {
        margin: 6px;
        color: var(--c-muted);
        line-height: 1.6;
    }

    .list-pane {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .filters {
        gap: 8px;
    }
    label {
        display: flex;
        min-width: 0;
    }
    .scope {
        display: none;
        flex: 1 1 100%;
    }
    .scope select {
        width: 100%;
    }
    .search {
        flex: 1 1 100%;
    }
    .search input {
        width: 100%;
    }
    .segmented {
        display: flex;
    }
    .segmented button {
        border-radius: 0;
        margin-left: -1px;
    }
    .segmented button:first-child {
        margin-left: 0;
        border-radius: 8px 0 0 8px;
    }
    .segmented button:last-child {
        border-radius: 0 8px 8px 0;
    }
    .segmented button.active, .segmented button.active:hover:not(:disabled) {
        position: relative;
        border-color: var(--c-ink);
        background: var(--c-gold-light);
    }
    .context {
        padding: 12px 14px;
        border: 1px solid var(--c-popover-border);
        border-radius: var(--control-radius);
        background: var(--c-gold-light);
        line-height: 1.7;
    }
    .context p {
        margin: 0 0 8px;
    }
    .context > :last-child {
        margin-bottom: 0;
    }
    .context-head {
        display: flex;
        flex-direction: column;
        margin-bottom: 4px;
    }
    .context-head strong {
        font-size: var(--font-body);
    }
    .address {
        /* Query addresses run to several lines; two are enough to recognise one. */
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        color: var(--c-muted);
        font-size: var(--font-min);
        overflow-wrap: anywhere;
        user-select: text;
    }
    .confirmation {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px dashed var(--c-tab-header-border);
    }
    .context.confirmation {
        margin-top: 0;
        padding-top: 12px;
        border-top: 1px solid var(--c-popover-border);
    }
    .confirmation button {
        margin-right: 6px;
    }
    .chips {
        gap: 6px;
        margin-bottom: 8px;
    }
    .chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 4px 2px 10px;
        border: 1px solid var(--c-ink);
        border-radius: 999px;
        background: var(--c-paper);
        font-weight: 700;
    }
    .chip button {
        min-height: var(--button-height);
        padding: 3px;
        border: 0;
        border-radius: 50%;
        background: none;
    }
    .add input {
        flex: 1;
    }
    .list-head {
        justify-content: space-between;
        min-height: 20px;
        color: var(--c-muted);
        font-size: var(--font-min);
    }
    .link {
        min-height: 0;
        padding: 0;
        border: 0;
        background: none;
        color: var(--c-accent);
        font-size: var(--font-min);
    }
    .link:hover:not(:disabled) {
        background: none;
        text-decoration: underline;
    }
    .list {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-height: 0;
        padding: 2px 6px 6px 2px;
        overflow-y: auto;
    }
    .item {
        position: relative;
        flex: none;
        border: 1px solid var(--c-tab-header-border);
        border-radius: 0;
        background: var(--c-paper);
        transition: border-color .15s, box-shadow .15s;
    }
    .item.active {
        border: var(--border-width) solid var(--c-line);
        background: var(--c-gold-light);
        box-shadow: none;
    }
    .open {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 7px;
        width: 100%;
        padding: 14px;
        border: 0;
        border-radius: inherit;
        background: none;
        text-align: left;
        overflow-wrap: anywhere;
        font-weight: 400;
    }
    .open:hover:not(:disabled) {
        background: var(--c-gold-light);
    }
    .open strong {
        color: var(--c-muted);
        font-size: var(--font-body);
        line-height: 1.6;
        font-weight: 700;
    }
    .unread .open strong {
        color: var(--c-ink);
        font-weight: 900;
    }
    .unread .open strong::before {
        content: "";
        display: inline-block;
        width: 7px;
        height: 7px;
        margin-right: 7px;
        border-radius: 50%;
        background: var(--c-accent);
        vertical-align: middle;
    }
    .origin {
        position: absolute;
        top: 9px;
        right: 9px;
        min-height: var(--button-height);
        padding: 2px 7px;
        gap: 3px;
        font-size: var(--font-min);
        opacity: 0;
    }
    .item:hover .origin, .origin:focus-visible {
        opacity: 1;
    }
    .meta {
        color: var(--c-muted);
        font-size: var(--font-min);
        line-height: 1.7;
    }
    .metadata {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 10px;
    }
    .metadata > span:first-child {
        color: var(--c-accent);
        font-weight: 700;
    }
    .excerpt {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        color: var(--c-muted);
        line-height: 1.7;
    }
    .pagination {
        flex: none;
        justify-content: space-between;
        padding: 6px 0;
    }
    .list > .empty-state {
        min-height: 240px;
        border: 1px dashed var(--c-tab-header-border);
        border-radius: 0;
        background: var(--c-paper);
    }

    .reader {
        --reader-padding: 24px;
        padding: var(--reader-padding) clamp(18px, 3vw, 34px);
        overflow-y: auto;
        border: var(--border-width) solid var(--c-line);
        border-radius: 15px;
        background: var(--c-paper);
        box-shadow: var(--c-shadow);
        overflow-wrap: anywhere;
        user-select: text;
    }
    .reader > * {
        max-width: 760px;
        margin-inline: auto;
    }
    .reader > .empty-state {
        min-height: 100%;
    }
    .empty-art {
        width: 150px;
        transform: rotate(-4deg);
    }
    .back {
        display: none;
        margin-bottom: 14px;
    }
    h2 {
        margin-block: 10px 12px;
        font-size: 22px;
        font-weight: 900;
        line-height: 1.5;
    }
    .authors {
        margin-block: 6px 0;
        color: var(--c-muted);
        line-height: 1.8;
    }
    .toolbar {
        position: sticky;
        /* Sticky elements stay inside the reader's padding; the offset brings the bar up to its edge. */
        top: calc(-1 * var(--reader-padding));
        z-index: 1;
        gap: 6px;
        margin-block: 8px 18px;
        padding-block: 10px;
        border-bottom: 1px dashed var(--c-line);
        background: var(--c-paper);
        user-select: none;
    }
    /* Moving between items and sizing the text wrap as one unit, kept to the right. */
    .group {
        display: flex;
        gap: 6px;
        margin-left: auto;
    }
    .content {
        font-size: var(--reading-font-size, 16px);
        line-height: 1.9;
    }
    .content.plain {
        white-space: pre-wrap;
    }
    .content :global(:is(p, ul, ol, blockquote, pre, table, figure, h3, h4, h5, h6)) {
        margin-block: 0 1em;
    }
    .content :global(:is(h3, h4, h5, h6)) {
        margin-top: 1.6em;
        font-size: 1.1em;
        font-weight: 800;
        line-height: 1.6;
    }
    .content :global(h3) {
        font-size: 1.25em;
    }
    .content :global(img) {
        display: block;
        max-width: 100%;
        height: auto;
        margin-block: 1em;
        border-radius: var(--control-radius);
    }
    .content :global(a[href]) {
        color: var(--c-accent);
        text-decoration: underline;
        text-underline-offset: .2em;
    }
    .content :global(blockquote) {
        margin-inline: 0;
        padding-left: 1em;
        border-left: 3px solid var(--c-line);
        color: var(--c-muted);
    }
    .content :global(pre) {
        padding: 12px;
        overflow-x: auto;
        border-radius: var(--control-radius);
        background: var(--c-cream);
        font-size: .85em;
        line-height: 1.6;
    }
    .content :global(table) {
        display: block;
        max-width: 100%;
        overflow-x: auto;
        border-collapse: collapse;
        font-size: .9em;
    }
    .content :global(:is(td, th)) {
        padding: 6px 10px;
        border: 1px solid var(--c-line);
    }
    .content :global(:is(ul, ol)) {
        padding-left: 1.5em;
    }
    .content :global(hr) {
        margin-block: 1.5em;
        border: 0;
        border-top: 1px dashed var(--c-line);
    }
    .note {
        margin-top: 22px;
        padding-top: 14px;
        border-top: 1px dashed var(--c-line);
    }

    .shade {
        position: absolute;
        inset: 0;
        z-index: 5;
        display: grid;
        place-items: center;
        padding: 20px;
        overflow: auto;
        background: #0006;
    }
    .dialog {
        width: min(520px, 100%);
    }

    @container (max-width: 1000px) {
        .body {
            grid-template-columns: minmax(240px, 2fr) minmax(0, 3fr);
        }
        .rail {
            display: none;
        }
        .scope {
            display: flex;
        }
    }
    @container (max-width: 640px) {
        .body {
            grid-template-columns: minmax(0, 1fr);
        }
        .reader {
            display: none;
        }
        .reading .reader {
            display: block;
        }
        .reading .list-pane {
            display: none;
        }
        .back {
            display: inline-flex;
        }
        .origin {
            opacity: 1;
        }
    }
</style>


<script lang="ts">
    import { onMount, tick, untrack } from "svelte";
    import {
        feedPageSize,
        type FeedAPI, type FeedItem, type FeedItemDetail, type FeedQuery, type FeedSource, type FeedSourceAction, type FeedSourceInput, type FeedState
    } from "../../../shared/types/feed";

    import { t, failure, message, type ErrorValue } from "../../i18n.svelte";
    import { openPage } from "../layout/navigation";
    import { appearance, saveAppearance } from "../layout/preferences.svelte";
    import Bloom from "../utils/Bloom.svelte";
    import Icon from "../utils/Icon.svelte";
    import { sanitizeContent } from "./content";
    import { formatDate, sourceStatus } from "./labels";
    import { feedNavigation } from "./navigation.svelte";
    import SourceForm from "./SourceForm.svelte";

    let { api = window.api.feed, openPaper = openPage, sourcePageId }: { api?: FeedAPI; openPaper?: (id: string) => void; sourcePageId?: string } = $props();

    const followedScope = "#followed";
    const readOptions = [{ value: "all", label: "全部" }, { value: "unread", label: "未读" }, { value: "read", label: "已读" }] as const;
    const sizes = [14, 16, 18] as const;

    let feedState = $state<FeedState>({ sources: [], items: [], total: 0, unreadCount: 0, keywords: [] });
    let loaded = $state(false);
    let sourceId = $state("");
    let followed = $state(false);
    let keyword = $state("");
    let read = $state<NonNullable<FeedQuery["read"]>>("all");
    let order = $state<NonNullable<FeedQuery["order"]>>("newest");
    let offset = $state(0);
    let error = $state<ErrorValue>("");
    let detail = $state<FeedItemDetail | null>(null);
    let showForm = $state(false);
    let editing = $state<FeedSource | undefined>();
    let saving = $state(false);
    let formError = $state<ErrorValue>("");
    let confirming = $state<"" | "cancel" | "read">("");
    let newKeyword = $state("");
    let importing = $state(false);
    let reader = $state<HTMLElement>();
    let list = $state<HTMLElement>();

    // The open item stays listed while its filters are unchanged, even after it stops matching them.
    let pinned: FeedItem | null = null;
    let requests = 0, opening = 0;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    let positionTimer: ReturnType<typeof setTimeout> | undefined;
    let moved = false, restoring = false;

    const scope = $derived(followed ? followedScope : sourceId);
    const source = $derived(feedState.sources.find(item => item.id === sourceId));
    const active = $derived(feedState.sources.filter(item => item.status !== "cancelled"));
    const cancelled = $derived(feedState.sources.filter(item => item.status === "cancelled"));
    const enabled = $derived(feedState.sources.filter(item => item.status === "enabled"));
    const failing = $derived(enabled.filter(item => item.error));
    const refreshing = $derived(feedState.sources.filter(item => item.refreshing).length);
    const unreadInScope = $derived(source ? source.unreadCount : feedState.unreadCount);
    const selectedIndex = $derived(feedState.items.findIndex(item => item.id === detail?.id));
    const summary = $derived(!loaded ? "" : refreshing ? `正在刷新 ${refreshing} 个来源…`
        : `${active.length} 个来源，${feedState.unreadCount} 条未读`);

    function fail(cause: unknown): void {
        error = failure(cause);
    }

    function query(): FeedQuery {
        return { sourceId: sourceId || undefined, keyword, read, order, followed, offset };
    }

    /** Whether a comes before b in the current list order; undated items come last. */
    function precedes(a: FeedItem, b: FeedItem): boolean {
        if (a.publishedAt === null || b.publishedAt === null) return a.publishedAt !== b.publishedAt ? b.publishedAt === null : a.id < b.id;
        if (a.publishedAt !== b.publishedAt) return order === "oldest" ? a.publishedAt < b.publishedAt : a.publishedAt > b.publishedAt;
        return a.id < b.id;
    }

    async function reload(): Promise<void> {
        const request = ++requests;
        try {
            let next = await api.getState(query());
            if (request !== requests) return;
            if (offset > 0 && offset >= next.total) {
                offset = Math.max(0, Math.floor((next.total - 1) / feedPageSize) * feedPageSize);
                next = await api.getState(query());
                if (request !== requests) return;
            }
            let current = detail;
            if (current && !next.sources.some(source => source.id === current!.sourceId)) {
                detail = null; pinned = null; current = null;
            }
            if (current) {
                const updated = await api.getItem(current.id);
                if (request !== requests) return;
                if (detail?.id === current.id) Object.assign(current, updated);
            }
            const listed = current && next.items.find(item => item.id === current.id);
            if (listed && current) {
                pinned = listed;
                current.isRead = listed.isRead;
            }
            else if (current && pinned?.id === current.id) {
                const kept = { ...pinned, isRead: current.isRead, paperId: current.paperId };
                const index = next.items.findIndex(item => precedes(kept, item));
                next.items.splice(index < 0 ? next.items.length : index, 0, kept);
            }
            feedState = next;
            loaded = true;
        }
        catch (cause) {
            if (request === requests) fail(cause);
        }
    }

    /** Shows a different set of items, starting at the top of the list. */
    async function showFromTop(): Promise<void> {
        pinned = null;
        await reload();
        if (list) list.scrollTop = 0;
    }

    /** Applies a changed scope, filter or order from the first page. */
    function navigate(): void {
        clearTimeout(searchTimer);
        offset = 0;
        confirming = "";
        void showFromTop();
    }

    function choose(value: string): void {
        followed = value === followedScope;
        sourceId = followed ? "" : value;
        navigate();
    }

    function search(event: Event): void {
        event.preventDefault();
        navigate();
    }

    function searchSoon(): void {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(navigate, 300);
    }

    function page(delta: number): void {
        offset += delta;
        void showFromTop();
    }

    function refresh(id?: string): void {
        // Failures of a source are recorded on it; only a refused request is reported here.
        void api.refresh(id).then(reload, fail);
        void reload();
    }

    function openForm(target?: FeedSource): void {
        editing = target;
        formError = "";
        showForm = true;
    }

    async function saveSource(input: FeedSourceInput): Promise<void> {
        saving = true;
        formError = "";
        try {
            const id = await api.saveSource(input);
            showForm = false;
            if (!input.id) {
                keyword = "";
                read = "all";
            }
            choose(id);
        }
        catch (cause) {
            formError = failure(cause);
        }
        finally {
            saving = false;
        }
    }

    async function setStatus(id: string, action: FeedSourceAction): Promise<void> {
        confirming = "";
        try {
            await api.setSourceStatus(id, action);
            await reload();
            if (action === "resume") refresh(id);
        }
        catch (cause) {
            fail(cause);
        }
    }

    async function markAll(): Promise<void> {
        confirming = "";
        try {
            await api.markAllRead(sourceId || undefined);
            if (detail && (!sourceId || detail.sourceId === sourceId)) detail.isRead = true;
            await reload();
        }
        catch (cause) {
            fail(cause);
        }
    }

    async function saveKeywords(words: string[]): Promise<void> {
        try {
            await api.setKeywords(words);
            newKeyword = "";
            await reload();
        }
        catch (cause) {
            fail(cause);
        }
    }

    function addKeyword(event: Event): void {
        event.preventDefault();
        if (newKeyword.trim()) void saveKeywords([...feedState.keywords, newKeyword]);
    }

    function show(html: string, base: string | null) {
        return (element: HTMLElement): void => element.replaceChildren(sanitizeContent(html, base));
    }

    function savePosition(): void {
        clearTimeout(positionTimer);
        if (!moved || !detail || !reader) return;
        moved = false;
        const range = reader.scrollHeight - reader.clientHeight;
        void api.setPosition(detail.id, range > 0 ? Math.min(1, Math.max(0, reader.scrollTop / range)) : 0).catch(() => {});
    }

    function scrolled(): void {
        if (restoring || !detail) return;
        moved = true;
        clearTimeout(positionTimer);
        positionTimer = setTimeout(savePosition, 500);
    }

    async function open(item: Pick<FeedItem, "id">): Promise<void> {
        savePosition();
        const request = ++opening;
        try {
            const next = await api.getItem(item.id);
            if (request !== opening) return;
            detail = next;
            pinned = feedState.items.find(entry => entry.id === next.id) ?? null;
            await tick();
            if (reader) {
                // Continue from where this item was left.
                restoring = true;
                reader.scrollTop = (next.readingPosition?.progress ?? 0) * Math.max(0, reader.scrollHeight - reader.clientHeight);
                requestAnimationFrame(() => restoring = false);
            }
            if (!next.isRead) {
                await api.setRead(next.id, true);
                if (detail?.id === next.id) detail.isRead = true;
                await reload();
            }
        }
        catch (cause) {
            if (request === opening) fail(cause);
        }
    }

    function close(): void {
        savePosition();
        opening++;
        detail = null;
        pinned = null;
    }

    async function toggleRead(): Promise<void> {
        const item = detail;
        if (!item) return;
        try {
            await api.setRead(item.id, !item.isRead);
            item.isRead = !item.isRead;
            await reload();
        }
        catch (cause) {
            fail(cause);
        }
    }

    async function importItem(replace: boolean): Promise<void> {
        const item = detail;
        if (!item || importing) return;
        importing = true;
        try {
            item.paperId = await api.importItem(item.id, replace);
            item.paperState = "saved";
            await reload();
        }
        catch (cause) {
            fail(cause);
        }
        finally {
            importing = false;
        }
    }

    async function fetchPDF(id: string): Promise<void> {
        if (detail?.id === id) detail.pdfStatus = "downloading";
        try {
            await api.fetchPDF(id);
            await reload();
        }
        catch (cause) {
            fail(cause);
            await reload();
        }
    }

    function openOriginal(id: string): void {
        void api.openItem(id).catch(fail);
    }

    function resize(step: number): void {
        const size = sizes[sizes.indexOf(appearance.readingSize) + step];
        if (!size) return;
        appearance.readingSize = size;
        void saveAppearance();
    }

    $effect(() => {
        if (sourcePageId) return;
        const item = feedNavigation.item;
        if (!item) return;
        untrack(() => {
            feedNavigation.item = null;
            sourceId = "";
            followed = false;
            keyword = "";
            read = "all";
            offset = 0;
            pinned = null;
            void reload().then(() => open(item));
        });
    });

    $effect(() => {
        const id = sourcePageId;
        if (id) untrack(() => {
            sourceId = id; offset = 0; void reload();
        });
    });
    onMount(() => {
        void reload();
        // Background refreshes and other views report changes; bursts are read once.
        const release = api.onChanged(() => {
            clearTimeout(reloadTimer);
            reloadTimer = setTimeout(reload, 120);
        });
        const releaseKnowledge = window.api?.knowledge?.onChanged(change => {
            if (!(detail?.paperId && change.pages.includes(detail.paperId)) && !Object.values(change.kinds ?? {}).includes("feed") && !change.pages.includes(sourcePageId ?? "")) return;
            clearTimeout(reloadTimer);
            reloadTimer = setTimeout(reload, 120);
        });
        return () => {
            release(); releaseKnowledge?.();
            savePosition();
            clearTimeout(reloadTimer);
            clearTimeout(searchTimer);
        };
    });
</script>