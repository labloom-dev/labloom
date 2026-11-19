import { type BrowserWindow } from "electron";
import typia from "typia";
import { attributesChannels, type AttributesAPI } from "../../shared/attributes/ipc";
import { invalid, register, route, type Routes } from "../ipc";
import * as attributes from "../knowledge/attributes";
import * as edits from "../knowledge/edits";

type Args<Key extends keyof typeof attributesChannels> = Parameters<AttributesAPI[Key]>;

const routes = {
    definitions: route(typia.createAssert<Args<"definitions">>(invalid), attributes.definitions),
    define: route(typia.createAssert<Args<"define">>(invalid), edits.setDefinition)
} satisfies Routes<AttributesAPI>;
export function registerAttributesIPCs(window: BrowserWindow): void {
    const contents = window.webContents;
    register(contents, attributesChannels, routes);
}