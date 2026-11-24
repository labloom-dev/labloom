<script lang="ts">
    import { tick } from "svelte";
    import { timeToSeconds, timeTypes, type TimePrecision } from "../../../shared/content/time";
    import DatePicker from "../../components/base/DatePicker.svelte";
    import { t } from "../../i18n.svelte";

    const zone = "Asia/Singapore";
    const examples = {
        minute: { text: "2026-11-24 14:35", invalid: "2026-11-24 14:75" },
        hour: { text: "2026-11-24 14:00", invalid: "2026-11-24 14:35" },
        day: { text: "2026-11-24", invalid: "2026-02-30" },
        month: { text: "2026-11", invalid: "2026-13" },
        year: { text: "2026", invalid: "26" }
    } satisfies Record<TimePrecision, { text: string; invalid: string }>;
    const values = Object.fromEntries(timeTypes.map(precision => [precision, timeToSeconds(precision, examples[precision].text, zone)])) as Record<TimePrecision, number>;
    let empty = $state<Partial<Record<TimePrecision, number | null>>>({});
    let filled = $state<Partial<Record<TimePrecision, number | null>>>({});
    let invalid = $state<Partial<Record<TimePrecision, number | null>>>({});

    function activateExample(element: Element, text?: string): () => void {
        const trigger = element.querySelector<HTMLButtonElement>("button")!;
        async function validate(): Promise<void> {
            await tick();
            const popup = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
            const input = popup?.querySelector<HTMLInputElement>(text === undefined ? "[role=combobox]" : "input");
            if (!input || trigger.getAttribute("aria-expanded") !== "true") return;
            if (text === undefined) {
                requestAnimationFrame(() => requestAnimationFrame(() => input.focus({ preventScroll: true })));
                return;
            }
            input.value = text;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const observer = new MutationObserver(() => void validate());
        observer.observe(trigger, { attributes: true, attributeFilter: ["aria-expanded"] });
        return () => observer.disconnect();
    }
</script>

<section id="date-picker" aria-labelledby="date-picker-title">
    <h2 id="date-picker-title">{t("datePicker.examples.title")}</h2>
    <div class="table-scroll">
        <table class="state-table">
            <thead>
                <tr>
                    <th scope="col">{t("datePicker.examples.precision")}</th>
                    <th scope="col">{t("datePicker.empty")}</th>
                    <th scope="col">{t("datePicker.examples.filled")}</th>
                    <th scope="col">{t("datePicker.examples.readonly")}</th>
                    <th scope="col">{t("datePicker.examples.invalid")}</th>
                    <th scope="col">{t("datePicker.examples.clock")}</th>
                </tr>
            </thead>
            <tbody>
                {#each timeTypes as precision (precision)}
                    {@const label = t(`attributeType.${precision}`)}
                    <tr data-precision={precision}>
                        <th scope="row">{label}</th>
                        <td><DatePicker {label} {precision} {zone} value={empty[precision] ?? null} onchange={value => empty[precision] = value} /></td>
                        <td><DatePicker {label} {precision} {zone} value={filled[precision] === undefined ? values[precision] : filled[precision]} onchange={value => filled[precision] = value} /></td>
                        <td><DatePicker {label} {precision} {zone} value={values[precision]} readonly /></td>
                        <td><div {@attach element => activateExample(element, examples[precision].invalid)}>
                            <DatePicker {label} {precision} {zone} value={invalid[precision] === undefined ? values[precision] : invalid[precision]} onchange={value => invalid[precision] = value} />
                        </div></td>
                        <td>
                            {#if precision === "minute" || precision === "hour"}
                                <div {@attach activateExample}>
                                    <DatePicker {label} {precision} {zone} value={filled[precision] === undefined ? values[precision] : filled[precision]} onchange={value => filled[precision] = value} />
                                </div>
                            {/if}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
</section>