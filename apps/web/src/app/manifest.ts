import type { MetadataRoute } from "next";

/**
 * Manifest PWA — dzięki niemu „Dodaj do ekranu głównego" na tablecie daje ikonę sowy
 * i okno bez paska adresu, a nie miniaturkę strony z napisem „lingo-memo.vercel.app".
 * Dla dziecka to różnica między aplikacją a zakładką.
 *
 * Ikona `maskable` jest osobnym plikiem, bo Android przycina ją do własnego kształtu
 * (koło, kwadrat z zaokrągleniem) i rysunek musi mieć wokół siebie zapas.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LingoMemo — nauka słówek",
    short_name: "LingoMemo",
    description: "Nauka słówek i zwrotów dla dzieci",
    lang: "pl",
    start_url: "/",
    display: "standalone",
    background_color: "#fffaf2",
    theme_color: "#7c5cff",
    icons: [
      { src: "/ikony/ikona.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/ikony/ikona-192.png", sizes: "192x192", type: "image/png" },
      { src: "/ikony/ikona-512.png", sizes: "512x512", type: "image/png" },
      { src: "/ikony/ikona-maskowalna-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
