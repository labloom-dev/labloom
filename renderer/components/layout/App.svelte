{#if startup?.status === "ready"}
    <NavBar />
    <div class="container">
        <Sidebar />
        <Main />
    </div>
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

    import NavBar from "./NavBar.svelte";
    import Sidebar from "./Sidebar.svelte";
    import Main from "./Main.svelte";
    import Onboarding from "../startup/Onboarding.svelte";

    let startup = $state<StartupState | null>(null);
    let pending = $state(true);

    async function run(action: () => Promise<StartupState>): Promise<void> {
        pending = true;
        try {
            startup = await action();
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
        void run(() => window.api.startup.getState());
    });
</script>