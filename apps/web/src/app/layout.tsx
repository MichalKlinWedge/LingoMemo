import type { Metadata, Viewport } from "next";
import { Baloo_2, Nunito } from "next/font/google";
import { Suspense } from "react";

import { TopBar } from "@/components/top-bar";

import "./globals.css";

// `latin-ext` — polskie znaki (ą, ę, ł…) z tej samej czcionki, a nie z zastępczej.
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin", "latin-ext"],
});

// Nagłówki i przyciski: czcionka zaokrąglona, czytelna dla dziecka.
const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin", "latin-ext"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: "LingoMemo",
  description: "Nauka słówek i zwrotów dla dzieci",
  applicationName: "LingoMemo",
  // Ikony wskazane wprost, a nie przez pliki `icon.*` w katalogu `app`: wszystkie warianty
  // leżą razem w `public/ikony` i powstają z jednego wzorca (`node scripts/icons.mjs`).
  icons: {
    // SVG dla przeglądarek, `favicon.ico` dla tych narzędzi, które pytają wprost o ten adres.
    icon: [
      { url: "/ikony/ikona.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "48x48" },
    ],
    apple: { url: "/ikony/ikona-apple-180.png", sizes: "180x180" },
  },
  appleWebApp: { capable: true, title: "LingoMemo", statusBarStyle: "default" },
};

/** Kolor paska przeglądarki na telefonie: fiolet marki, a w ciemnym motywie tło aplikacji. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#7c5cff" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1714" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pl" className={`${nunito.variable} ${baloo.variable} h-full antialiased`}>
      {/* Rozszerzenia przeglądarki dopisują atrybuty do <body> przed hydratacją. */}
      <body className="flex min-h-full flex-col" suppressHydrationWarning>
        {/* Pasek czyta sesję i bazę, więc ma własne `<Suspense>` — inaczej blokowałby
            prerender każdej strony. */}
        <Suspense>
          <TopBar />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
