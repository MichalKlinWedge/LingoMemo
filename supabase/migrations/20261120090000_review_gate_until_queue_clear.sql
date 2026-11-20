-- Obowiązkowa bramka powtórek stoi, dopóki kolejka nie zejdzie pod próg — a nie do końca dnia.
--
-- `20261116120000_review_gate.sql` otwierało kurs na resztę dnia po pierwszym zdanym teście,
-- choćby zaległych zostało dwa razy więcej niż próg. Założenie było takie, że jedno podejście
-- (dwanaście słówek) zawsze zbija kolejkę pod próg (dziesięć), więc różnica jest teoretyczna.
--
-- W praktyce kolejka dorosła do pięćdziesięciu i to założenie pękło. Przebieg jednego dnia:
-- dziecko zdaje test na dwanaście słówek, kurs otwiera się do wieczora, dziecko robi lekcje
-- i dokłada nowe słówka do kolejki — a trzydzieści osiem starych dalej w niej leży. Następnego
-- dnia licznik pokazuje znowu około pięćdziesięciu i wygląda, jakby wczorajsza praca nie
-- zapisała się wcale. Zapisała się: termin każdego słówka przesuwa `srs_apply` zaraz po
-- odpowiedzi, niezależnie od wyniku testu (słówko podane dobrze dostaje 3–36 dni, pomylone
-- jeden dzień). Tylko że dwanaście słówek na dzień nie wykopie pięćdziesięciu.
--
-- Od teraz zdany test otwiera lekcje dopiero wtedy, gdy zaległych jest naprawdę mniej niż próg.
-- Przy długiej kolejce dziecko robi kilka testów pod rząd — każdy krótki, po dwanaście słówek —
-- i dopiero potem wraca do nauki. Test po zdanym zostaje otwarty (`review_test_open`), więc jest
-- czym te podejścia robić.
--
-- Odrzucone: dłuższy test (`review_limit` z dwunastu na dwadzieścia pięć) — pięćdziesiąt zadań
-- pod rząd to dla dziecka nie powtórka, tylko kara; oraz niższy próg bramki, żeby kolejka nigdy
-- nie rosła — blokada zapalałaby się wtedy co drugi dzień i rozbijała naukę w tygodniu.

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

  -- Kolejka ponad progiem trzyma bramkę także po zdanym dziś teście. To jest ta zmiana:
  -- wcześniej zdany test otwierał kurs do końca dnia, więc przy pięćdziesięciu zaległych
  -- dziecko wychodziło z testu do lekcji i dokładało nowe słówka do kolejki, której nie ruszyło.
  if v_due >= public.review_gate_limit() then
    return true;
  end if;

  -- Niżej progu zdany test otwiera kurs, a oblany trzyma bramkę zatrzaskiem: błędna odpowiedź
  -- przesuwa termin na jutro, więc po oblanym teście sam licznik spada pod próg i otwierałby
  -- kurs za nic.
  if public.review_gate_passed_today(p_course, p_user) then
    return false;
  end if;

  return public.review_gate_tried_today(p_course, p_user);
end;
$fn$;

comment on function public.review_gate_on(uuid, uuid) is
  'Czy kurs jest dla tego ucznia zamknięty zaległymi powtórkami. Stoi, dopóki zaległych jest '
  'nie mniej niż próg — także po zdanym dziś teście — oraz po teście oblanym (zatrzask).';

-- Nadania jak w migracji, która wprowadziła funkcję.
revoke execute on function public.review_gate_on(uuid, uuid) from anon, public;
grant execute on function public.review_gate_on(uuid, uuid) to authenticated;

-- Licznik zaległych liczy teraz tylko te słówka, które test powtórkowy UMIE wziąć.
--
-- Zabezpieczenie konieczne właśnie przy bramce trzymanej kolejką, a nie dniem. Dotąd licznik
-- pytał, czy słówko ma gdziekolwiek aktywne zadanie, a `pick_review_exercises` szuka zadania
-- w lekcji należącej do działu TEGO kursu. Rozjazd był nieszkodliwy, póki zdany test otwierał
-- kurs do wieczora: słówko nie do powtórzenia podbijało licznik i tyle. Teraz zablokowałoby
-- dziecko na zawsze — licznik stale ponad progiem, a test bez ani jednego zadania do pokazania.
--
-- Po tej zmianie obie funkcje czytają ten sam warunek, więc „zaległe > 0" znaczy „test ma z czego
-- powstać". Licznik może przez to zejść w dół dla słówek, których i tak nie było jak powtórzyć —
-- i to jest uczciwsze niż liczba, której dziecko nie ma jak zbić.
create or replace function public.course_due_words(p_course uuid, p_user uuid)
returns integer
language sql stable security definer set search_path = ''
as $fn$
  select count(*)::integer
    from public.srs_state s
   where s.user_id = p_user
     and s.course_id = p_course
     and s.due_on <= current_date
     and exists (
       select 1
         from public.exercises ex
         join public.lessons el on el.id = ex.lesson_id
         join public.units eu on eu.id = el.unit_id
        where ex.concept_id = s.concept_id
          and ex.is_active
          and eu.course_id = p_course
     );
$fn$;

comment on function public.course_due_words(uuid, uuid) is
  'Ile słówek kursu czeka na powtórzenie: zaległe w FSRS i mające w tym kursie aktywne zadanie, '
  'czyli dokładnie te, które test powtórkowy umie wziąć.';

revoke execute on function public.course_due_words(uuid, uuid) from anon, public;
grant execute on function public.course_due_words(uuid, uuid) to authenticated;
