"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import en from "@/locales/en.json";
import th from "@/locales/th.json";

// ข้อความหน้าเว็บทั้งหมดอยู่ใน locales/*.json — ห้ามเขียนข้อความลงใน component (scripts/check-i18n.mjs ตรวจตอน build)
const DICTS: Record<string, Record<string, unknown>> = { th, en };
export const LOCALES = [
  { code: "th", label: "ไทย" },
  { code: "en", label: "English" },
] as const;
export type Locale = (typeof LOCALES)[number]["code"];

const STORAGE_KEY = "app.lang";

function lookup(dict: Record<string, unknown>, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof cur === "string" ? cur : undefined;
}

function format(text: string, vars?: Record<string, string | number>): string {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}

type I18n = { locale: Locale; setLocale: (l: Locale) => void; t: (key: string, vars?: Record<string, string | number>) => string };
const Ctx = createContext<I18n | null>(null);

function initialLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && saved in DICTS) return saved as Locale;
  } catch {
    /* โหมดส่วนตัว/ปิด storage — ใช้ภาษาเบราว์เซอร์ */
  }
  const nav = (typeof navigator !== "undefined" ? navigator.language : "en").toLowerCase();
  return nav.startsWith("th") ? "th" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("th");
  useEffect(() => setLocaleState(initialLocale()), []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ไม่เป็นไร แค่จำภาษาไม่ได้ */
    }
  }, []);
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => format(lookup(DICTS[locale], key) ?? lookup(DICTS.en, key) ?? key, vars),
    [locale],
  );
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside I18nProvider");
  return v;
}

/** error จาก node มีรูป "[code] ข้อความ" — แปลตามรหัสถ้ามีในไฟล์ภาษา ไม่งั้นใช้ข้อความจาก server */
export function errorText(t: I18n["t"], err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const m = raw.match(/^\[(\w+)\]\s*([\s\S]*)$/);
  if (!m) return raw;
  const key = `errors.${m[1]}`;
  const translated = t(key);
  return translated === key ? m[2] : translated;
}
