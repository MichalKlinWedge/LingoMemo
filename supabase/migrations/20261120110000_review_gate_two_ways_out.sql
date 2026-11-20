-- Bramka powtórek znowu ma dwa wyjścia: jeden zdany test ALBO zejście pod próg zaległych.
--
-- `20261120090000_review_gate_until_queue_clear.sql` zabrało pierwsze z nich — bramka stała,
-- dopóki zaległych było nie mniej niż próg, choćby test był dziś zdany. Powód był policzalny:
-- jedno podejście bierze `review_limit() = 12` słówek, więc przy pięćdziesięciu zaległych zdany
-- test otwierał lekcje, dziecko dokładało do kolejki nowe słówka, a trzydzieści osiem starych
-- dalej w niej leżało.
--
-- Rachunek się nie zmienił, zmienił się wniosek. Tamta reguła znaczyła w praktyce cztery testy
-- pod rząd (około czterdziestu ośmiu zadań) przed pierwszą lekcją dnia — a dziecko, które
-- właśnie zdało test, dostawało w nagrodę kolejny zamknięty ekran. Blokada ma pilnować, żeby
-- powtórki się nie urwały, nie odbierać dnia nauki.
--
-- Więc wracamy do dwóch niezależnych wyjść. Kolejka i tak schodzi, tylko wolniej: każda
-- odpowiedź przesuwa termin słówka od razu (`srs_apply`, niezależnie od wyniku testu), a bramka
-- wraca następnego dnia, dopóki zaległych jest ponad próg. Z pięćdziesięciu robi się
-- trzydzieści osiem, potem dwadzieścia sześć — jeden test dziennie, bez dnia bez nauki.
--
-- Ciało przepisane z `20261116120000_review_gate.sql`. Zostaje natomiast wyrównanie licznika
-- z doborem zadań z migracji `…090000` (`course_due_words` liczy tylko słówka, które test umie
-- wziąć) — tamto nie dotyczyło tej reguły i jest prawdziwe niezależnie od niej.

create or replace function public.review_gate_on(p_course uuid, p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_due integer;
begin
  if p_course is null or public.review_gate_lesson(p_course) is null then
    return false;
  end if;

  -- Nie ma zaległego słówka z zadaniem — nie ma z czego zrobić testu, więc bramka nie ma prawa
  -- stać. To jedyne wyjście z zatrzasku poza zdaniem testu.
  v_due := public.course_due_words(p_course, p_user);
  if v_due = 0 then
    return false;
  end if;

  -- Pierwsze wyjście: jeden zdany test powtórkowy otwiera kurs do końca dnia, także wtedy, gdy
  -- kolejka jest dłuższa od jednego podejścia. Resztę dziecko może powtórzyć dobrowolnie — test
  -- zostaje otwarty (`review_test_open`) — albo zostawić do jutra.
  if public.review_gate_passed_today(p_course, p_user) then
    return false;
  end if;

  -- Drugie wyjście: zaległych zrobiło się mniej niż próg. Zatrzask po oblanym teście jest tu
  -- konieczny, bo błędna odpowiedź przesuwa termin na jutro — po oblanym teście sam licznik
  -- spada pod próg i otwierałby kurs za nic.
  return v_due >= public.review_gate_limit()
      or public.review_gate_tried_today(p_course, p_user);
end;
$fn$;

comment on function public.review_gate_on(uuid, uuid) is
  'Czy kurs jest dla tego ucznia zamknięty zaległymi powtórkami. Dwa wyjścia: jeden zdany dziś '
  'test powtórkowy albo zejście pod próg zaległych; oblany test trzyma bramkę zatrzaskiem.';

-- Nadania jak w migracji, która wprowadziła funkcję.
revoke execute on function public.review_gate_on(uuid, uuid) from anon, public;
grant execute on function public.review_gate_on(uuid, uuid) to authenticated;
