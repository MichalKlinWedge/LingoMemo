import type { Metadata } from "next";
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
