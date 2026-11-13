export const languages = ["zh-CN", "en"] as const;
export type Language = typeof languages[number];

export function isLanguage(value: unknown): value is Language {
    return languages.includes(value as Language);
}