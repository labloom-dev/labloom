export type Appearance = {
    theme: "light" | "dark" | "system";
    readingSize: 14 | 16 | 18;
    motion: boolean;
};

export const defaultAppearance: Readonly<Appearance> = {
    theme: "light",
    readingSize: 16,
    motion: true
};

export function isAppearance(value: unknown): value is Appearance {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    return ["light", "dark", "system"].includes(candidate.theme as string)
        && [14, 16, 18].includes(candidate.readingSize as number)
        && typeof candidate.motion === "boolean";
}