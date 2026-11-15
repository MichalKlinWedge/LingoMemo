# Obrazki do zadań „wskaż obrazek”

Źródła 56 obrazków używanych przez zadania `image_choice` w kursie `pl-en-class4`. Płaskie SVG
pisane ręcznie, bez zależności i bez fontów poza systemowymi — jeden plik waży kilkaset bajtów,
więc kafelek pojawia się od razu i jest ostry na każdym ekranie.

## Nazewnictwo

| Przedrostek | Co to | Przykład |
|---|---|---|
| `kolor-` | plama barwna w ciemnej ramce (ramka jest po to, żeby biały i żółty były widoczne na jasnym tle) | `kolor-blue.svg` |
| `liczba-` | duża cyfra na kremowej karcie | `liczba-17.svg` |
| `rzecz-` | przedmiot ze szkolnego plecaka albo z klasy | `rzecz-scissors.svg` |

Nazwa po angielsku, bo zgadza się z kluczem pojęcia: `colour.blue` → `kolor-blue.svg`,
`num.17` → `liczba-17.svg`, `thing.scissors` i `room.clock` → `rzecz-*.svg`.

## Skąd się biorą w aplikacji

Pliki leżą w buckecie `lesson-media` pod ścieżką `2026/<nazwa>.svg` i stamtąd bierze je
przeglądarka. W treści lekcji stoi **ścieżka**, nie pełny adres (`"options": ["2026/liczba-30.svg"]`)
— adres publiczny zmienia się razem z projektem w chmurze, ścieżka nie.

Wgrywanie: panel `/admin/obrazki` (przeciągnięcie plików) albo wprost do Storage kluczem
serwisowym. Nazwa w buckecie musi zostać ta sama, bo odwołują się do niej pliki lekcji
w `content/pl-en-class4/`.

## Czego tu nie ma

Zwroty („Otwórzcie książki.", „Jak to się literuje?") nie mają obrazków i mieć nie powinny —
rysunek byłby zgadywanką, nie podpowiedzią. Dlatego lekcje `Classroom language`
i `How do you spell that` nie mają zadań z wyborem obrazka.

## Przy dokładaniu nowych

Dwie rzeczy łatwe do przeoczenia, obie wyszły przy rysowaniu tego zestawu:

- **Sylwetka, nie odcień.** Gumka i temperówka w tym samym różu były nie do odróżnienia
  z miniatury. Temperówka jest teraz stalowa, z okrągłym otworem i wiórem.
- **Rzeczy podobne na rysunku nie mogą trafić do jednego zadania** jako opcje — ołówek
  z kredką, gumka z temperówką. Dystraktory dobiera się ręcznie w pliku lekcji.
