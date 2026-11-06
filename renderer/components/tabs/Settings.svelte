<section class="workspace-page">
    <header class="page-heading"><div><span class="eyebrow">MAKE YOURSELF AT HOME</span><h1>偏好设置</h1><p>让这个小小的知识花园，更合你的心意。</p></div><span class="badge">保存在本机</span></header>
    <section class="paper-card settings-card">
        <h2><Icon name="settings" size={20} />外观与阅读</h2>
        <div class="setting-row"><div><strong>暖纸主题</strong><p>奶油色纸张、柔和配色与手绘小植物。</p></div><select aria-label="主题" bind:value={appearance.theme} onchange={saveAppearance}><option value="light">暖纸浅色</option><option value="dark">夜间花园</option><option value="system">跟随系统</option></select></div>
        <div class="setting-row"><div><label for="reading-size">正文字号</label><p>应用于订阅摘要与页面编辑器。</p></div><select id="reading-size" bind:value={appearance.readingSize} onchange={saveAppearance}><option value={14}>小，14 px</option><option value={16}>标准，16 px</option><option value={18}>大，18 px</option></select></div>
        <div class="setting-row"><div><label for="motion">轻量动效</label><p>按钮悬停的轻微位移。也会遵循系统的减少动态效果设置。</p></div><input id="motion" type="checkbox" bind:checked={appearance.motion} onchange={saveAppearance} /></div>
        <div class="reading-preview"><span class="eyebrow">READING PREVIEW</span><p>一个好问题，是知识开始生长的地方。</p></div>
        {#if appearance.error}<p class="notice error" role="alert">{appearance.error}</p>{/if}
    </section>
    <section class="paper-card settings-card">
        <h2><Icon name="library" size={20} />当前工作区</h2>
        {#if workspace}<div class="setting-row"><div><strong>{workspace.name}</strong><p class="path">{workspace.path}</p></div><span class="badge">本地文件夹</span></div>{:else}<p class="notice" role="status">{workspaceError || "正在读取工作区信息…"}</p>{/if}
        <div class="setting-row"><div><strong>完整工作区备份</strong><p>包含页面、订阅、PDF、标注与偏好设置。当前占用 {bytes === null ? "正在计算…" : `${(bytes / 1024 / 1024).toFixed(1)} MB`}。</p></div><button class="button" onclick={backup}>导出备份</button></div>
        <div class="setting-row"><div><strong>从备份恢复</strong><p>校验备份后恢复到新的空文件夹，并打开恢复后的工作区。</p></div><button class="button" onclick={restore}>恢复备份</button></div>
        <div class="setting-row"><div><strong>最近访问记录</strong><p>清除记录后，页面内容仍保留。</p></div><button class="button" onclick={() => { if (confirm("清空最近访问记录？")) void perform("正在清理记录", () => window.api.knowledge.clearHistory()); }}>清空记录</button></div>
        <p class="footnote">备份会先保存正在编辑的页面。恢复失败时当前工作区保持可用。</p>
    </section>
    <section class="paper-card settings-card"><h2><Icon name="search" size={20} />常用快捷键</h2><div class="shortcut-row"><span>打开全局搜索</span><span><kbd>Ctrl / ⌘</kbd> <kbd>K</kbd></span></div><div class="shortcut-row"><span>关闭弹出窗口</span><kbd>Esc</kbd></div><div class="shortcut-row"><span>撤销 / 重做编辑</span><span><kbd>Ctrl / ⌘</kbd> <kbd>Z / Shift Z</kbd></span></div></section>
</section>


<style>
    .settings-card {
        padding: 24px;
        margin-bottom: 25px;
    }
    h2 {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 0 10px;
        font-size: 16px;
    }
    .setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 20px;
        padding: 22px 0;
        border-bottom: 1px dashed var(--c-line);
    }
    .setting-row > div:first-child {
        min-width: 0;
        flex: 1;
    }
    strong, label {
        font-size: 13px;
        font-weight: 800;
    }
    p {
        margin: 7px 0 0;
        color: var(--c-muted);
        font-size: 12px;
        line-height: 1.7;
    }
    select {
        padding: 9px 12px;
        border: 1px solid var(--c-tab-header-border);
        border-radius: 8px;
        background: var(--c-paper);
        font-size: 12px;
    }
    input {
        width: 20px;
        height: 20px;
        accent-color: var(--c-accent);
    }
    .reading-preview {
        padding: 22px;
        margin-top: 20px;
        border: 1px solid var(--c-line);
        border-radius: 10px;
        background: var(--c-cream);
    }
    .reading-preview p {
        color: var(--c-ink);
        font-size: var(--reading-font-size, 16px);
    }
    .path {
        overflow-wrap: anywhere;
        user-select: text;
    }
    .footnote {
        margin-top: 15px;
        font-size: 11px;
    }
    .shortcut-row {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 13px 0;
        font-size: 12px;
    }
</style>


<script lang="ts">
    import { onMount } from "svelte";
    import type { Workspace } from "../../../shared/types/startup";
    import Icon from "../utils/Icon.svelte";
    import { knowledgeState, perform, saveAll } from "../Knowledge/state.svelte";
    import { appearance, saveAppearance } from "../layout/preferences.svelte";

    let workspace = $state<Workspace | null>(null);
    let workspaceError = $state("");
    let bytes = $state<number | null>(null);
    async function backup(): Promise<void> { await perform("正在保存并备份工作区", async () => { if (!await saveAll()) throw new Error("有页面尚未保存，请先解决保存错误。"); const path = await window.api.knowledge.backup(); if (path) knowledgeState.notice = `备份已完成：${path}`; }, true); }
    async function restore(): Promise<void> { await perform("正在校验并恢复工作区", async () => { if (!await saveAll()) throw new Error("有页面尚未保存，请先解决保存错误。"); const path = await window.api.knowledge.restoreBackup(); if (path) location.reload(); }, true); }
    onMount(() => {
        void window.api.knowledge.stats().then(stats => { bytes = stats.bytes; }).catch(() => { workspaceError = "无法读取空间占用。"; });
        void window.api.startup.getState().then(state => {
            if (state.status === "ready") workspace = state.workspace;
            else workspaceError = "当前工作区尚未就绪。";
        }).catch(() => { workspaceError = "无法读取工作区信息，请重新打开设置。"; });
    });
</script>