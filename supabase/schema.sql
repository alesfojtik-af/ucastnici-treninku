-- Beach úterky / Domluvy: databáze pro Supabase.
-- Spusťte celý soubor v Supabase → SQL Editor. Lze spustit opakovaně (funkce se přepíšou, data zůstanou).
--
-- Bezpečnostní model: tabulky nejsou z webu přímo čitelné (RLS bez politik).
-- Aplikace volá jen funkce níže. Kdo zná odkaz skupiny (náhodný slug), může ji číst
-- a měnit docházku i lidi. Nastavení, platby předplatného a schvalování chrání PIN.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

-- ---------- tabulky ----------
create table if not exists public.app_admin (
  id int primary key default 1 check (id = 1),
  pin_hash text,
  email text
);
insert into public.app_admin (id) values (1) on conflict do nothing;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  status text not null default 'pending' check (status in ('pending','active','rejected')),
  cfg jsonb not null default '{}'::jsonb,
  admin_name text,
  admin_email text,
  admin_pin text,
  admin_person bigint,
  created_at timestamptz not null default now()
);

create table if not exists public.people (
  id bigserial primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  kind char(1) not null default 'z' check (kind in ('s','z')),
  paid boolean not null default false,
  email text,
  avatar int,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists people_group on public.people(group_id);

create table if not exists public.attendance (
  group_id uuid not null references public.groups(id) on delete cascade,
  day date not null,
  person_id bigint not null references public.people(id) on delete cascade,
  status text not null check (status in ('ano','ne','chci')),
  ts timestamptz not null default clock_timestamp(),
  primary key (group_id, day, person_id)
);

create table if not exists public.day_meta (
  group_id uuid not null references public.groups(id) on delete cascade,
  day date not null,
  cash_person bigint references public.people(id) on delete set null,
  primary key (group_id, day)
);

alter table public.app_admin  enable row level security;
alter table public.groups     enable row level security;
alter table public.people     enable row level security;
alter table public.attendance enable row level security;
alter table public.day_meta   enable row level security;

-- ---------- pomocné (nejsou vystavené přes API) ----------
create or replace function private.grp(p_slug text, p_lock boolean default false)
returns public.groups language plpgsql security definer set search_path = public, extensions as $$
declare g public.groups;
begin
  if p_lock then
    select * into g from public.groups where slug = p_slug and status = 'active' for update;
  else
    select * into g from public.groups where slug = p_slug and status = 'active';
  end if;
  if g.id is null then raise exception 'Skupina nenalezena' using errcode = 'P0002'; end if;
  return g;
end $$;

create or replace function private.is_super(p_pin text)
returns boolean language sql security definer set search_path = public, extensions as $$
  select coalesce(p_pin is not null and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash), false)
  from public.app_admin where id = 1
$$;

create or replace function private.is_admin(g public.groups, p_pin text)
returns boolean language sql security definer set search_path = public, extensions as $$
  select private.is_super(p_pin)
      or coalesce(p_pin is not null and g.admin_pin is not null and g.admin_pin = crypt(p_pin, g.admin_pin), false)
$$;

create or replace function private.check_pin_format(p_pin text)
returns void language plpgsql as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then raise exception 'PIN musí mít 4 až 8 číslic'; end if;
end $$;

create or replace function private.person(g public.groups, p_person bigint)
returns public.people language plpgsql security definer set search_path = public as $$
declare p public.people;
begin
  select * into p from public.people where id = p_person and group_id = g.id;
  if p.id is null then raise exception 'Hráč nenalezen'; end if;
  return p;
end $$;

-- ---------- čtení ----------
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
              'admin_person', g.admin_person, 'admin_name', g.admin_name, 'has_pin', g.admin_pin is not null),
    'people', coalesce((select json_agg(json_build_object('id', id, 'n', name, 'g', kind, 'paid', paid,
              'email', email, 'av', avatar, 'active', active) order by id)
              from public.people where group_id = g.id), '[]'),
    'att', coalesce((select json_agg(json_build_object('d', day, 'p', person_id, 'st', status, 'ts', ts))
              from public.attendance where group_id = g.id), '[]'),
    'days', coalesce((select json_agg(json_build_object('d', day, 'cash', cash_person))
              from public.day_meta where group_id = g.id), '[]')
  );
end $$;

-- ---------- docházka (pravidla kapacity a pořadí hlídá server) ----------
create or replace function public.app_set_status(p_slug text, p_person bigint, p_day date, p_status text)
returns json language plpgsql security definer set search_path = public as $$
declare
  g public.groups; p public.people; cur public.attendance;
  cap int; n int; free int; ahead int; first_name text; start_at timestamptz; keep_ts timestamptz;
begin
  g := private.grp(p_slug, true);            -- zámek skupiny = kdo dřív přijde, ten dřív mele
  p := private.person(g, p_person);
  if not p.active then raise exception 'Hráč byl odebrán'; end if;
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

