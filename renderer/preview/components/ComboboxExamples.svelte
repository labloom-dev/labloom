<script lang="ts">
    import Combobox from "../../components/base/Combobox.svelte";
    import { t } from "../../i18n.svelte";

    const few = ["A", "B", "C"].map(value => ({ value, label: value }));
    const many = $derived(Array.from({ length: 500 }, (_, index) => ({
        value: String(index + 1), label: t("combobox.sampleOption", { number: index + 1 })
    })));
</script>

<section id="combobox">
    <h2>{t("combobox.title")}</h2>
    <div class="examples">
        <Combobox label={t("combobox.sampleFew")} placeholder={t("combobox.sampleFew")} options={few} />
        <Combobox label={t("combobox.sampleMany")} placeholder={t("combobox.sampleMany")} options={many} />
        <Combobox label={t("combobox.sampleEmpty")} placeholder={t("combobox.sampleEmpty")} options={[]} />
        <Combobox label={t("combobox.sampleDisabled")} placeholder={t("combobox.sampleDisabled")} options={few} disabled />
    </div>
</section>