/** Interview languages (A-10). `speech` is the BCP-47 tag used for browser speech recognition and synthesis. */
export const INTERVIEW_LANGUAGES = [
  { code: "en", label: "English", native: "English", speech: "en-IN" },
  { code: "hi", label: "Hindi", native: "हिन्दी", speech: "hi-IN" },
  { code: "ta", label: "Tamil", native: "தமிழ்", speech: "ta-IN" },
  { code: "te", label: "Telugu", native: "తెలుగు", speech: "te-IN" },
  { code: "bn", label: "Bengali", native: "বাংলা", speech: "bn-IN" },
  { code: "mr", label: "Marathi", native: "मराठी", speech: "mr-IN" },
  { code: "es", label: "Spanish", native: "Español", speech: "es-ES" },
  { code: "fr", label: "French", native: "Français", speech: "fr-FR" },
  { code: "de", label: "German", native: "Deutsch", speech: "de-DE" },
  { code: "pt", label: "Portuguese", native: "Português", speech: "pt-BR" },
  { code: "ar", label: "Arabic", native: "العربية", speech: "ar-SA" },
  { code: "ja", label: "Japanese", native: "日本語", speech: "ja-JP" },
] as const;

export type LanguageCode = (typeof INTERVIEW_LANGUAGES)[number]["code"];

export function languageInfo(code: string | null | undefined) {
  return INTERVIEW_LANGUAGES.find((l) => l.code === code) ?? INTERVIEW_LANGUAGES[0];
}

export function isRtl(code: string) {
  return code === "ar";
}