create or replace function public.app_set_cash(p_slug text, p_day date, p_person bigint)
returns json language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  g := private.grp(p_slug);
  if p_person is not null then perform private.person(g, p_person); end if;
  insert into public.day_meta (group_id, day, cash_person) values (g.id, p_day, p_person)
    on conflict (group_id, day) do update set cash_person = excluded.cash_person;
  return json_build_object('ok', true);
end $$;

-- ---------- lidé (smí kdokoli s odkazem) ----------
create or replace function public.app_add_person(p_slug text, p_name text, p_kind text, p_email text)
returns json language plpgsql security definer set search_path = public as $$
declare g public.groups; nid bigint;
begin
  g := private.grp(p_slug);
  if (select count(*) from public.people where group_id = g.id and active) >= 200 then raise exception 'Příliš mnoho lidí'; end if;
  insert into public.people (group_id, name, kind, email)
    values (g.id, trim(p_name), coalesce(p_kind,'z'), nullif(trim(coalesce(p_email,'')),'')) returning id into nid;
  return json_build_object('ok', true, 'id', nid);
end $$;

create or replace function public.app_update_person(p_slug text, p_person bigint, p_patch jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare g public.groups; p public.people;
begin
  g := private.grp(p_slug);
  p := private.person(g, p_person);
  update public.people set
    name   = coalesce(nullif(trim(p_patch->>'n'),''), name),
    kind   = coalesce(p_patch->>'g', kind),
    email  = case when p_patch ? 'email' then nullif(trim(coalesce(p_patch->>'email','')),'') else email end,
    avatar = case when p_patch ? 'av' then (p_patch->>'av')::int else avatar end,
    active = coalesce((p_patch->>'active')::boolean, active)
  where id = p.id;
  return json_build_object('ok', true);
end $$;

-- ---------- admin skupiny ----------
create or replace function public.app_admin_check(p_slug text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare g public.groups;
begin
  g := private.grp(p_slug, true);
  if g.admin_pin is null and not private.is_super(p_pin) then
    perform private.check_pin_format(p_pin);         -- první přihlášení admina nastaví PIN
    update public.groups set admin_pin = crypt(p_pin, gen_salt('bf')) where id = g.id;
    return json_build_object('ok', true, 'created', true, 'super', false);
  end if;
  return json_build_object('ok', private.is_admin(g, p_pin), 'super', private.is_super(p_pin));
end $$;

create or replace function public.app_save_cfg(p_slug text, p_pin text, p_name text, p_cfg jsonb, p_admin_email text)
returns json language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  g := private.grp(p_slug, true);
  if not private.is_admin(g, p_pin) then return json_build_object('ok', false, 'error', 'pin'); end if;
  update public.groups set name = coalesce(nullif(trim(p_name),''), name), cfg = coalesce(p_cfg, cfg),
    admin_email = coalesce(p_admin_email, admin_email) where id = g.id;
  return json_build_object('ok', true);
end $$;

create or replace function public.app_set_paid(p_slug text, p_pin text, p_person bigint, p_paid boolean)
returns json language plpgsql security definer set search_path = public as $$
declare g public.groups; p public.people;
begin
  g := private.grp(p_slug);
  if not private.is_admin(g, p_pin) then return json_build_object('ok', false, 'error', 'pin'); end if;
  p := private.person(g, p_person);
  update public.people set paid = p_paid where id = p.id;
  return json_build_object('ok', true);
end $$;

create or replace function public.app_change_pin(p_slug text, p_pin text, p_new text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare g public.groups;
begin
  g := private.grp(p_slug, true);
  if not private.is_admin(g, p_pin) then return json_build_object('ok', false, 'error', 'pin'); end if;
  perform private.check_pin_format(p_new);
  update public.groups set admin_pin = crypt(p_new, gen_salt('bf')) where id = g.id;
  return json_build_object('ok', true);
end $$;

-- ---------- žádost o novou skupinu ----------
create or replace function public.app_request_group(p_name text, p_cfg jsonb, p_admin_name text, p_admin_email text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare gid uuid; s text; pid bigint;
begin
  perform private.check_pin_format(p_pin);
  if length(trim(coalesce(p_name,''))) < 2 or length(trim(coalesce(p_admin_name,''))) < 1 then raise exception 'Vyplňte název a jméno'; end if;
  if (select count(*) from public.groups where status = 'pending') >= 50 then raise exception 'Příliš mnoho čekajících žádostí'; end if;
  s := lower(substr(translate(encode(gen_random_bytes(12),'base64'),'+/=','xyz'),1,12));
  insert into public.groups (slug, name, status, cfg, admin_name, admin_email, admin_pin)
    values (s, trim(p_name), 'pending', coalesce(p_cfg,'{}'), trim(p_admin_name), p_admin_email, crypt(p_pin, gen_salt('bf')))
    returning id into gid;
  insert into public.people (group_id, name, kind) values (gid, trim(p_admin_name), 's') returning id into pid;
  update public.groups set admin_person = pid where id = gid;
  return json_build_object('ok', true, 'slug', s);
end $$;

-- ---------- správce aplikace (superadmin) ----------
create or replace function public.super_check(p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if (select pin_hash from public.app_admin where id = 1) is null then
    perform private.check_pin_format(p_pin);         -- první přihlášení nastaví PIN správce
    update public.app_admin set pin_hash = crypt(p_pin, gen_salt('bf')) where id = 1;
    return json_build_object('ok', true, 'created', true);
  end if;
  return json_build_object('ok', private.is_super(p_pin));
end $$;

create or replace function public.super_list(p_pin text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not private.is_super(p_pin) then return json_build_object('ok', false, 'error', 'pin'); end if;
  return json_build_object('ok', true,
    'email', (select email from public.app_admin where id = 1),
    'groups', coalesce((select json_agg(json_build_object('slug', slug, 'name', name, 'status', status,
       'admin_name', admin_name, 'admin_email', admin_email, 'created_at', created_at, 'cfg', cfg) order by created_at desc)
       from public.groups where status <> 'rejected'), '[]'));
end $$;

create or replace function public.super_decide(p_pin text, p_slug text, p_approve boolean)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not private.is_super(p_pin) then return json_build_object('ok', false, 'error', 'pin'); end if;
  update public.groups set status = case when p_approve then 'active' else 'rejected' end
    where slug = p_slug and status = 'pending';
  return json_build_object('ok', true);
end $$;

create or replace function public.super_reset_pin(p_pin text, p_slug text, p_new text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if not private.is_super(p_pin) then return json_build_object('ok', false, 'error', 'pin'); end if;
  perform private.check_pin_format(p_new);
  update public.groups set admin_pin = crypt(p_new, gen_salt('bf')) where slug = p_slug;
  return json_build_object('ok', true);
end $$;

create or replace function public.super_set_email(p_pin text, p_email text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not private.is_super(p_pin) then return json_build_object('ok', false, 'error', 'pin'); end if;
  update public.app_admin set email = nullif(trim(p_email),'') where id = 1;
  return json_build_object('ok', true);
end $$;

-- ---------- práva ----------
revoke all on schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.app_get(text), public.app_set_status(text,bigint,date,text), public.app_set_cash(text,date,bigint),
  public.app_add_person(text,text,text,text), public.app_update_person(text,bigint,jsonb),
  public.app_admin_check(text,text), public.app_save_cfg(text,text,text,jsonb,text),
  public.app_set_paid(text,text,bigint,boolean), public.app_change_pin(text,text,text),
  public.app_request_group(text,jsonb,text,text,text),
  public.super_check(text), public.super_list(text), public.super_decide(text,text,boolean),
  public.super_reset_pin(text,text,text), public.super_set_email(text,text)
to anon, authenticated;

-- ---------- zprávy do WhatsAppu (stejné jako migrations/002-zpravy.sql) ----------
create table if not exists public.wa_log (
  id bigserial primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('status','changes','pay')),
  action text not null check (action in ('sent','ignored')),
  person_id bigint references public.people(id) on delete set null,
  snapshot jsonb,              -- stav přihlášek v okamžiku odeslání (osoba -> ano/ne/chci), základ pro „Změny“
  at timestamptz not null default now()
);
create index if not exists wa_log_group_day on public.wa_log(group_id, day);
alter table public.wa_log enable row level security;

-- Co už bylo odesláno nebo ignorováno (posledních 60 dní).
create or replace function public.app_wa_get(p_slug text)
returns json language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  g := private.grp(p_slug);
  return coalesce((select json_agg(json_build_object('d', day, 'k', kind, 'a', action, 'p', person_id, 's', snapshot, 'at', at) order by at)
    from public.wa_log where group_id = g.id and day >= current_date - 60), '[]'::json);
end $$;

-- Označení zprávy: odeslat smí kdokoli s odkazem, ignorovat jen admin (PIN).
create or replace function public.app_wa_mark(p_slug text, p_day date, p_kind text, p_action text, p_person bigint, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare g public.groups; snap jsonb;
begin
  g := private.grp(p_slug, true);
  if p_kind not in ('status','changes','pay') or p_action not in ('sent','ignored') then raise exception 'Neplatná zpráva'; end if;
  if p_action = 'ignored' and not private.is_admin(g, p_pin) then return json_build_object('ok', false, 'error', 'pin'); end if;
  if p_person is not null then perform private.person(g, p_person); end if;
  if p_kind <> 'changes' and exists (select 1 from public.wa_log where group_id = g.id and day = p_day and kind = p_kind) then
    return json_build_object('ok', false, 'error', 'done');
  end if;
  select coalesce(jsonb_object_agg(person_id::text, status), '{}'::jsonb) into snap
    from public.attendance where group_id = g.id and day = p_day;
  insert into public.wa_log (group_id, day, kind, action, person_id, snapshot) values (g.id, p_day, p_kind, p_action, p_person, snap);
  return json_build_object('ok', true);
end $$;

grant execute on function public.app_wa_get(text), public.app_wa_mark(text,date,text,text,bigint,text) to anon, authenticated;
