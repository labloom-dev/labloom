import { shell, type BrowserWindow } from "electron";
import typia from "typia";
import { papersChannels, type PapersAPI } from "../../shared/papers/ipc";
import { invalid, register, route, type Routes } from "../ipc";
import * as papers from "../knowledge/papers";
import { LabloomError } from "../../shared/failure";

type Args<Key extends keyof typeof papersChannels> = Parameters<PapersAPI[Key]>;

export function registerPapersIPCs(window: BrowserWindow): void {
    const routes = {
        importPrepared: route(typia.createAssert<Args<"importPrepared">>(invalid), papers.importPrepared),
        attachImported: route(typia.createAssert<Args<"attachImported">>(invalid), papers.attachImported),
        attachFile: route(typia.createAssert<Args<"attachFile">>(invalid), papers.attachFile),
        files: route(typia.createAssert<Args<"files">>(invalid), papers.files),
        openFile: route(typia.createAssert<Args<"openFile">>(invalid), async id => {
            const error = await shell.openPath(papers.externalPath(id));
            if (error) throw new LabloomError({ kind: "attachment-open-failed", diagnostic: error });
        }),
        resources: route(typia.createAssert<Args<"resources">>(invalid), papers.resources),
        annotationPaper: route(typia.createAssert<Args<"annotationPaper">>(invalid), papers.annotationPaper),
        readFile: route(typia.createAssert<Args<"readFile">>(invalid), papers.read),
        unlockPDF: route(typia.createAssert<Args<"unlockPDF">>(invalid), papers.unlockPDF),
        changeAnnotation: route(typia.createAssert<Args<"changeAnnotation">>(invalid), papers.changeAnnotation),
        position: route(typia.createAssert<Args<"position">>(invalid), papers.position),
        deleteAnnotation: route(typia.createAssert<Args<"deleteAnnotation">>(invalid), papers.deleteAnnotation),
        prepareAnnotation: route(typia.createAssert<Args<"prepareAnnotation">>(invalid), papers.prepareAnnotation),
        annotate: route(typia.createAssert<Args<"annotate">>(invalid), papers.annotate)
    } satisfies Routes<PapersAPI>;
    const contents = window.webContents;
    register(contents, papersChannels, routes);
}