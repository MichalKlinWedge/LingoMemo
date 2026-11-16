-- Rodzic też się uczy — swoich kursów.
--
-- Rola rodzica powstała jako czysty wgląd: `20261115110000_parent_role.sql` zakładało, że rodzic
-- lekcji nie robi, więc strona główna pokazywała mu wyłącznie listę dzieci, a zaproszenie z
-- kursem celowo NIE zakładało mu zapisu („byłby pustym wierszem"). Tymczasem rodzic uczący się
-- razem z dzieckiem to najzwyklejszy przypadek — ten sam kurs, własne konto, własne powtórki.
--
-- W bazie nic nie trzeba otwierać: nauką rządzi zapis na kurs (`is_enrolled` pod
-- `is_lesson_unlocked`), a ten nie pyta o rolę. Zostaje jedno miejsce, które rodzica wyjmowało
-- z reguły: wyzwalacz zaproszeń. Od teraz zaproszenie z kursem zapisuje każdego, kogo zaprasza,
-- rodzica też — a rodzic bez kursu w zaproszeniu prosi o dostęp tym samym przyciskiem co dziecko
-- (`request_course_access`).
--
-- Czego NIE zmieniamy: rodzic dalej nie widzi `exercises` (klucze odpowiedzi) i dalej czyta
-- postępy tylko swoich dzieci. Jego własna nauka księguje się na jego koncie, więc statystyki
-- dziecka pozostają nietknięte — punkty rodzica nie wchodzą do wyników dziecka, bo każdy wiersz
-- postępu ma `user_id`.
--
-- Odrzucone: osobny zapis „rodzic uczy się kursu dziecka" (zapis to zapis — drugi rodzaj
-- wiersza znaczyłby to samo, a trzeba by go sprawdzać w każdej funkcji nauki); automatyczne
-- zapisanie rodzica na kursy jego dzieci (o dostępie decyduje administrator, tak samo jak
-- u dziecka — a rodzic dwójki dzieci dostałby nagle cztery kursy).

-- 1. Zaproszenie z kursem zapisuje także rodzica. Reszta ciała przepisana z
-- `20261115110000_parent_role.sql` — `create or replace` nie zna zmian cząstkowych.
create or replace function public.apply_invitation()
returns trigger
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_token text := new.raw_user_meta_data ->> 'invite';
  v_inv   app_private.invitations%rowtype;
begin
  if v_token is null or btrim(v_token) = '' then
    return new;
  end if;

  select * into v_inv from app_private.invitations i
   where i.token_hash = app_private.token_digest(v_token);
  if not found then
    return new;
  end if;

  update app_private.invitations
     set consumed_by = coalesce(consumed_by, new.id), consumed_at = coalesce(consumed_at, now())
   where id = v_inv.id;

  -- Bez wyjątku dla rodzica: skoro administrator wpisał kurs w zaproszenie, to znaczy, że ten
  -- ktoś ma się tego kursu uczyć — niezależnie od tego, czy ma też wgląd w postępy dzieci.
  if v_inv.course_id is not null then
    insert into public.enrollments (user_id, course_id) values (new.id, v_inv.course_id)
    on conflict do nothing;
  end if;

  if v_inv.role = 'admin' then
    insert into app_private.admin_users (user_id, granted_by) values (new.id, v_inv.created_by)
    on conflict do nothing;
  end if;

  if v_inv.role = 'parent' then
    insert into app_private.parent_users (user_id, granted_by) values (new.id, v_inv.created_by)
    on conflict do nothing;
  end if;

  return new;
end;
$fn$;

-- 2. Komentarze, które mówiły „rodzic nie uczy się". Zostawione wprowadzałyby w błąd przy
-- pierwszym czytaniu schematu z bazy.
comment on function public.is_parent() is
  'Czy bieżący użytkownik jest rodzicem — z claimu w JWT. Rola daje wgląd w postępy dzieci, '
  'a nie zabiera własnej nauki: rodzic robi lekcje tych kursów, na które ma zapis. '
  'Sam claim nie mówi, czyim rodzicem; listę dzieci wydaje my_child_ids().';

comment on table app_private.parent_children is
  'Kto jest czyim rodzicem. Dziecko może mieć dwoje rodziców, rodzic kilkoro dzieci. '
  'Powiązanie daje wgląd w postępy dziecka; zapisy na kursy rodzica są osobne.';
