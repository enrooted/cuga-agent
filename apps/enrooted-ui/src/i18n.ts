/*
 * Languages (English and Swedish), set up as in the enrooted Context UI:
 * the choice is stored per browser and falls back to the browser language.
 * One namespace per area of the app; `common` is the default.
 */
import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import enChat from "@/locales/en/chat.json"
import enCommon from "@/locales/en/common.json"
import enKnowledge from "@/locales/en/knowledge.json"
import enManage from "@/locales/en/manage.json"
import enMemory from "@/locales/en/memory.json"
import enPolicies from "@/locales/en/policies.json"
import enStudio from "@/locales/en/studio.json"
import enTools from "@/locales/en/tools.json"
import svChat from "@/locales/sv/chat.json"
import svCommon from "@/locales/sv/common.json"
import svKnowledge from "@/locales/sv/knowledge.json"
import svManage from "@/locales/sv/manage.json"
import svMemory from "@/locales/sv/memory.json"
import svPolicies from "@/locales/sv/policies.json"
import svStudio from "@/locales/sv/studio.json"
import svTools from "@/locales/sv/tools.json"

export const LANGUAGES = ["en", "sv"] as const
export type Language = (typeof LANGUAGES)[number]
const STORAGE_KEY = "enrooted-cuga-language"

export const resources = {
  en: {
    common: enCommon,
    chat: enChat,
    manage: enManage,
    tools: enTools,
    policies: enPolicies,
    knowledge: enKnowledge,
    memory: enMemory,
    studio: enStudio,
  },
  sv: {
    common: svCommon,
    chat: svChat,
    manage: svManage,
    tools: svTools,
    policies: svPolicies,
    knowledge: svKnowledge,
    memory: svMemory,
    studio: svStudio,
  },
} as const

function storedLanguage(): Language {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === "en" || value === "sv") return value
  } catch {
    // Storage blocked: fall back to the browser language.
  }
  return navigator.language?.toLowerCase().startsWith("sv") ? "sv" : "en"
}

export function setLanguage(language: Language): void {
  void i18n.changeLanguage(language)
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // Not persisted; the choice still applies to this session.
  }
}

void i18n.use(initReactI18next).init({
  resources,
  lng: storedLanguage(),
  fallbackLng: "en",
  defaultNS: "common",
  ns: Object.keys(resources.en),
  interpolation: { escapeValue: false },
  returnNull: false,
})

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng
})
document.documentElement.lang = i18n.language

export default i18n
