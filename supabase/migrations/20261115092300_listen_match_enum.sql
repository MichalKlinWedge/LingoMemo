-- Nowa wartość enuma `exercise_type`: dopasowywanie ze słuchu.
--
-- Osobna migracja, bo `alter type ... add value` zatwierdza nową wartość dopiero z końcem
-- transakcji. Użyta w tej samej migracji (choćby jako literał w ciele funkcji SQL, które
-- Postgres parsuje przy tworzeniu) wywaliłaby się z „unsafe use of new value of enum type".

alter type public.exercise_type add value if not exists 'listen_match';
