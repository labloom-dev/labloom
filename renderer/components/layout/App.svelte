<svelte:window onbeforeunload={beforeClose} onkeydown={shortcuts} />

{#if startup?.status === "ready"}
    <div class="application" inert={knowledgeState.locked}>
    <NavBar />
    <div class="container">
        <Sidebar workspace={startup.workspace} />
        <Main />
    </div>
    </div>
    {#if reminders.length}<div class="reminder-tray" role="status"><strong>有 {reminders.length} 项计划到时间了</strong>{#each reminders.slice(0, 3) as reminder}<div><button class="text-button" onclick={() => openPage({ id: reminder.pageId, title: reminder.title })}>{reminder.title}</button><button class="text-button" onclick={async () => { try { await window.api.knowledge.dismissReminder(reminder.id); reminders = reminders.filter(item => item.id !== reminder.id); } catch (error) { knowledgeState.error = String(error); } }}>知道了</button></div>{/each}</div>{/if}
    {#if knowledgeState.operation || knowledgeState.notice || knowledgeState.error}
        <div class="application-status" class:error={!!knowledgeState.error} role={knowledgeState.error ? "alert" : "status"}>
            <span>{knowledgeState.error || knowledgeState.operation || knowledgeState.notice}</span>
            {#if !knowledgeState.operation}<button aria-label="关闭提示" onclick={() => { knowledgeState.error = ""; knowledgeState.notice = ""; }}>关闭</button>{/if}
        </div>
    {/if}
{:else}
    <Onboarding state={startup} {pending} onchoose={chooseWorkspace} onretry={retryStartup} />
{/if}


<style>
    .reminder-tray { position: fixed; top: 92px; right: 24px; z-index: 90; width: min(340px, calc(100vw - 100px)); padding: 16px; border: 1.5px solid var(--c-ink); border-radius: 12px; background: var(--c-gold-light); box-shadow: var(--c-shadow); font-size: 11px; }
    .reminder-tray > div { display: flex; justify-content: space-between; gap: 14px; padding-top: 12px; }
    .reminder-tray > div button:first-child { text-align: left; }
    .application {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
    }
    .application-status {
        position: fixed;
        right: 24px;
        bottom: 24px;
        display: flex;
        align-items: center;
        gap: 20px;
        max-width: min(600px, calc(100vw - 40px));
        max-height: 45vh;
        overflow: auto;
        overflow-wrap: anywhere;
        padding: 15px 18px;
        border: 1.5px solid var(--c-ink);
        border-radius: 12px;
        background: var(--c-gold-light);
        box-shadow: var(--c-shadow);
        z-index: 100;
        font-size: 12px;
        line-height: 1.7;
        white-space: pre-wrap;
    }
    .application-status.error { background: var(--c-peach); }
    .application-status button { flex-shrink: 0; text-decoration: underline; }
    .container {
        display: flex;
        flex-direction: row;
        flex: 1;
        min-height: 0;
    }
</style>


<script lang="ts">
    import { hasPendingChanges, knowledgeState, saveAll } from "../Knowledge/state.svelte";
    import { loadAppearance } from "./preferences.svelte";
    import { openPage } from "./navigation";
    import type { Reminder } from "../../../shared/types/knowledge";
    import { tabState } from "../Tab/state.svelte";
    import { restoreTabs } from "../Tab/persistence";
    import { recordVisit } from "./history.svelte";
    import { onMount, untrack } from "svelte";
    import type { StartupState, WorkspaceAction } from "../../../shared/types/startup";
    import "../../styles/colors.css";
    import "../../styles/layouts.css";
    import "../../styles/base.css";
    import "../../styles/elements.css";
    import "../../styles/workspace.css";

    import NavBar from "./NavBar.svelte";
    import Sidebar from "./Sidebar.svelte";
    import Main from "./Main.svelte";
    import Onboarding from "../startup/Onboarding.svelte";
    import { logUpgradeFailure } from "../startup/log-upgrade-failure";

    let startup = $state<StartupState | null>(null);
    let pending = $state(true);
    let reminders = $state<Reminder[]>([]);

    async function run(action: () => Promise<StartupState>): Promise<void> {
        pending = true;
        try {
            const result = await action();
            if (result.status === "ready") {
                await loadAppearance();
                try { await restoreTabs(); } catch { knowledgeState.error = "未能恢复上次的标签页。页面内容仍在知识库中。"; }
            }
            startup = result;
            logUpgradeFailure(startup);
        }
        catch (error) {
            startup = {
                status: "needs-workspace",
                lastWorkspace: startup?.status === "needs-workspace" ? startup.lastWorkspace : null,
                canChoose: false,
                error: error instanceof Error ? error.message : "无法连接应用，请重试。"
            };
        }
        finally {
            pending = false;
        }
    }

    $effect(() => {
        if (startup?.status !== "ready") return;
        knowledgeState.version;
        let active = true;
        const update = async (): Promise<void> => { try { const result = await window.api.knowledge.stats(); if (active) reminders = result.notifications; } catch { /* A reminder read must not interrupt editing. */ } };
        const timer = setInterval(() => { void update(); }, 30000);
        void update();
        return () => { active = false; clearInterval(timer); };
    });
    $effect(() => {
        if (startup?.status !== "ready") return;
        const state = $state.snapshot(tabState);
        const group = state.groups.find(group => group.id === state.focusedGroupId);
        const tab = group?.tabs.find(tab => tab.id === group.activeTabId);
        if (tab) untrack(() => recordVisit(tab));
        const timer = setTimeout(() => { void window.api.knowledge.setSetting("tabs", state).catch(() => { knowledgeState.error = "标签页布局未能保存，请检查工作区。"; }); }, 200);
        return () => clearTimeout(timer);
    });

    function chooseWorkspace(action: WorkspaceAction): void {
        if (!pending) void run(() => window.api.startup.chooseWorkspace(action));
    }

    function retryStartup(): void {
        if (!pending) void run(() => window.api.startup.retry());
    }

    function shortcuts(event: KeyboardEvent): void {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
        if (event.key.toLowerCase() === "s") { event.preventDefault(); void saveAll(); }
    }

    function beforeClose(event: BeforeUnloadEvent): void {
        if (hasPendingChanges()) {
            event.preventDefault();
            event.returnValue = "";
        }
    }

    onMount(() => {
        void run(() => window.api.startup.getState());
    });
</script>