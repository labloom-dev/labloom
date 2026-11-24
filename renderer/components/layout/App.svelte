{#if startup?.status === "ready"}
    <NavBar collapsed={shell.collapsed} oncommand={runCommand} disabled={commandDisabled} onremember={prepareCommands}><GSLauncher /></NavBar>
    <div class="container">
        <Sidebar />
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
    import { copyData } from "../copy-data";
    import { commandDisabled, globalShortcut, prepareCommands, runCommand } from "./commands";
    import { shell } from "./shell.svelte";
    import { openPage } from "./navigation";
    import GSLauncher from "../globalSearch/GSLauncher.svelte";
    import { onMount, untrack } from "svelte";
    import type { StartupState, WorkspaceAction } from "../../../shared/types/startup";

    import NavBar from "./NavBar.svelte";
    import Sidebar from "./Sidebar.svelte";
    import Main from "./Main.svelte";
    import Onboarding from "../startup/Onboarding.svelte";
    import { finishPreferences, initializeAppearance } from "./preferences.svelte";
    import Dialogs from "../Knowledge/Dialogs.svelte";
    import { syncInspected, closeSession, saveAll } from "../Knowledge/page-sessions";
    import { knowledgeState } from "../Knowledge/feedback.svelte";
    import { tabState } from "../Tab/state.svelte";
    import { tabLifecycle } from "../Tab/lifecycle";
    import { persistTabs, recordOpen, restoreTabs, navigationState } from "../Tab/persistence.svelte";
    import { visits } from "../Tab/activity.svelte";
    import { toFailureInfo } from "../../../shared/failure";
    import { failure } from "../../i18n.svelte";

    let startup = $state<StartupState | null>(null);
    let reminderPage = $state<string>();
    $effect(() => {
        if (startup?.status !== "ready" || !reminderPage) return;
        const id = reminderPage;
        reminderPage = undefined;
        untrack(() => openPage(id));
    });
    let pending = $state(true);
    let windowFocused = $state(document.hasFocus());
    const focusedTab = $derived(tabState.groups.find(group => group.id === tabState.focusedGroupId)?.activeTabId ?? null);
    const activePage = $derived.by(() => {
        const group = tabState.groups.find(item => item.id === tabState.focusedGroupId);
        const view = group?.tabs.find(item => item.id === group.activeTabId)?.view;
        return view?.type === "page" ? view.params.page.id : null;
    });
    $effect(() => {
        const page = activePage;
        void focusedTab;
        if (page && startup?.status === "ready") untrack(() => recordOpen(page));
    });
    let previousTab: string | null = null;
    $effect.pre(() => {
        const id = windowFocused && startup?.status === "ready" ? focusedTab : null;
        untrack(() => {
            if (previousTab && previousTab !== id) {
                const control = document.activeElement;
                if (control instanceof HTMLElement && control.closest<HTMLElement>("[data-tabs-content]")?.dataset.value === previousTab) control.blur();
                window.dispatchEvent(new Event("workspace-flush"));
            }
            previousTab = id;
            visits.focus(id);
        });
    });

    async function run(action: () => Promise<StartupState>): Promise<void> {
        pending = true;
        try {
            const next = await action();
            if (next.status === "ready" && startup?.status !== "ready") await restoreTabs();
            startup = next;
        }
        catch (error) {
            startup = {
                status: "needs-workspace",
                lastWorkspace: startup?.status === "needs-workspace" ? startup.lastWorkspace : null,
                canChoose: false,
                error: toFailureInfo(error)
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
        const keyboard = (event: KeyboardEvent): void => {
            if (startup?.status === "ready") globalShortcut(event);
        };
        window.addEventListener("keydown", keyboard);
        tabLifecycle.close = async id => {
            try {
                return await closeSession(id);
            }
            catch (error) {
                knowledgeState.error = failure(error); return false;
            }
        };
        const stopChanges = window.api.pages.onChanged(change => {
            visits.changed(change);
            syncInspected(change.pages);
            knowledgeState.change = { ...change, seq: knowledgeState.change.seq + 1 };
        });
        const stopReminders = window.api.timers.onOpenNotice(id => reminderPage = id);
        function blur(): void {
            if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
            window.dispatchEvent(new Event("workspace-flush"));
            windowFocused = false;
            visits.focus(null);
        }
        function focus(): void {
            windowFocused = true;
            visits.focus(focusedTab);
        }
        window.addEventListener("blur", blur);
        window.addEventListener("focus", focus);
        const stopClose = window.api.app.beforeQuit(async () => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            await finishPreferences();
            if (!await saveAll()) {
                knowledgeState.error = { kind: "workspace-close-unsaved" }; return true;
            }
            try {
                await persistTabs(); return false;
            }
            catch (error) {
                knowledgeState.error = failure(error); return true;
            }
        });
        void run(() => window.api.startup.getState());
        return () => {
            window.removeEventListener("keydown", keyboard);
            stopAppearance(); stopChanges(); stopReminders(); stopClose(); tabLifecycle.close = undefined;
            window.removeEventListener("blur", blur);
            window.removeEventListener("focus", focus);
        };
    });
    $effect(() => {
        if (startup?.status !== "ready") return;
        const tabs = copyData(tabState), navigation = copyData(navigationState);
        const timer = setTimeout(() => {
            void window.api.workspace.saveTabs(tabs, navigation).catch(error => knowledgeState.error = failure(error));
        }, 300);
        return () => clearTimeout(timer);
    });
</script>