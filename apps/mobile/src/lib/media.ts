import { supabase } from '@/lib/supabase';

/**
 * Adres pliku z lekcji. W treści lekcji stoi ŚCIEŻKA w buckecie (`2026/pies.png`) — taka, jaką
 * daje do skopiowania panel „Obrazki” — bo adres publiczny zmienia się razem z projektem
 * w chmurze, a ścieżka nie. Tak samo liczy to web (`components/exercises/media.ts`).
 *
 * Gotowy adres (`https://…`) przepuszczamy bez zmian: starsze lekcje mają w payloadzie pełny link.
 */
export function mediaUrl(path: string | null | undefined): string | null {
  const value = (path ?? '').trim();
  if (value === '') return null;
  if (/^(https?:)?\/\//.test(value) || value.startsWith('data:')) return value;
  return supabase.storage.from('lesson-media').getPublicUrl(value).data.publicUrl;
}
