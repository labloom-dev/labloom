import { basename, join } from "node:path";
import { LabloomError } from "../../shared/failure";

export function attachmentPath(root: string, storedName: string): string {
    if (Array.from(storedName).some(char => char.charCodeAt(0) < 32) || basename(storedName) !== storedName || !/^[a-zA-Z0-9-]+(?:\.[^\\/:*?"<>|]+)?$/.test(storedName) || /[. ]$/.test(storedName)) throw new LabloomError({ kind: "attachment-invalid-name" });
    return join(root, "attachments", storedName);
}