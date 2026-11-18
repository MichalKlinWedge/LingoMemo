-- Uzupełnianie zdania z klawiatury dostaje polskie zdanie pod spodem.
--
-- `20261118150000_fill_blank_typing.sql` świadomie nie przenosiło `translation` do wersji
-- z wpisywaniem: tłumaczenie mówi, jakie słowo z tego zdania wypadło. Po zobaczeniu tego
-- zadania na tablecie decyzja się odwraca, bo bez polskiego zdania zadanie jest nie trudne,
-- tylko nieodpowiadalne. „Ho ... cani" bez listy i bez tłumaczenia nie pyta o słówko —
-- pyta, które z kilkuset słów właściciel miał na myśli.
--
-- Tłumaczenie NIE jest tu odpowiedzią: podaje znaczenie („Trawa jest zielona."), a dziecko
-- ma z pamięci napisać słowo w języku kursu („grün"). To samo robi wersja z kafelkami, gdzie
-- polskie zdanie stoi pod luką od pierwszej migracji — różnica jest w tym, czy odpowiedź
-- wskazuje się, czy pisze. Zgadywanie z kontekstu zostaje tam, gdzie zdanie nie ma
-- tłumaczenia w pliku treści: wtedy pod luką po prostu nic nie staje.

-- 1. Generator przepisany w całości z `20261118150000_fill_blank_typing.sql` — dochodzi
--    przeniesienie `translation` ze zdania z kafelkami, z którego wersja z wpisywaniem powstaje.
--
--    `jsonb_strip_nulls`, bo zdanie bez tłumaczenia dałoby `"translation": null`, a to przeszłoby
--    walidację i dopiero na ekranie wyszłoby pustym wierszem pod luką.
create or replace function public.build_fill_blank_typing(p_lesson uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ex    record;
  v_new   uuid;
  v_sort  integer;
  v_added integer := 0;
begin
  select coalesce(max(ex.sort_order), 0) into v_sort
    from public.exercises ex where ex.lesson_id = p_lesson;

  for v_ex in
    select ex.id, ex.concept_id, ex.payload, ex.points
      from public.exercises ex
     where ex.lesson_id = p_lesson
       and ex.is_active
       and ex.type = 'fill_blank_choice'
       -- `easy_for` wskazuje zadanie, którego to jest łatwiejszą wersją. Gdy jest wypełnione,
       -- wersja z wpisywaniem powstała w poprzednim przebiegu.
       and ex.easy_for is null
       and btrim(coalesce(ex.payload ->> 'answer', '')) <> ''
     order by ex.sort_order
  loop
    -- To samo zdanie z wpisywaniem już w lekcji jest — z pliku treści albo z panelu.
    if exists (
      select 1 from public.exercises o
       where o.lesson_id = p_lesson
         and o.type = 'fill_blank_typing'
         and public.normalize_answer(o.payload ->> 'sentence')
             = public.normalize_answer(v_ex.payload ->> 'sentence')
    ) then
      continue;
    end if;

    v_sort := v_sort + 1;

    insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
    values (
      p_lesson, 'fill_blank_typing', v_sort, v_ex.concept_id,
      jsonb_strip_nulls(
        jsonb_build_object(
          'sentence', v_ex.payload -> 'sentence',
          'translation', case
            when jsonb_typeof(v_ex.payload -> 'translation') = 'string'
             and btrim(v_ex.payload ->> 'translation') <> ''
            then v_ex.payload -> 'translation'
          end,
          'accepted', jsonb_build_array(btrim(v_ex.payload ->> 'answer'))
        )
      ),
      greatest(v_ex.points, 15)
    )
    returning id into v_new;

    update public.exercises set easy_for = v_new where id = v_ex.id;
    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$fn$;

comment on function public.build_fill_blank_typing(uuid) is
  'Dorabia wersję z wpisywaniem dla zdań z luką, które mają w lekcji tylko wybór z kafelków, '
  'razem z polskim zdaniem, i wiąże je przez „easy_for". Bezpieczne przy powtórzeniu.';

-- Nadania jak w migracji, która wprowadziła generator: wołają go wyzwalacz i migracje,
-- nie aplikacja.
revoke execute on function public.build_fill_blank_typing(uuid) from anon, public;

-- 2. Zadania dorobione przed tą migracją. Generator pomija zdanie, które wersję z wpisywaniem
--    już ma, więc samo ponowne uruchomienie wyzwalacza niczego by tu nie naprawiło — wiersze
--    trzeba uzupełnić wprost. Para jest zapisana w `easy_for` zdania z kafelkami.
update public.exercises t
   set payload = t.payload || jsonb_build_object('translation', c.payload -> 'translation')
  from public.exercises c
 where c.easy_for = t.id
   and t.type = 'fill_blank_typing'
   and not (t.payload ? 'translation')
   and jsonb_typeof(c.payload -> 'translation') = 'string'
   and btrim(c.payload ->> 'translation') <> '';
