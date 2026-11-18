import Link from "next/link";

import { DAYS, plural, POINTS, UNLOCKS, WORDS } from "@lingomemo/core";

import { signOut } from "@/app/auth-actions";
import { Logo } from "@/components/logo";
import { getUser } from "@/lib/auth";

/**
 * Znacznik stanu w pasku: ikona i liczba, nic więcej. Słowa („punktów", „do powtórki") siedzą
 * w dymku i w etykiecie dla czytnika ekranu.
 *
 * Cztery znaczniki z pełnym opisem nie mieściły się w jednym wierszu i zawijały się na drugi,
 * spychając treść strony w dół — a dziecko i tak czyta z nich liczbę, nie zdanie. Ikona mówi,
 * czego liczba dotyczy; po słowa sięga dorosły, i wtedy wystarczy mu kursor.
 */
function Stat({ href, icon, value, label }: { href?: string; icon: string; value: number; label: string }) {
  const tresc = (
    <span aria-hidden>
      {icon} {value}
    </span>
  );

  // Znacznik bez adresu jest samą informacją, więc nie jest odnośnikiem: `<span>` zamiast `<a>`
  // zostawia kursor strzałką. Łapka nad czymś, co po kliknięciu nic nie robi (albo wyrzuca
  // w bok), to obietnica bez pokrycia — a dziecko sprawdza każdą.
  if (href === undefined) {
    return (
      <span className="chip" title={label} aria-label={label} role="img">
        {tresc}
      </span>
    );
  }

  return (
    <Link href={href} className="chip" title={label} aria-label={label}>
      {tresc}
    </Link>
  );
}

/**
 * Pasek u góry każdej strony: imię, punkty, seria, punkty odblokowania i wyjście. Dziecko widzi
 * swój stan zawsze,
 * a nie tylko na stronie głównej — po to, żeby punkty zdobyte w lekcji od razu było widać.
 * Dla niezalogowanego (logowanie, zaproszenie) nie renderuje się nic.
 */
export async function TopBar() {
  const session = await getUser();
  if (!session) return null;

  const { supabase, userId, isAdmin } = session;

  const [{ data: profile }, { data: stats }, { data: unlock }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    supabase.from("v_my_stats").select("total_points, streak_days, words_due").eq("user_id", userId).maybeSingle(),
    // Punkty odblokowania. W pasku, a nie tylko na ekranie kursu: zdobywa się je w lekcji
    // (poziom trudny), a wydaje piętro wyżej — dziecko musi je widzieć także po drodze.
    supabase.rpc("unlock_status", { p_user: userId }),
  ]);

  const doOdblokowania = (unlock as { left?: number } | null)?.left ?? 0;

  return (
    <header className="app-bar">
      <div className="app-bar-inner">
        {/* Pierwszy wiersz: imię po lewej, wyjścia po prawej — na tej samej wysokości.
            Wcześniej „Panel" i „Wyloguj" stały w jednym rzędzie ze znacznikami i spadały pod nie
            trzecim wierszem (pasek i tak nigdy nie mieści wszystkiego w 48 rem). */}
        <div className="app-bar-top">
          {/* Imię prowadzi na stronę główną — to jest „wyjście” z każdego miejsca aplikacji. */}
          <Link href="/" className="app-bar-name flex items-center gap-2">
            <Logo size={36} />
            Cześć, {profile?.display_name ?? "uczniu"}!
          </Link>

          <div className="app-bar-actions">
            {/* Nagrody i postępy miały dotąd wejście tylko przez znaczniki z liczbami, a po
                znaczniku nie widać, że jest odnośnikiem — dziecko klikało w „⭐ 6411" przez
                przypadek albo wcale. Ikony te same co w aplikacji na telefon (🏅 i 📈), żeby
                obie wersje prowadziły w to samo miejsce tym samym znakiem. Napis siedzi
                w dymku i w etykiecie dla czytnika ekranu: pasek ma 48 rem i dwa dodatkowe
                słowa zepchnęłyby „Wyloguj" do drugiego wiersza. */}
            <Link href="/nagrody" className="btn-secondary btn-icon" title="Nagrody" aria-label="Nagrody">
              <span aria-hidden>🏅</span>
            </Link>
            <Link
              href="/statystyki"
              className="btn-secondary btn-icon"
              title="Twoje postępy"
              aria-label="Twoje postępy"
            >
              <span aria-hidden>📈</span>
            </Link>
            {isAdmin && (
              <Link href="/admin" className="btn-secondary">
                Panel
              </Link>
            )}
            <form action={signOut}>
              <button type="submit" className="btn-secondary">
                Wyloguj
              </button>
            </form>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-2">
          <Stat
            href="/nagrody"
            icon="⭐"
            value={stats?.total_points ?? 0}
            label={plural(stats?.total_points ?? 0, POINTS)}
          />
          <Stat
            href="/statystyki"
            icon="🔥"
            value={stats?.streak_days ?? 0}
            label={`seria: ${plural(stats?.streak_days ?? 0, DAYS)} nauki pod rząd`}
          />
          {/* Powtórki mają własną stronę: co jest do zrobienia teraz, które słówka czekają
              i kiedy wrócą. Znacznik prowadził wcześniej na postępy, gdzie z tej liczby był
              jeden kafelek wśród ośmiu innych. */}
          {(stats?.words_due ?? 0) > 0 && (
            <Stat
              href="/powtorki"
              icon="🔁"
              value={stats?.words_due ?? 0}
              label={`${plural(stats?.words_due ?? 0, WORDS)} do powtórki`}
            />
          )}
          {/* Bez punktów znacznika nie ma: dziecko przed pierwszym poziomem trudnym nie ma
              o czym wiedzieć, a pasek ma być krótki. Bez adresu, bo punktów nie wydaje się
              na żadnej osobnej stronie — klika się kłódkę z kluczykiem tam, gdzie stoi,
              czyli przy lekcji. Odnośnik na listę kursów (tak było) tylko wyrzucał dziecko
              z miejsca, w którym właśnie jest. */}
          {doOdblokowania > 0 && (
            <Stat
              icon="🔑"
              value={doOdblokowania}
              label={`${plural(doOdblokowania, UNLOCKS)} — kliknij kłódkę z kluczykiem na ekranie kursu, żeby otworzyć lekcję`}
            />
          )}
        </nav>
      </div>
    </header>
  );
}
