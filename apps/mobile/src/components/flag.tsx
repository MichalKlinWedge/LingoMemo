import { Image, type ImageSourcePropType, StyleSheet, Text } from 'react-native';

import { color } from '@/constants/theme';

/**
 * Flaga języka kursu.
 *
 * W bazie (`courses.icon`) stoi emoji flagi, ale nie każdy system je rysuje: na części Androidów
 * brakuje pojedynczych flag i zamiast rysunku widać napis „GB". Dlatego obrazki — te same, co na
 * webie (`apps/web/src/components/flag.tsx`), tyle że przerobione na PNG przez `npm run gen:flags`.
 *
 * Wbudowany `Image`, nie `expo-image`: `expo-image` to moduł natywny, więc flagi znikałyby
 * w każdej wersji aplikacji starszej niż on, a PNG wbudowany komponent rysuje zawsze.
 *
 * Nowy język to plik `apps/web/public/flagi/<kod>.svg`, przebieg `npm run gen:flags` i wiersz
 * w tej mapie. Bez pliku zostaje zapasowe emoji — dziura w układzie byłaby gorsza.
 */

/** Mapa, a nie `require` ze zmienną w ścieżce: Metro pakuje tylko to, co widzi wprost w kodzie. */
const PLIKI: Record<string, ImageSourcePropType> = {
  de: require('../../assets/flagi/de.png') as ImageSourcePropType,
  en: require('../../assets/flagi/en.png') as ImageSourcePropType,
  es: require('../../assets/flagi/es.png') as ImageSourcePropType,
  fr: require('../../assets/flagi/fr.png') as ImageSourcePropType,
  it: require('../../assets/flagi/it.png') as ImageSourcePropType,
  pl: require('../../assets/flagi/pl.png') as ImageSourcePropType,
};

export function Flag({
  code,
  fallback,
  size = 40,
}: {
  /** Kod języka, np. „en" albo „en-GB" — liczy się część przed myślnikiem. */
  code: string | null | undefined;
  /** Co pokazać, gdy nie ma pliku z flagą: zwykle ikona kursu. */
  fallback?: string | null;
  size?: number;
}) {
  const kod = (code ?? '').slice(0, 2).toLowerCase();
  const plik = PLIKI[kod];

  if (plik === undefined) {
    return <Text style={{ fontSize: size * 0.8 }}>{fallback ?? '📘'}</Text>;
  }

  return (
    <Image
      source={plik}
      // Proporcje flag są różne (2:1, 3:2), więc wysokość jest stała, a rysunek wpisuje się
      // w ramkę — inaczej rząd kursów miałby każdy wiersz innej wysokości.
      style={[styles.flag, { width: size, height: Math.round((size * 3) / 4) }]}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}

const styles = StyleSheet.create({
  // Delikatna ramka, żeby biel flagi nie zlewała się z tłem karty.
  flag: { borderColor: color.line, borderRadius: 4, borderWidth: 1 },
});
