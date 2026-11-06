import { net, safeStorage, type WebContents } from "electron";
import type { AssistantRequest } from "../../shared/types/assistant";
import { assistantChannels } from "../../shared/ipc";
import { handle } from "../ipc";
import { KnowledgeService } from "../knowledge/service";
import type { Startup } from "../startup/startup";
import { AssistantService } from "./service";

export function registerAssistantIPCs(contents: WebContents, startup: Startup): void {
    let previous: ReturnType<Startup["getDatabase"]> | undefined;
    let service: AssistantService | undefined;
    function assistant(): AssistantService {
        const database = startup.getDatabase();
        if (!service || database !== previous) {
            service?.cancelAll();
            service = new AssistantService(new KnowledgeService(database), {
                encrypt(value) {
                    if (!safeStorage.isEncryptionAvailable() || (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) throw new Error("当前系统没有安全的凭据存储。可以使用无需令牌的本地 Ollama，或先配置系统密钥环。");
                    return safeStorage.encryptString(value).toString("base64");
                },
                decrypt(value) { return safeStorage.decryptString(Buffer.from(value, "base64")); }
            }, (input, init) => net.fetch(input instanceof URL ? input.href : input, init));
            previous = database;
        }
        return service;
    }
    handle(contents, assistantChannels.config, () => assistant().config());
    handle(contents, assistantChannels.configure, input => assistant().configure(input as Parameters<AssistantService["configure"]>[0]));
    handle(contents, assistantChannels.ask, input => assistant().ask(input as AssistantRequest));
    handle(contents, assistantChannels.cancel, id => assistant().cancel(id as string));
    contents.once("destroyed", () => service?.cancelAll());
}