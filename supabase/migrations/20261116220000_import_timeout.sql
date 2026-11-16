-- Dłuższy limit czasu zapytania dla roli `service_role`.
--
-- Import lekcji (`admin_import_lesson`) idzie przez PostgREST, a tam obowiązuje limit czasu
-- ustawiony na roli. Domyślne osiem sekund wystarczało, dopóki import tylko wstawiał zadania
-- z pliku; teraz przy zatwierdzeniu transakcji dochodzą generatory wariantów (łatwy, średni,
-- trudny, rozsypanka), które przechodzą całą lekcję. Lekcja z pięćdziesięcioma zadaniami nie
-- mieści się w ośmiu sekundach na maszynie w chmurze i kończy się
-- „canceling statement due to statement timeout", czyli wycofaniem całego importu.
--
-- Dlaczego akurat `service_role`: tą rolą chodzą WYŁĄCZNIE narzędzia z `tools/` (w aplikacji
-- webowej jej nie ma — patrz CLAUDE.md). Role `anon` i `authenticated`, czyli wszystko, czym
-- posługuje się dziecko i rodzic, zostają przy swoim limicie — długie zapytanie z przeglądarki
-- dalej ma zostać ucięte.
--
-- Odrzucone: wyłączanie generatorów na czas importu (lekcja wjeżdżałaby bez wariantów, a ktoś
-- musiałby pamiętać o drugim kroku) i dzielenie importu na kilka wywołań (przestałby być jedną
-- transakcją, a przy błędzie zostawiałby połowę lekcji).
alter role service_role set statement_timeout = '60s';

-- PostgREST trzyma ustawienia ról w pamięci; bez tego nowy limit zaczyna obowiązywać dopiero
-- po restarcie usługi.
notify pgrst, 'reload config';
