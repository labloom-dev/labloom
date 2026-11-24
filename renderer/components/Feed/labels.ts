import { secondsToMinute } from "../../../shared/content/time";
import { t } from "../../i18n.svelte";
import { currentTimeZone } from "../layout/preferences.svelte";

export function formatDate(time: number | null): string {
    return time === null ? t("feed.noTime") : secondsToMinute(time / 1000, currentTimeZone());
}

export function intervalLabel(minutes: number): string {
    return minutes % 60 === 0 ? t("feed.hours", { count: minutes / 60 }) : t("feed.minutes", { count: minutes });
}