-- Dzienna pula podpowiedzi: trzy zamiast pięciu.
--
-- Pięć na dobę okazało się na tyle dużo, że podpowiedź przestawała być wyjściem awaryjnym —
-- przy sześciu zadaniach na etap dziecko mogło przeklikać większość lekcji w łatwiejszej wersji
-- i nadal mieć zapas. Trzy wystarczają na to, po co podpowiedź jest: odblokować dziecko, które
-- naprawdę utknęło, a nie zastąpić pisanie klikaniem.
--
-- Zmiana jest jednoliniowa, bo limit od początku siedzi w funkcji, a nie w stałej rozsypanej
-- po zapytaniach. Pula nadal liczy się Z UŻYĆ, nie z licznika, więc nikomu nie trzeba niczego
-- zerować: od najbliższej północy w strefie dziecka obowiązuje nowa liczba.
--
-- Dokładka za lekcje zaliczone tego dnia (`20261115120000_hint_for_lesson.sql`) zostaje bez zmian
-- — to ona ma nagradzać za skończoną lekcję, a nie wyjściowa pula.

create or replace function public.hint_limit() returns integer
  language sql immutable set search_path = '' as $fn$ select 3 $fn$;

comment on function public.hint_limit() is
  'Ile podpowiedzi na dobę dostaje dziecko, zanim doliczymy dokładkę za zaliczone lekcje.';
