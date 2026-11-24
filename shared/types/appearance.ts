import { validTimeZone } from "../content/time";
import { isLanguage, type Language } from "../locale";

export const readingSizes = [14, 15, 16, 18] as const;

export type Appearance = {
    theme: "light" | "dark" | "system";
    readingSize: typeof readingSizes[number];
    motion: boolean;
    timeZone: string;
    language: Language;
};

export const defaultAppearance: Readonly<Appearance> = {
    theme: "light",
    readingSize: 15,
    motion: true,
    timeZone: "system",
    language: "zh-CN"
};

export function isAppearance(value: unknown): value is Appearance {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    return ["light", "dark", "system"].includes(candidate.theme as string)
        && readingSizes.some(size => size === candidate.readingSize)
        && typeof candidate.motion === "boolean"
        && validTimeZone(candidate.timeZone)
        && isLanguage(candidate.language);
}