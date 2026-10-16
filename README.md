# Účastníci tréninku

Mobilní webová aplikace pro přihlašování na pravidelné tréninky (a jednorázové akce): stálí hráči a záskoky,
fronta „šel bych“, rozpočítání trenéra a kurtu, QR platba, kontrola plateb za sezónu a připravené zprávy do WhatsAppu.

## Jak je aplikace postavená
- **Web:** statické soubory bez buildu, hostuje GitHub Pages. `index.html` (kostra), `app.js` (celá logika), `style.css`, `faces.js` (kreslené avatary, pořadí se nesmí měnit), `config.js` (adresa a veřejný klíč databáze), `vendor/qrcode.js` (knihovna pro QR, kopie z npm, nic se nestahuje z cizího serveru).
- **Databáze:** Supabase (Postgres). Web volá jen databázové funkce `app_*` a `super_*`. Tabulky nejsou z webu čitelné, o kapacitě, pořadí záskoků, PINech a uzávěrce termínu rozhoduje databáze, ne prohlížeč.
- **Odkaz skupiny:** `https://<uživatel>.github.io/ucastnici-treninku/?g=<kód skupiny>`, volitelně `&d=RRRR-MM-DD` otevře týden s tímto termínem.
- **Lokální vývoj:** `python3 -m http.server` a vyplněný `config.js`.

## Pravidla, která aplikace drží
Seznam v jedné větě, aby šlo rychle najít, kde se co děje (`app.js` = web, `supabase/` = databáze).

| Pravidlo | Kde |
|---|---|
| Kapacita je celé číslo 1–200, když je plno, ANO se zablokuje | `app_set_status`, `app_save_cfg` |
| Záskok má přednost podle pořadí „šel bych“ do 24 h před začátkem, potom první ANO | `app_set_status`, `stats` / `priorityActive` |
| Trenér se dělí mezi všechna ANO, nahoru na celé koruny. Kurt nahoru na desetikoruny, přebytek jde do kasy | `stats` |
| V předplaceném období platí kurt jen záskoci | `stats` (`ctOf`) |
| Termín se 48 h po konci uzavře, měnit ho pak smí jen admin | `day_locked`, `dayClosed` |
| Zprávy do WhatsAppu: status nejdřív v neděli 20:00 před termínem, platba 5 minut po konci | `waCards` |
| PIN: 4–8 číslic, po 5 chybách za sebou se na 15 minut zamkne | `pin_fail`, `is_admin`, `super_login` |
| Číslo účtu musí být platný IBAN, každá změna účtu a textu platby se zapíše do historie a u QR se ukáže datum změny | `app_save_cfg`, `cfg_history` |

## Databáze: migrace
Všechny změny databáze jsou očíslované soubory v `supabase/migrations/`. Každý jen přidává nebo přepisuje funkce, existující data nemění a jde spustit i dvakrát.

| Soubor | Co přináší |
|---|---|
| `001-zaklad.sql` | tabulky, docházka, admin skupiny, správce aplikace |
| `002-zpravy.sql` | záložka Zprávy (tabulka `wa_log`) |
| `003-bezpecnost.sql` | omezení pokusů o PIN, kontrola IBANu, historie účtu, uzávěrka termínu, e-mail žadatele povinný |

**Nová prázdná databáze:** v SQL Editoru spusťte celý `supabase/schema.sql` (je to slepené 001 + 002 + 003). Potom vlastní data skupiny.
**Existující databáze:** spusťte jen nové migrace, které ještě neběžely, v pořadí podle čísel. Nikdy znovu nespouštějte `schema.sql` ani úvodní nahrání dat z excelu.
**Po přidání nové migrace** spusťte `sh supabase/build-schema.sh`, aby `schema.sql` zůstal aktuální.

Pořadí nasazení změny: nejdřív migrace v SQL Editoru, potom nový web (push do `main`). Starý web s novou databází funguje dál.

## PIN správce a PIN admina
PINy se v databázi ukládají zašifrované, nejdou přečíst, jen přenastavit.
- **PIN správce aplikace** (nastavuje se jen v databázi, z webu to nejde): v SQL Editoru
  `update public.app_admin set pin_hash = extensions.crypt('VÁŠ_PIN', extensions.gen_salt('bf')) where id = 1;`
- **PIN admina skupiny** nastaví žadatel při žádosti o skupinu. Pro skupinu bez PINu nebo při zapomenutí ho nastaví správce v Nastavení (Nový PIN), nebo v SQL Editoru:
  `update public.groups set admin_pin = extensions.crypt('NOVÝ_PIN', extensions.gen_salt('bf')) where slug = 'KÓD_SKUPINY';`
- **Odemknutí po 5 chybách** (jinak se odemkne samo za 15 minut): `delete from public.pin_attempts;`
- **Kdo nastavuje, kdo to změnil:** `select * from public.cfg_history order by at desc;` ukáže změny čísla účtu a textu platby.

## Role
- **Kdokoli s odkazem:** přihlašuje sebe i ostatní, přidává a upravuje lidi, odesílá zprávy.
- **Admin skupiny** (PIN): nastavení, ceny, předplatné, ignorování zpráv, změny v uzavřených termínech. Skupina má jednoho admina.
- **Správce aplikace** (PIN): schvaluje nové skupiny, vidí všechny, obnovuje PIN adminům.

## Knihovna pro QR
`vendor/qrcode.js` je nezměněný soubor z npm balíčku `qrcode-generator@1.4.4` (MIT). Aktualizace: stáhnout novou verzi (`npm pack qrcode-generator@<verze>`), nahradit soubor a ověřit QR na obrazovce Platba.
