# Účastníci tréninku

Mobilní webová aplikace pro přihlašování na pravidelné tréninky (a jednorázové akce): stálí hráči a záskoky,
fronta „šel bych“, rozpočítání trenéra a kurtu, QR platba a kontrola plateb za sezónu.

- Hosting: GitHub Pages (statické soubory v tomto repozitáři, bez buildu).
- Data: Supabase (Postgres). Aplikace volá jen databázové funkce ze `supabase/schema.sql`.
- Odkaz skupiny: `https://<uživatel>.github.io/ucastnici-treninku/?g=<kód skupiny>`.

## Nastavení databáze
1. V Supabase otevřete **SQL Editor → New query**, vložte celý `supabase/schema.sql` a spusťte (**Run**).
2. Data konkrétní skupiny (jména, účet) se do repozitáře nedávají. Nahrávají se zvlášť SQL souborem v SQL Editoru.
3. Do `config.js` patří Project URL a publishable (anon) klíč, oba jsou veřejné.

## Role
- **Kdokoli s odkazem**: přihlašuje sebe i ostatní, přidává a upravuje lidi.
- **Admin skupiny** (PIN): nastavení, ceny, předplatné. První zadaný PIN se uloží.
- **Správce aplikace** (PIN, v Nastavení → Správce aplikace): schvaluje nové skupiny, vidí všechny, obnovuje PIN adminům.

## Lokální vývoj
Stačí statický server (`python3 -m http.server`) a vyplněný `config.js`.
