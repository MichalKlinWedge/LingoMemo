import { Image as BuiltIn, type ImageStyle, type StyleProp } from 'react-native';

/**
 * Obrazek z lekcji. Rysuje go `expo-image`, bo obrazki są w SVG, a wbudowany `Image` tego
 * formatu nie zna.
 *
 * `expo-image` to moduł natywny, więc żyje w APK, a nie w kodzie wysyłanym przez OTA. Gdy kod
 * wyprzedzi aplikację (świeży OTA na starym APK albo dev build sprzed dołożenia modułu), samo
 * wczytanie `expo-image` rzuca „Cannot find native module ExpoImage" i gaśnie cały ekran lekcji.
 * Dlatego wczytujemy go ostrożnie: jest — rysuje SVG; nie ma — zostaje wbudowany `Image`,
 * czyli brak obrazka zamiast błędu. To ta sama zasada, co podział OTA/APK w ExpeditionPlan.
 */

type ExpoImageModule = typeof import('expo-image');

let ExpoImage: ExpoImageModule['Image'] | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ExpoImage = (require('expo-image') as ExpoImageModule).Image;
} catch {
  ExpoImage = null;
}

/** Czy ta wersja aplikacji umie pokazać obrazki (czyli ma w sobie `expo-image`). */
export const canShowPictures = ExpoImage !== null;

export function Picture({
  uri,
  style,
  onError,
}: {
  uri: string;
  style: StyleProp<ImageStyle>;
  onError?: () => void;
}) {
  if (ExpoImage !== null) {
    return <ExpoImage source={{ uri }} style={style} contentFit="contain" cachePolicy="disk" onError={onError} />;
  }
  return <BuiltIn source={{ uri }} style={style} resizeMode="contain" onError={onError} />;
}
