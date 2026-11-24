import { createHash, randomUUID, type Hash } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import ts from "typescript";
import typiaPackage from "typia/package.json" with { type: "json" };
import { transform } from "typia/lib/transform";
import { normalizePath, type Plugin } from "vite";

const ipcFile = /[/\\]main[/\\][^/\\]+[/\\]ipc\.ts$/;
const cacheVersion = ["ipc-validators-v1", ts.version, typiaPackage.version].join(":");
const queries = ["readFile", "fileExists", "directoryExists", "getDirectories", "readDirectory", "realpath"] as const;
type Query = typeof queries[number];
type ModuleKey = { source: string; key: string; watch: string[] };
type Snapshot = { version: string; reads: [string, string][]; modules: Record<string, ModuleKey> };
type Output = { code: string; map: { version: 3; sources: string[]; names: string[]; mappings: string } };
type Compilation = {
    builder: ts.SemanticDiagnosticsBuilderProgram; program: ts.Program;
    versions: Map<string, string>; common: Hash; watch: Set<string>;
};

function hash(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

// Recheck the compiler's actual inputs on the next launch, including unsuccessful module lookups.
// A newly added declaration can change resolution even when every previously read file is identical.
function fingerprint(value: unknown): string {
    return typeof value === "string" ? hash(value) : JSON.stringify(value) ?? "undefined";
}

function compilerSystem(reads: Map<string, string>): ts.System {
    const system = { ...ts.sys };
    for (const name of queries) {
        const query = ts.sys[name];
        if (query) Object.assign(system, { [name](...args: unknown[]) {
            const value: unknown = Reflect.apply(query, ts.sys, args);
            const call = JSON.stringify([name, ...args]), signature = fingerprint(value);
            const previous = reads.get(call);
            reads.set(call, previous === undefined || previous === signature ? signature : "changed during compilation");
            return value;
        } });
    }
    return system;
}

function previousBuild(path: string): Snapshot | undefined {
    const text = ts.sys.readFile(path);
    if (!text) return;
    try {
        const previous: Snapshot = JSON.parse(text);
        if (previous.version === cacheVersion && previous.modules && previous.reads.every(([call, expected]) => {
            const [name, ...args]: [Query, ...unknown[]] = JSON.parse(call);
            const query = queries.includes(name) && ts.sys[name];
            return query && fingerprint(Reflect.apply(query, ts.sys, args.map(arg => arg ?? undefined))) === expected;
        })) return previous;
    }
    catch { /* Rebuild if the snapshot is incomplete. */ }
    return undefined;
}

function compilation(root: string, inputs: Map<string, string>, system: ts.System): Compilation {
    const config = join(root, "configs/tsconfig.node.json");
    const lockfile = join(root, "pnpm-lock.yaml");
    const manifest = join(root, "package.json");
    const watch = new Set([lockfile, manifest]);
    const parsed = ts.getParsedCommandLineOfConfigFile(config, {
        composite: false, declaration: false, emitDeclarationOnly: false, noEmit: false,
        sourceMap: true, inlineSources: true
    }, { ...system, onUnRecoverableConfigFileDiagnostic: fail, readFile(path) {
        watch.add(path);
        return system.readFile(path);
    } });
    if (!parsed) throw new Error("Could not read " + config);
    parsed.errors.forEach(fail);

    const entries = parsed.fileNames.filter(path => ipcFile.test(path) || path.endsWith(".d.ts"));
    const host = ts.createIncrementalCompilerHost(parsed.options, {
        ...system, readFile(path) {
            const source = system.readFile(path);
            return inputs.get(normalizePath(path)) ?? source;
        }
    });
    const builder = ts.createSemanticDiagnosticsBuilderProgram([...new Set([...entries, ...inputs.keys()])], parsed.options, host);
    const program = builder.getProgram();
    const versions = new Map<string, string>();
    const common = createHash("sha256").update(cacheVersion).update(JSON.stringify(parsed.options))
        .update(system.readFile(lockfile) ?? "").update(system.readFile(manifest) ?? "");
    for (const file of program.getSourceFiles()) {
        const version = hash(file.text);
        versions.set(file.fileName, version);
        // Ambient declarations and module augmentations can change a type without an import edge.
        if (file.isDeclarationFile || !ts.isExternalModule(file) || file.statements.some(ts.isModuleDeclaration)) {
            common.update(JSON.stringify([file.fileName, version]));
            if (!file.fileName.includes("/node_modules/")) watch.add(file.fileName);
        }
    }
    return { builder, program, versions, common, watch };
}

function fail(diagnostic: Pick<ts.Diagnostic, "messageText">): never {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

function emit(project: Compilation, file: ts.SourceFile): Output {
    let code: string | undefined, map: Output["map"] | undefined;
    const result = project.program.emit(file, (path, text) => {
        if (path.endsWith(".js.map")) {
            map = JSON.parse(text) as Output["map"];
            map.sources = [file.fileName];
        }
        if (path.endsWith(".js")) code = text.replace(/\/\/# sourceMappingURL=.*\s*$/, "");
    }, undefined, false, { before: [transform(project.program, {}, { addDiagnostic: fail })] });
    result.diagnostics.forEach(fail);
    if (code === undefined || !map) throw new Error("Missing IPC validator output for " + file.fileName);
    return { code, map };
}

function cached(path: string, key: string): Output | undefined {
    const text = ts.sys.readFile(path);
    if (!text) return;
    try {
        const entry = JSON.parse(text);
        if (entry?.key === key && typeof entry.code === "string" && entry.map?.version === 3 &&
            typeof entry.map.mappings === "string" && Array.isArray(entry.map.sources) && Array.isArray(entry.map.names)) {
            return { code: entry.code, map: entry.map };
        }
    }
    catch { /* Regenerate an incomplete cache entry. */ }
    return undefined;
}

export function ipcValidators(): Plugin {
    let root: string, directory: string, project: Compilation | undefined;
    let previous: Snapshot | undefined, modules: Record<string, ModuleKey>;
    let warn: (message: string) => void, canWrite = true;
    const inputs = new Map<string, string>();
    const reads = new Map<string, string>();
    function save(path: string, value: unknown): void {
        if (!canWrite) return;
        const temporary = path + "." + randomUUID();
        try {
            mkdirSync(directory, { recursive: true });
            writeFileSync(temporary, JSON.stringify(value));
            renameSync(temporary, path);
        }
        catch (error) {
            canWrite = false;
            warn(`Could not save the IPC validator cache: ${error}`);
            try {
                rmSync(temporary, { force: true });
            }
            catch { /* The cache directory may be read-only. */ }
        }
    }
    return {
        name: "labloom-ipc-validators",
        enforce: "pre",
        configResolved(config) {
            root = config.root;
            directory = resolve(config.cacheDir, "labloom-ipc");
            warn = message => config.logger.warn(message);
        },
        buildStart() {
            previous = previousBuild(join(directory, "inputs.json"));
            modules = {};
        },
        buildEnd(error) {
            if (!error && project) save(join(directory, "inputs.json"), { version: cacheVersion, reads: [...reads], modules });
            project = undefined;
            previous = undefined;
            inputs.clear();
            reads.clear();
        },
        transform: {
            filter: { id: { include: ipcFile, exclude: /[/\\]node_modules[/\\]/ }, code: /\btypia\b/ },
            handler(code, id) {
                const path = join(directory, basename(dirname(id)) + ".json");
                const source = hash(code), known = previous?.modules[id];
                if (known?.source === source && Array.isArray(known.watch)) {
                    const output = cached(path, known.key);
                    if (output) {
                        for (const dep of known.watch) this.addWatchFile(dep);
                        modules[id] = known;
                        return output;
                    }
                }
                // Normally all ten entries share one program. Honor earlier transforms of an entry too.
                if (!project || project.program.getSourceFile(id)?.text !== code) {
                    inputs.set(id, code);
                    project = compilation(root, inputs, compilerSystem(reads));
                }
                const file = project.program.getSourceFile(id);
                if (!file) throw new Error("Missing IPC source " + id);
                const key = project.common.copy();
                const watch = new Set(project.watch);
                for (const dep of project.builder.getAllDependencies(file).toSorted()) {
                    key.update(JSON.stringify([dep, project.versions.get(dep)]));
                    if (!dep.includes("/node_modules/")) watch.add(dep);
                }
                for (const dep of watch) this.addWatchFile(dep);
                const digest = key.digest("hex");
                modules[id] = { key: digest, source, watch: [...watch] };
                const hit = cached(path, digest);
                if (hit) return hit;

                const output = emit(project, file);
                save(path, { key: digest, ...output });
                return output;
            }
        }
    };
}