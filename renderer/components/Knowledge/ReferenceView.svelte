<ReferenceCard kind={target.kind} value={targetValue} {pending} onopen={openTarget} />
<script lang="ts">
    import ReferenceCard from "../Editor/ReferenceCard.svelte";
    import { t } from "../../i18n.svelte";
    import { untrack } from "svelte";
    import { type Target, type ResolvedTarget } from "../../../shared/types/content";
    import { openPage } from "../layout/navigation";
    import { type PageSession } from "./page-session.svelte";
    import { notify } from "./feedback.svelte";
    let { target, session }: { target: Target; session: PageSession } = $props();
    let targetValue = $state<ResolvedTarget | null>(null), pending = $state(true);
    function openTarget(): void {
        if (targetValue?.status === "deleted") notify(t("shell.targetDeleted"));
        else openPage(target.id);
    }
    $effect(() => {
        const current: Target = { kind: target.kind, id: target.id };
        let active = true;
        async function load(): Promise<void> {
            try {
                const value = await window.api.pages.resolve(current);
                if (active) targetValue = value ?? { title: "", text: "", status: "deleted" };
            }
            finally {
                if (active) pending = false;
            }
        }
        pending = true;
        const owner = session;
        const off = untrack(() => owner.watchObject(current.id, load, true));
        return () => {
            active = false;
            off();
        };
    });
</script>