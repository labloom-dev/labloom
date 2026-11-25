import { app, protocol } from "electron";
import { attachmentScheme } from "../../shared/content/media";
import { readAttachment } from "./read";

export function registerAttachmentProtocol(): void {
    protocol.registerSchemesAsPrivileged([{ scheme: attachmentScheme, privileges: { standard: true, secure: true, stream: true } }]);
    void app.whenReady().then(() => protocol.handle(attachmentScheme, readAttachment));
}