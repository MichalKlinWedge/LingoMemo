-- Klocki rozsypanki bez końcowej interpunkcji.
--
-- W zadaniu „ułóż zdanie" ostatni klocek miał kropkę („Jen."), więc dziecko wiedziało, które
-- słowo idzie na koniec, zanim przeczytało zdanie. Przy pytaniach to samo robił znak zapytania.
-- Zadanie przestawało sprawdzać szyk, a zaczynało sprawdzać spostrzegawczość.
--
-- Czyścimy DANE, a nie wydawanie zadania: wyzwalacz zdejmuje interpunkcję przy zapisie, więc
-- dotyczy wszystkich źródeł naraz — importu z plików treści, panelu i generatorów wariantów.
-- Gdyby robić to przy wydawaniu, trzeba by zmieniać `get_lesson_exercises` i `child_exercise`,
-- czyli dwa miejsca, które i tak są najczęściej przepisywane.
--
-- Ocena odpowiedzi się nie zmienia: `normalize_answer` i tak zdejmuje interpunkcję, zanim
-- porówna ułożone zdanie z `solution`. Zdejmujemy ją w obu polach, bo więz sprawdza, że zdanie
-- da się ułożyć DOKŁADNIE z podanych klocków — rozjazd „Jen." kontra „Jen" wywaliłby zapis.

/** Słowo bez końcowej interpunkcji. Kropka w środku („p.m.") zostaje — znika tylko ta na końcu. */
create or replace function public.bare_token(p_token text)
returns text
language sql immutable set search_path = ''
as $fn$
  select btrim(regexp_replace(coalesce(p_token, ''), '[.!?,;:]+$', ''));
$fn$;

/**
 * Zdejmowanie interpunkcji z klocków przy zapisie. Kolejność klocków zostaje (`with ordinality`),
 * bo w `solution` to ona jest poprawną odpowiedzią. Klocek, z którego po przycięciu nic nie
 * zostaje (sam znak przestankowy), wypada — pusty klocek nie ma czego sprawdzać.
 */
create or replace function public.strip_token_punctuation()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.type <> 'sentence_order' then
    return new;
  end if;

  new.payload := new.payload || jsonb_build_object(
    'tokens', coalesce((
      select jsonb_agg(public.bare_token(t.value) order by t.nr)
        from jsonb_array_elements_text(new.payload -> 'tokens') with ordinality as t(value, nr)
       where public.bare_token(t.value) <> ''
    ), '[]'::jsonb),
    'solution', coalesce((
      select jsonb_agg(public.bare_token(s.value) order by s.nr)
        from jsonb_array_elements_text(new.payload -> 'solution') with ordinality as s(value, nr)
       where public.bare_token(s.value) <> ''
    ), '[]'::jsonb)
  );

  return new;
end;
$fn$;

drop trigger if exists exercises_token_punctuation on public.exercises;
create trigger exercises_token_punctuation
  before insert or update on public.exercises
  for each row execute function public.strip_token_punctuation();

revoke execute on function public.bare_token(text) from anon, public;

-- Rozsypanki, które już są w bazie. Wyzwalacz przy aktualizacji zrobi resztę.
update public.exercises set payload = payload where type = 'sentence_order';
