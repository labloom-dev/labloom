{#if startup?.status === "ready"}
    <NavBar />
    <div class="container">
        <Sidebar workspace={startup.workspace} />
        <Main />
    </div>
    <Dialogs />
{:else}
    <Onboarding state={startup} {pending} onchoose={chooseWorkspace} onretry={retryStartup} />
{/if}


<style>
    .container {
        display: flex;
        flex-direction: row;
        flex: 1;
        min-height: 0;
    }
</style>


<script lang="ts">
    import { onMount } from "svelte";
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
    import { initializeAppearance } from "./preferences.svelte";
    import Dialogs from "../Knowledge/Dialogs.svelte";
    import { closeSession, knowledgeState, message, saveAll } from "../Knowledge/state.svelte";
    import { tabState } from "../Tab/state.svelte";
    import { tabLifecycle } from "../Tab/lifecycle";
    import { persistTabs, restoreTabs } from "../Tab/persistence.svelte";

    let startup = $state<StartupState | null>(null);
    let pending = $state(true);

    async function run(action: () => Promise<StartupState>): Promise<void> {
        pending = true;
        try {
            const next = await action();
            if (next.status === "ready" && startup?.status !== "ready") await restoreTabs();
            startup = next;
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

    function chooseWorkspace(action: WorkspaceAction): void {
        if (!pending) void run(() => window.api.startup.chooseWorkspace(action));
    }

    function retryStartup(): void {
        if (!pending) void run(() => window.api.startup.retry());
    }

    onMount(() => {
        const stopAppearance = initializeAppearance();
        tabLifecycle.close = async id => {
            try {
                return await closeSession(id);
            }
            catch (error) {
                knowledgeState.error = message(error); return false;
            }
        };
        const stopChanges = window.api.knowledge.onChanged(change => { knowledgeState.change = { ...change, seq: knowledgeState.change.seq + 1 }; });
        const stopClose = window.api.knowledge.onCloseRequested(async () => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            if (!await saveAll()) {
                knowledgeState.error = "还有页面未保存，已取消关闭。请处理页面错误后再关闭。"; return false;
            }
            try {
                await persistTabs(); return true;
            }
            catch (error) {
                knowledgeState.error = message(error); return false;
            }
        });
        void run(() => window.api.startup.getState());
        return () => {
            stopAppearance(); stopChanges(); stopClose(); tabLifecycle.close = undefined;
        };
    });
    $effect(() => {
        const snapshot = JSON.stringify(tabState);
        if (startup?.status !== "ready") return;
        const timer = setTimeout(() => {
            void window.api.knowledge.saveTabs(JSON.parse(snapshot)).catch(error => knowledgeState.error = message(error));
        }, 300);
        return () => clearTimeout(timer);
    });
</script>