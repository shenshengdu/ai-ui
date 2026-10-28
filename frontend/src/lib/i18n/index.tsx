import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en, type MessageKey } from "./en";
import { zh } from "./zh";

/** Saved preference. "system" follows the browser language. */
export type LanguagePref = "system" | "en" | "zh";
export type Language = "en" | "zh";

const STORAGE_KEY = "ai-ui-language";
const dictionaries: Record<Language, Record<MessageKey, string>> = { en, zh };

export type TranslateVars = Record<string, string | number>;
export type TFunction = (key: MessageKey, vars?: TranslateVars) => string;

const detectBrowserLanguage = (): Language => {
  if (typeof navigator === "undefined") return "en";
  const langs = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  return langs.some((l) => l?.toLowerCase().startsWith("zh")) ? "zh" : "en";
};

const readPref = (): LanguagePref => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "en" || v === "zh" || v === "system") return v;
  } catch {
    /* storage unavailable */
  }
  return "system";
};

export const resolveLanguage = (pref: LanguagePref): Language =>
  pref === "system" ? detectBrowserLanguage() : pref;

/** Translate outside React (e.g. in a utility); prefer useI18n in components. */
export function translate(
  lang: Language,
  key: MessageKey,
  vars?: TranslateVars,
): string {
  let text = dictionaries[lang][key] ?? en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

type I18nState = {
  lang: Language;
  pref: LanguagePref;
  setPref: (pref: LanguagePref) => void;
  t: TFunction;
  /** BCP-47 tag for Intl / toLocaleString. */
  locale: string;
};

const I18nContext = createContext<I18nState>({
  lang: "en",
  pref: "system",
  setPref: () => {},
  t: (key, vars) => translate("en", key, vars),
  locale: "en-US",
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<LanguagePref>(readPref);
  const [browserLang, setBrowserLang] = useState<Language>(
    detectBrowserLanguage,
  );

  useEffect(() => {
    const onChange = () => setBrowserLang(detectBrowserLanguage());
    window.addEventListener("languagechange", onChange);
    return () => window.removeEventListener("languagechange", onChange);
  }, []);

  const lang: Language = pref === "system" ? browserLang : pref;

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const setPref = useCallback((next: LanguagePref) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    setPrefState(next);
  }, []);

  const value = useMemo<I18nState>(
    () => ({
      lang,
      pref,
      setPref,
      t: (key, vars) => translate(lang, key, vars),
      locale: lang === "zh" ? "zh-CN" : "en-US",
    }),
    [lang, pref, setPref],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

export type { MessageKey };
