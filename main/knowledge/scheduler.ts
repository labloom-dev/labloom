import * as feed from "../feed/service";
import * as data from "./records";
let interval: ReturnType<typeof setInterval> | undefined;
export function start(): void {
    const check = (): void => {
        void feed.refreshDue().catch(error => console.error("Timer dispatch failed", error));
    };
    interval = setInterval(check, 15000);
    interval.unref();
    if (data.statement("SELECT 1 FROM timers WHERE due_at IS NOT NULL LIMIT 1").get()) check();
}
export function stop(): void {
    clearInterval(interval);
    interval = undefined;
}