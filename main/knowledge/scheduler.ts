import * as feed from "../feed/service";
import * as workspace from "../workspace-state";
import * as data from "./records";
import * as timers from "./timers";
let interval: ReturnType<typeof setInterval> | undefined;
export async function check(): Promise<void> {
    const session = workspace.requireWorkspace();
    for (const id of await timers.check()) {
        if (!workspace.isCurrent(session)) return;
        try {
            await feed.refresh(id);
        }
        catch (error) {
            if (workspace.isCurrent(session)) console.error("Feed timer dispatch failed", error);
        }
    }
}
export function start(): void {
    const dispatch = (): void => {
        void check().catch(error => console.error("Timer dispatch failed", error));
    };
    interval = setInterval(dispatch, 15000);
    interval.unref();
    if (data.statement("SELECT 1 FROM timers WHERE due_at IS NOT NULL LIMIT 1").get()) dispatch();
}
export function stop(): void {
    clearInterval(interval); interval = undefined;
}