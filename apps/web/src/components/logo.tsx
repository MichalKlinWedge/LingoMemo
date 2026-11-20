/**
 * Sowa z ikony aplikacji, użyta jako element strony.
 *
 * Ten sam plik, który trafia do zakładki przeglądarki i na pulpit — żeby dziecko widziało
 * wszędzie ten sam znak. Rysunek jest ozdobą obok nazwy „Lingo Memo", więc dla czytnika
 * ekranu jest niewidoczny; nazwa i tak stoi obok jako tekst.
 */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    // Zwykły <img>, nie next/image: statyczny plik z `public`, półtora kilobajta — tak samo
    // jak flagi w `flag.tsx`.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/ikony/ikona.svg"
      alt=""
      aria-hidden
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  );
}
