import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { registerIPCs } from "../../main/register";
import * as session from "../../main/session";
import type { IPCReply } from "../../shared/ipc";

type Fixture = {
    call<Value>(channel: string, ...args: unknown[]): Promise<Value>;
    invoke(channel: string, ...args: unknown[]): Promise<IPCReply<unknown>>;
    send(channel: string, ...args: unknown[]): boolean;
    contents: EventEmitter; sent: string[]; devTools: { opened: number };
};
export function fixture(t?: TestContext): Fixture {
    const frame = {}, sent: string[] = [], messages = new EventEmitter();
    const handlers = new Map<string, (event: { senderFrame: object }, ...args: unknown[]) => Promise<IPCReply<unknown>>>();
    const devTools = { opened: 0 };
    const contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false, send: (channel: string, ...args: unknown[]) => {
        sent.push(channel); contents.emit(channel, ...args);
    }, openDevTools: () => devTools.opened++, ipc: Object.assign(messages, { handle: handlers.set.bind(handlers) }) });
    registerIPCs({ webContents: contents } as unknown as BrowserWindow, () => { });
    const invoke = (channel: string, ...args: unknown[]): Promise<IPCReply<unknown>> => handlers.get(channel)!({ senderFrame: frame }, ...args);
    async function call<Value>(channel: string, ...args: unknown[]): Promise<Value> {
        const reply = await invoke(channel, ...args);
        if (!reply.ok) assert.fail(channel + ": " + JSON.stringify(reply.failure));
        return reply.value as Value;
    }
    t?.after(() => {
        contents.emit("destroyed");
        session.close();
    });
    return { invoke, call, send: (channel: string, ...args: unknown[]) => messages.emit(channel, { senderFrame: frame }, ...args), contents, sent, devTools };
}