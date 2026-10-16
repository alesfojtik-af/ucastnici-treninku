-- Migrace 003: bezpečnost plateb a PINů.
--  * PIN: po 5 chybách za sebou se PIN na 15 minut zamkne (zvlášť pro každou skupinu a pro správce).
--  * Žádný „první zadaný PIN vyhrává“: PIN admina nastaví žadatel při žádosti nebo správce, PIN správce se nastaví v SQL Editoru.
--  * Žádost o skupinu musí mít e-mail žadatele.
--  * Číslo účtu (IBAN) se při uložení zkontroluje a každá změna účtu a textu platby se zapíše do historie.
--  * Termín se 48 hodin po konci zamkne: odpovědi a cash pak smí měnit jen admin (PIN).
--  * Kapacita musí být celé číslo 1 až 200.
-- Jen PŘIDÁVÁ tabulky a funkce a přepisuje funkce. Existující data nemění. Lze spustit opakovaně.
-- Pořadí nasazení: nejdřív tuto migraci v SQL Editoru, potom nový web (starý web s novou databází funguje dál).

-- ---------- tabulky ----------
create table if not exists public.pin_attempts (
  key text primary key,            -- 'super' nebo 'grp:<id skupiny>'
  fails int not null default 0,    -- chyb za sebou
  last_fail timestamptz,
  locked_until timestamptz
);
alter table public.pin_attempts enable row level security;

create table if not exists public.cfg_history (
  id bigserial primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  at timestamptz not null default now(),
  field text not null check (field in ('iban','msg')),
  old_value text,
  new_value text,
  by_super boolean not null default false   -- změnil správce aplikace (jinak admin skupiny)
);
create index if not exists cfg_history_group on public.cfg_history(group_id, at);
alter table public.cfg_history enable row level security;

-- ---------- omezení pokusů o PIN ----------
-- Lock platí 15 minut od poslední chyby. Dotaz bez PINu (null) se nepočítá jako chyba.
create or replace function private.pin_assert_open(p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.pin_attempts where key = p_key and locked_until > now()) then
    raise exception 'PIN je dočasně zamčený po opakovaných chybách. Zkuste to za 15 minut.';
  end if;
end $$;

