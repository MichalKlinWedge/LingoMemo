/**
 * Flaga języka kursu.
 *
 * Emoji flag (🇬🇧) nie da się użyć: Windows w ogóle nie rysuje flag z par liter regionalnych
 * i zamiast flagi pokazuje napis „GB". Dlatego obrazki — SVG, więc ostre w każdym rozmiarze
 * i razem ważą tyle, co jeden mały PNG.
 *
 * Nowy język to jeden plik `public/flagi/<kod>.svg` i wiersz w tabeli `languages`; w kodzie
 * nie trzeba zmieniać nic. Dopóki pliku nie ma, pokazuje się zapasowa ikona albo kod języka,
 * a nie dziura w układzie.
 */

/** Języki, dla których mamy plik z flagą. Lista jest po to, żeby nie żądać pliku, którego nie ma. */
const FLAGI = new Set(["en", "de", "es", "fr", "it", "pl"]);

export function Flag({
  code,
  fallback,
  size = 32,
  title,
}: {
  /** Kod języka, np. „en" albo „en-GB" — liczy się część przed myślnikiem. */
  code: string | null | undefined;
  /** Co pokazać, gdy nie ma pliku z flagą: zwykle ikona kursu. */
  fallback?: string | null;
  size?: number;
  title?: string;
}) {
  const kod = (code ?? "").slice(0, 2).toLowerCase();
  const box = { width: size, height: Math.round((size * 3) / 4) };

  if (!FLAGI.has(kod)) {
    return (
      <span aria-hidden style={{ fontSize: size * 0.8, lineHeight: 1 }}>
        {fallback ?? kod.toUpperCase()}
      </span>
    );
  }

  return (
    // Zwykły <img>, nie next/image: to statyczne pliki z `public`, kilkaset bajtów każdy —
    // optymalizowanie ich kosztowałoby więcej, niż oszczędza.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/flagi/${kod}.svg`}
      alt=""
      title={title}
      width={box.width}
      height={box.height}
      style={{
        width: box.width,
        height: box.height,
        objectFit: "contain",
        borderRadius: 4,
        // Delikatna ramka, żeby biel flagi nie zlewała się z tłem karty.
        boxShadow: "0 0 0 1px var(--line)",
      }}
    />
  );
}
