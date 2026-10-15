-- Migrace 002: zprávy do WhatsApp skupiny (záložka Zprávy).
-- Jen PŘIDÁVÁ novou tabulku a dvě funkce. Stávající tabulky ani data nemění. Lze spustit opakovaně.

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
