import type { FeedSource } from "../../../shared/types/feed";
import { displayMilliseconds } from "../layout/preferences.svelte";

/** Times follow the application's time-zone preference. */
export function formatDate(time: number | null): string {
    return time !== null ? displayMilliseconds(time) : "未提供时间";
}

export function intervalLabel(minutes: number): string {
    return minutes % 60 === 0 ? `${minutes / 60} 小时` : `${minutes} 分钟`;
}

/** The fetch status of a source: last success, the outcome of the latest attempt, and the schedule. */
export function sourceStatus(source: FeedSource): string {
    if (source.status === "cancelled") return "已取消订阅，不再获取更新；已保存的内容仍然保留。";
    const last = source.lastRefreshed !== null ? `上次成功刷新：${formatDate(source.lastRefreshed)}` : "尚未成功刷新";
    const latest = source.lastChecked === null ? "" : source.error ? "，最近一次获取失败" : `，新增 ${source.lastAdded} 条`;
    if (source.status === "paused") return `已暂停获取。${last}${latest}。`;
    return `${last}${latest}。${source.autoRefresh ? `每 ${intervalLabel(source.intervalMinutes)}自动刷新。` : "自动刷新已关闭。"}`;
}