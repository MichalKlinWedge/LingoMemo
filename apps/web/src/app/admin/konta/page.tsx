import { permanentRedirect } from "next/navigation";

/**
 * „Konta" zostały wciągnięte do „Uczniowie i konta" — obie listy wymieniały te same osoby.
 *
 * Sam adres zostaje jako przekierowanie, bo w panelu mógł być otwarty w zakładce albo
 * w zapisanych stronach; 404 w tym miejscu wyglądałby jak zepsuty panel. Formularz hasła
 * i akcje serwerowe nadal mieszkają w tym katalogu — używa ich strona uczniów.
 */
export default function AccountsPage() {
  permanentRedirect("/admin/uczniowie");
}
