import { LabloomError } from "../../shared/failure";
export function checkTab(id: unknown): asserts id is string {
    if (typeof id !== "string" || !id || id.length > 100) throw new LabloomError({ kind: "edit-invalid-session" });
}