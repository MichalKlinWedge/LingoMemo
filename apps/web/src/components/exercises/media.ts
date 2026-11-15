"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Adres pliku z lekcji. W treści lekcji stoi ŚCIEŻKA w buckecie (`2026/pies.png`) — taka, jaką
 * daje do skopiowania panel „Obrazki" — bo adres publiczny zmienia się razem z projektem
 * w chmurze, a ścieżka nie.
 *
 * Gotowy adres (`https://…`) przepuszczamy bez zmian: starsze lekcje i nagrania spoza bucketu
 * mają w payloadzie pełny link i mają dalej działać.
 */
export function mediaUrl(path: string | null | undefined): string | null {
  const value = (path ?? "").trim();
  if (value === "") return null;
  if (/^(https?:)?\/\//.test(value) || value.startsWith("data:")) return value;
  return createClient().storage.from("lesson-media").getPublicUrl(value).data.publicUrl;
}
