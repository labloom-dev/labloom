import { createInstance, type i18n } from "i18next";
import zhCN from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { languages, type Language } from "./locale";

const resources = { "zh-CN": { translation: zhCN }, en: { translation: en } } satisfies Record<Language, { translation: typeof zhCN }>;
type Keys<T> = { [K in keyof T & string]: T[K] extends string ? K : `${K}.${Keys<T[K]>}` }[keyof T & string];
export type TranslationKey = Keys<typeof zhCN>;
export type TranslationOptions = Record<string, unknown>;
export type Translate = (key: TranslationKey, options?: TranslationOptions) => string;

export function createI18n(language: Language): i18n {
    const instance = createInstance();
    void instance.init({ resources, lng: language, fallbackLng: "zh-CN", supportedLngs: [...languages], initAsync: false,
        returnEmptyString: false, interpolation: { escapeValue: false } });
    return instance;
}