create or replace function private.pin_fail(p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.pin_attempts as a (key, fails, last_fail) values (p_key, 1, now())
    on conflict (key) do update
      set fails = case when a.last_fail < now() - interval '15 minutes' then 1 else a.fails + 1 end, last_fail = now()
    returning fails into n;
  if n >= 5 then
    update public.pin_attempts set locked_until = now() + interval '15 minutes' where key = p_key;
  end if;
end $$;

-- PIN správce s počítáním chyb.
create or replace function private.super_login(p_pin text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare ok boolean;
begin
  if p_pin is null then return false; end if;
  perform private.pin_assert_open('super');
  ok := private.is_super(p_pin);
  if ok then
    delete from public.pin_attempts where key = 'super';
  elsif exists (select 1 from public.app_admin where id = 1 and pin_hash is not null) then
    perform private.pin_fail('super');
  end if;
  return ok;
end $$;

-- PIN admina skupiny (platí i PIN správce) s počítáním chyb za skupinu.
create or replace function private.is_admin(g public.groups, p_pin text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare ok boolean; k text := 'grp:' || g.id;
begin
  if p_pin is null then return false; end if;
  perform private.pin_assert_open(k);
  ok := private.is_super(p_pin)
        or coalesce(g.admin_pin is not null and g.admin_pin = crypt(p_pin, g.admin_pin), false);
  if ok then delete from public.pin_attempts where key = k; else perform private.pin_fail(k); end if;
  return ok;
end $$;

-- Platný IBAN: tvar a kontrolní číslice (mod 97). České IBANy mají 24 znaků.
create or replace function private.iban_ok(p_iban text)
returns boolean language plpgsql immutable as $$
declare s text; r bigint := 0; ch text; i int;
begin
  if p_iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' or (left(p_iban, 2) = 'CZ' and length(p_iban) <> 24) then return false; end if;
  s := substr(p_iban, 5) || substr(p_iban, 1, 4);
  for i in 1..length(s) loop
    ch := substr(s, i, 1);
    if ch ~ '[0-9]' then r := (r * 10 + ch::int) % 97;
    else r := (r * 100 + ascii(ch) - 55) % 97; end if;
  end loop;
  return r = 1;
end $$;

-- ---------- čtení: datum poslední změny účtu ----------
create or replace function public.app_get(p_slug text)
returns json language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  select * into g from public.groups where slug = p_slug;
  if g.id is null then return json_build_object('error','not_found'); end if;
  if g.status <> 'active' then
    return json_build_object('group', json_build_object('slug', g.slug, 'name', g.name, 'status', g.status));
  end if;
  return json_build_object(
    'now', now(),
    'group', json_build_object('slug', g.slug, 'name', g.name, 'status', g.status, 'cfg', g.cfg,
              'admin_person', g.admin_person, 'admin_name', g.admin_name, 'has_pin', g.admin_pin is not null,
              'has_email', g.admin_email is not null,
              'iban_changed', (select max(at) from public.cfg_history where group_id = g.id and field = 'iban')),
    'people', coalesce((select json_agg(json_build_object('id', id, 'n', name, 'g', kind, 'paid', paid,
              'email', email, 'av', avatar, 'active', active) order by id)
              from public.people where group_id = g.id), '[]'),
    'att', coalesce((select json_agg(json_build_object('d', day, 'p', person_id, 'st', status, 'ts', ts))
              from public.attendance where group_id = g.id), '[]'),
    'days', coalesce((select json_agg(json_build_object('d', day, 'cash', cash_person))
              from public.day_meta where group_id = g.id), '[]')
  );
end $$;

-- ---------- docházka a cash: termín se 48 h po konci zamkne ----------
-- Starý podpis bez PINu se zahazuje, aby volání nebylo nejednoznačné (starý web volá nový podpis bez PINu a funguje).
drop function if exists public.app_set_status(text, bigint, date, text);
drop function if exists public.app_set_cash(text, date, bigint);

create or replace function private.day_locked(g public.groups, p_day date, p_pin text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare end_at timestamptz;
begin
  end_at := (p_day + coalesce(nullif(g.cfg->>'end',''), nullif(g.cfg->>'time',''), '00:00')::time) at time zone 'Europe/Prague';
  if now() <= end_at + interval '48 hours' then return false; end if;
  return not private.is_admin(g, p_pin);       -- po uzávěrce smí měnit jen admin
end $$;

create or replace function public.app_set_status(p_slug text, p_person bigint, p_day date, p_status text, p_pin text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  g public.groups; p public.people; cur public.attendance;
  cap int; n int; free int; ahead int; first_name text; start_at timestamptz; keep_ts timestamptz;
begin
  g := private.grp(p_slug, true);            -- zámek skupiny = kdo dřív přijde, ten dřív mele
  p := private.person(g, p_person);
  if not p.active then raise exception 'Hráč byl odebrán'; end if;
  if private.day_locked(g, p_day, p_pin) then return json_build_object('ok', false, 'error', 'locked'); end if;
  select * into cur from public.attendance where group_id = g.id and day = p_day and person_id = p.id;

  if p_status is null then
    delete from public.attendance where group_id = g.id and day = p_day and person_id = p.id;
    return json_build_object('ok', true);
  end if;
  if p_status not in ('ano','ne','chci') then raise exception 'Neplatný stav'; end if;
  if p_status = 'chci' and p.kind <> 'z' then raise exception 'Šel bych je jen pro záskoky'; end if;

  if p_status = 'ano' and coalesce(cur.status,'') <> 'ano' then
    cap := coalesce((g.cfg->>'cap')::int, 99);
    select count(*) into n from public.attendance a join public.people pp on pp.id = a.person_id
      where a.group_id = g.id and a.day = p_day and a.status = 'ano' and pp.active;
    free := cap - n;
    if free <= 0 then
      return json_build_object('ok', false, 'error', 'full');
    end if;
    -- přednost „šel bych“ platí do 24 h před začátkem
    start_at := (p_day + coalesce(nullif(g.cfg->>'time',''),'00:00')::time) at time zone 'Europe/Prague';
    if p.kind = 'z' and now() < start_at - interval '24 hours' then
      select count(*), (array_agg(pp.name order by a.ts))[1] into ahead, first_name
        from public.attendance a join public.people pp on pp.id = a.person_id
        where a.group_id = g.id and a.day = p_day and a.status = 'chci' and pp.active and pp.id <> p.id
          and (cur.ts is null or cur.status <> 'chci' or a.ts < cur.ts);
      if ahead >= free then
        return json_build_object('ok', false, 'error', 'priority', 'name', first_name);
      end if;
    end if;
  end if;

  keep_ts := case when p.kind = 'z' and cur.status = 'chci' and p_status = 'ano' then cur.ts
                  when cur.status = p_status then cur.ts
                  else clock_timestamp() end;
  insert into public.attendance (group_id, day, person_id, status, ts)
    values (g.id, p_day, p.id, p_status, keep_ts)
    on conflict (group_id, day, person_id) do update set status = excluded.status, ts = excluded.ts;
  return json_build_object('ok', true);
end $$;

create or replace function public.app_set_cash(p_slug text, p_day date, p_person bigint, p_pin text default null)
returns json language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  g := private.grp(p_slug);
  if p_person is not null then perform private.person(g, p_person); end if;
  if private.day_locked(g, p_day, p_pin) then return json_build_object('ok', false, 'error', 'locked'); end if;
  insert into public.day_meta (group_id, day, cash_person) values (g.id, p_day, p_person)
    on conflict (group_id, day) do update set cash_person = excluded.cash_person;
  return json_build_object('ok', true);
end $$;

-- ---------- přihlášení admina a správce (bez „první PIN vyhrává“) ----------
create or replace function public.app_admin_check(p_slug text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare g public.groups; ok boolean;
begin
  g := private.grp(p_slug, true);
  ok := private.is_admin(g, p_pin);
  return json_build_object('ok', ok, 'super', ok and private.is_super(p_pin));
end $$;

create or replace function public.super_check(p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if (select pin_hash from public.app_admin where id = 1) is null then
    return json_build_object('ok', false, 'error', 'no_pin');     -- PIN správce se nastavuje jen v SQL Editoru (viz README)
  end if;
  return json_build_object('ok', private.super_login(p_pin));
end $$;

create or replace function public.super_list(p_pin text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not private.super_login(p_pin) then return json_build_object('ok', false, 'error', 'pin'); end if;
  return json_build_object('ok', true,
    'email', (select email from public.app_admin where id = 1),
    'groups', coalesce((select json_agg(json_build_object('slug', slug, 'name', name, 'status', status,
       'admin_name', admin_name, 'admin_email', admin_email, 'created_at', created_at, 'cfg', cfg,
       'has_pin', admin_pin is not null) order by created_at desc)
       from public.groups where status <> 'rejected'), '[]'));
end $$;

create or replace function public.super_decide(p_pin text, p_slug text, p_approve boolean)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not private.super_login(p_pin) then return json_build_object('ok', false, 'error', 'pin'); end if;
  update public.groups set status = case when p_approve then 'active' else 'rejected' end
    where slug = p_slug and status = 'pending';
  return json_build_object('ok', true);
end $$;

create or replace function public.super_reset_pin(p_pin text, p_slug text, p_new text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not private.super_login(p_pin) then return json_build_object('ok', false, 'error', 'pin'); end if;
  perform private.check_pin_format(p_new);
  update public.groups set admin_pin = crypt(p_new, gen_salt('bf')) where slug = p_slug;
  delete from public.pin_attempts where key = 'grp:' || (select id from public.groups where slug = p_slug);
  return json_build_object('ok', true);
end $$;

create or replace function public.super_set_email(p_pin text, p_email text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not private.super_login(p_pin) then return json_build_object('ok', false, 'error', 'pin'); end if;
  update public.app_admin set email = nullif(trim(p_email),'') where id = 1;
  return json_build_object('ok', true);
end $$;

-- ---------- žádost o skupinu: e-mail žadatele je povinný ----------
create or replace function public.app_request_group(p_name text, p_cfg jsonb, p_admin_name text, p_admin_email text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare gid uuid; s text; pid bigint; mail text := lower(trim(coalesce(p_admin_email, '')));
begin
  perform private.check_pin_format(p_pin);
  if length(trim(coalesce(p_name,''))) < 2 or length(trim(coalesce(p_admin_name,''))) < 1 then raise exception 'Vyplňte název a jméno'; end if;
  if mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(mail) > 120 then
    raise exception 'Vyplňte platný e-mail, správce vám na něj odpoví';
  end if;
  if (select count(*) from public.groups where status = 'pending') >= 50 then raise exception 'Příliš mnoho čekajících žádostí'; end if;
  s := lower(substr(translate(encode(gen_random_bytes(12),'base64'),'+/=','xyz'),1,12));
  insert into public.groups (slug, name, status, cfg, admin_name, admin_email, admin_pin)
    values (s, trim(p_name), 'pending', coalesce(p_cfg,'{}'), trim(p_admin_name), mail, crypt(p_pin, gen_salt('bf')))
    returning id into gid;
  insert into public.people (group_id, name, kind) values (gid, trim(p_admin_name), 's') returning id into pid;
  update public.groups set admin_person = pid where id = gid;
  return json_build_object('ok', true, 'slug', s);
end $$;

-- ---------- nastavení skupiny: kontrola kapacity a IBANu, historie změn účtu ----------
create or replace function public.app_save_cfg(p_slug text, p_pin text, p_name text, p_cfg jsonb, p_admin_email text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  g public.groups; new_cfg jsonb; sup boolean; mail text;
  old_iban text; new_iban text; old_msg text; new_msg text;
begin
  g := private.grp(p_slug, true);
  if not private.is_admin(g, p_pin) then return json_build_object('ok', false, 'error', 'pin'); end if;
  sup := private.is_super(p_pin);
  new_cfg := coalesce(p_cfg, g.cfg);
  if length(new_cfg::text) > 20000 then raise exception 'Nastavení je příliš velké'; end if;
  if coalesce(new_cfg->>'cap', '') !~ '^[0-9]{1,3}$' or (new_cfg->>'cap')::int not between 1 and 200 then
    raise exception 'Kapacita musí být celé číslo od 1 do 200';
  end if;
  new_iban := upper(regexp_replace(coalesce(new_cfg->>'iban', ''), '\s', '', 'g'));
  if new_iban <> '' and not private.iban_ok(new_iban) then
    raise exception 'Číslo účtu (IBAN) není platné. Zkontrolujte ho, např. CZ65 0800 0000 1920 0014 5399.';
  end if;
  new_cfg := jsonb_set(new_cfg, '{iban}', to_jsonb(new_iban));
  old_iban := upper(regexp_replace(coalesce(g.cfg->>'iban', ''), '\s', '', 'g'));
  old_msg := coalesce(g.cfg->>'msg', ''); new_msg := coalesce(new_cfg->>'msg', '');
  if old_iban <> new_iban then
    insert into public.cfg_history (group_id, field, old_value, new_value, by_super) values (g.id, 'iban', old_iban, new_iban, sup);
  end if;
  if old_msg <> new_msg then
    insert into public.cfg_history (group_id, field, old_value, new_value, by_super) values (g.id, 'msg', old_msg, new_msg, sup);
  end if;
  mail := case when p_admin_email is null then g.admin_email else nullif(lower(trim(p_admin_email)), '') end;
  if mail is not null and (mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(mail) > 120) then
    raise exception 'E-mail admina není platný';
  end if;
  update public.groups set name = coalesce(nullif(trim(p_name),''), name), cfg = new_cfg, admin_email = mail where id = g.id;
  return json_build_object('ok', true);
end $$;

-- ---------- práva ----------
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.app_get(text), public.app_set_status(text,bigint,date,text,text), public.app_set_cash(text,date,bigint,text),
  public.app_admin_check(text,text), public.app_save_cfg(text,text,text,jsonb,text),
  public.app_request_group(text,jsonb,text,text,text),
  public.super_check(text), public.super_list(text), public.super_decide(text,text,boolean),
  public.super_reset_pin(text,text,text), public.super_set_email(text,text)
to anon, authenticated;
