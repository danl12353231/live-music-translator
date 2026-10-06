import { franc } from "franc-min";

const iso3ToBCP47 = {
  eng: "en", ita: "it", spa: "es", fra: "fr", deu: "de", por: "pt",
  nld: "nl", pol: "pl", rus: "ru", ukr: "uk", jpn: "ja", kor: "ko",
  cmn: "zh", arb: "ar", hin: "hi", tur: "tr", swe: "sv", dan: "da",
  nor: "no", fin: "fi", ces: "cs", ell: "el", heb: "he", ron: "ro",
  hun: "hu", ind: "id", vie: "vi", tha: "th"
};

export function detectLanguage(text) {
  const sample = text.replace(/[^\p{L}\p{M}' ]/gu, " ").replace(/\s+/g, " ").trim();
  if (sample.length < 20) return "und";
  return iso3ToBCP47[franc(sample)] ?? "und";
}
