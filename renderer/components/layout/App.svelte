{#if startup?.status === "ready"}
    <NavBar />
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
    import { globalShortcut } from "./commands";
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
    import { initializeAppearance } from "./preferences.svelte";
    import Dialogs from "../Knowledge/Dialogs.svelte";
    import { closeSession, knowledgeState, receiveChange, saveAll } from "../Knowledge/state.svelte";
    import { tabState } from "../Tab/state.svelte";
    import { tabLifecycle } from "../Tab/lifecycle";
    import { persistTabs, restoreTabs } from "../Tab/persistence.svelte";
    import { visits } from "../Tab/activity.svelte";
    import { toFailureInfo } from "../../../shared/failure";
    import { failure } from "../../i18n.svelte";

    let startup = $state<StartupState | null>(null);
    let pending = $state(true);
    let windowFocused = $state(document.hasFocus());
    const focusedTab = $derived(tabState.groups.find(group => group.id === tabState.focusedGroupId)?.activeTabId ?? null);
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
        const keyboard = (event: KeyboardEvent): void => { if (startup?.status === "ready") globalShortcut(event); };
        window.addEventListener("keydown", keyboard);
        tabLifecycle.close = async id => {
            try {
                return await closeSession(id);
            }
            catch (error) {
                knowledgeState.error = failure(error); return false;
            }
        };
        const stopChanges = window.api.knowledge.onChanged(receiveChange);
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
        const stopClose = window.api.knowledge.onCloseRequested(async () => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            if (!await saveAll()) {
                knowledgeState.error = { kind: "workspace-close-unsaved" }; return false;
            }
            try {
                await persistTabs(); return true;
            }
            catch (error) {
                knowledgeState.error = failure(error); return false;
            }
        });
        void run(() => window.api.startup.getState());
        return () => {
            window.removeEventListener("keydown", keyboard);
            stopAppearance(); stopChanges(); stopClose(); tabLifecycle.close = undefined;
            window.removeEventListener("blur", blur);
            window.removeEventListener("focus", focus);
        };
    });
    $effect(() => {
        const snapshot = JSON.stringify(tabState);
        if (startup?.status !== "ready") return;
        const timer = setTimeout(() => {
            void window.api.knowledge.saveTabs(JSON.parse(snapshot)).catch(error => knowledgeState.error = failure(error));
        }, 300);
        return () => clearTimeout(timer);
    });
</script>