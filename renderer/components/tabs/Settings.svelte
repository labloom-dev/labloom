<section class="workspace-page">
    <header class="page-heading"><div><span class="eyebrow">MAKE YOURSELF AT HOME</span><h1>偏好设置</h1><p>让这个小小的知识花园，更合你的心意。</p></div><span class="badge">保存在本机，所有工作区通用</span></header>
    <section class="paper-card settings-card">
        <h2><Icon name="settings" size={20} />外观与阅读</h2>
        <div class="setting-row"><div><strong>暖纸主题</strong><p>奶油色纸张、柔和配色与手绘小植物。</p></div><select aria-label="主题" disabled={!appearance.loaded || appearance.saving} bind:value={appearance.theme} onchange={saveAppearance}><option value="light">暖纸浅色</option><option value="dark">夜间花园</option><option value="system">跟随系统</option></select></div>
        <div class="setting-row"><div><label for="reading-size">正文字号</label><p>应用于订阅摘要与页面编辑器。</p></div><select id="reading-size" disabled={!appearance.loaded || appearance.saving} bind:value={appearance.readingSize} onchange={saveAppearance}><option value={14}>小，14 px</option><option value={16}>标准，16 px</option><option value={18}>大，18 px</option></select></div>
        <div class="setting-row"><div><label for="motion">轻量动效</label><p>按钮悬停的轻微位移。也会遵循系统的减少动态效果设置。</p></div><input id="motion" type="checkbox" disabled={!appearance.loaded || appearance.saving} bind:checked={appearance.motion} onchange={saveAppearance} /></div>
        <div class="setting-row">
            <div><label for="time-zone">时区</label><p>用于日期时间的显示、输入、搜索和日历分组。</p></div>
            <div class="zone-picker">
                <input type="search" aria-label="筛选时区" placeholder="筛选时区" bind:value={zoneFilter} />
                <select id="time-zone" disabled={!appearance.loaded || appearance.saving} bind:value={appearance.timeZone} onchange={changeZone}>
                    <option value="system">跟随系统</option>
                    {#each zones as name (name)}<option value={name}>{name}</option>{/each}
                </select>
            </div>
        </div>
        <div class="reading-preview"><span class="eyebrow">READING PREVIEW</span><p>一个好问题，是知识开始生长的地方。</p></div>
        {#if appearance.saving}<p role="status">正在保存偏好设置…</p>{/if}
        {#if appearance.error}<div class="notice error" role="alert">{appearance.error} <button class="button" disabled={appearance.saving} onclick={() => appearance.loaded ? saveAppearance() : loadAppearance()}>重试</button></div>{/if}
    </section>
    <section class="paper-card settings-card">
        <h2><Icon name="library" size={20} />当前工作区</h2>
        {#if workspace}<div class="setting-row"><div><strong>{workspace.name}</strong><p class="path">{workspace.path}</p></div><span class="badge">本地文件夹</span></div>{:else}<p class="notice" role="status">{workspaceError || "正在读取工作区信息…"}</p>{/if}
    </section>
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
    select, .zone-picker input {
        padding: 9px 12px;
        border: 1px solid var(--c-tab-header-border);
        border-radius: 8px;
        background: var(--c-paper);
        font-size: 12px;
    }
    input[type="checkbox"] {
        width: 20px;
        height: 20px;
        accent-color: var(--c-accent);
    }
    .zone-picker { display: flex; flex-wrap: wrap; gap: 8px; }
    .zone-picker input { width: 10em; }
    .zone-picker select { width: 20em; max-width: 100%; }
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
</style>


<script lang="ts">
    import { onMount } from "svelte";
    import { type Workspace } from "../../../shared/types/startup";
    import Icon from "../utils/Icon.svelte";
    import { appearance, loadAppearance, saveAppearance } from "../layout/preferences.svelte";

    const commonZones = ["UTC", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Taipei", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Australia/Sydney"];
    const availableZones = [...new Set([...commonZones, ...Intl.supportedValuesOf("timeZone")])];
    let zoneFilter = $state("");
    const zones = $derived([...new Set([...availableZones, appearance.timeZone])].filter(name =>
        name !== "system" && (name === appearance.timeZone || name.toLowerCase().includes(zoneFilter.trim().toLowerCase()))));

    function changeZone(): void {
        zoneFilter = "";
        void saveAppearance();
    }

    let workspace = $state<Workspace | null>(null);
    let workspaceError = $state("");
    onMount(() => {
        void window.api.startup.getState().then(state => {
            if (state.status === "ready") workspace = state.workspace;
            else workspaceError = "当前工作区尚未就绪。";
        }).catch(() => {
            workspaceError = "无法读取工作区信息，请重新打开设置。";
        });
    });
</script>