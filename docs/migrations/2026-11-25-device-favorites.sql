-- Personal favorites for the release audience picker. Apply after device targeting.
begin;

create table if not exists public.ota_device_favorites (
  user_id uuid not null references public.ota_admin_users(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  target_kind text not null,
  target_id text not null,
  name text not null check (length(name) between 1 and 80 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  primary key (user_id, platform, target_kind, target_id),
  check ((target_kind = 'device' and target_id ~ '^[0-9a-f]{64}$')
      or (target_kind = 'installation' and target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
);

-- Preserve the bookmark when telemetry expires. Resolve against the full registry,
-- including installations outside the audience picker's recent-results window.
create or replace function public.ota_list_device_favorites(p_user uuid, p_platform text)
returns table(target_kind text, target_id text, name text, last_seen_at timestamptz)
language sql stable security invoker set search_path = public, pg_temp as $$
  select f.target_kind, f.target_id, f.name,
    case when f.target_kind = 'device' then (
      select max(s.last_seen_at) from public.ota_device_state s
      where s.platform = f.platform and s.device_id = f.target_id
    ) else (
      select s.last_seen_at from public.ota_device_state s
      where s.platform = f.platform and s.installation_id = f.target_id
    ) end
  from public.ota_device_favorites f
  where f.user_id = p_user and f.platform = p_platform
  order by lower(f.name), f.target_kind, f.target_id
$$;

alter table public.ota_device_favorites enable row level security;
revoke all on public.ota_device_favorites from public;
revoke all on function public.ota_list_device_favorites(uuid, text) from public;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = role_name) then
      execute format('revoke all on public.ota_device_favorites from %I', role_name);
      execute format('revoke all on function public.ota_list_device_favorites(uuid, text) from %I', role_name);
    end if;
  end loop;
  if exists (select from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.ota_device_favorites to service_role;
    grant execute on function public.ota_list_device_favorites(uuid, text) to service_role;
    drop policy if exists ota_device_favorites_service on public.ota_device_favorites;
    create policy ota_device_favorites_service on public.ota_device_favorites
      to service_role using (true) with check (true);
  end if;
end $$;
commit;
