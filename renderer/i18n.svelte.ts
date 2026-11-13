import { createI18n, type Translate } from "../shared/i18n";
import { failureText, toFailureInfo, type FailureInfo } from "../shared/failure";
import { type Language } from "../shared/locale";

const instance = createI18n("zh-CN");
let language = $state<Language>("zh-CN");
export function setLocale(value: Language): void {
    language = value;
    document.documentElement.lang = value;
}
export const t: Translate = (key, options) => instance.t(key, { ...options, lng: language });
export type ErrorValue = FailureInfo | "";
export const failure = toFailureInfo;
export const message = (error: unknown): string => error === "" || error == null ? "" : failureText(t, toFailureInfo(error));