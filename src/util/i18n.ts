import browser from "webextension-polyfill";

export function t(key: string, substitutions?: string | string[]): string {
  try {
    return browser.i18n.getMessage(key, substitutions);
  } catch (error) {
    console.warn(`Failed to get message for key: ${key}`, error);
    return key; // 返回键名作为后备
  }
}

export function tn(key: string, count: number): string {
  const pluralKey = `${key}_${count === 1 ? "one" : "other"}`;
  return t(pluralKey, [count.toString()]);
}

export function getCurrentLanguage(): string {
  return browser.i18n.getUILanguage();
}


export function isLanguageSupported(language: string): boolean {
  const supportedLanguages = ["en", "zh_CN"];
  return supportedLanguages.includes(language);
}
