-- Apply after 2026-10-19-device-heartbeat.sql. Safe to reapply.
-- Existing last_seen_at and transitions cannot reconstruct daily activity.
-- Collection starts here; there is intentionally no historical backfill.
begin;

create table if not exists public.ota_device_analytics_metadata (
  singleton boolean primary key default true check (singleton),
  collection_started_at timestamptz not null,
  last_pruned_on date not null
);

create table if not exists public.ota_device_activity_daily (
  activity_date date not null,
  installation_id text not null,
  platform text not null check (platform in ('ios', 'android')),
  channel text not null,
  runtime_version text not null,
  launch_kind text not null check (launch_kind in ('ota', 'embedded', 'unknown')),
  native_version text,
  native_build text,
  reported_update_id uuid,
  resolved_update_id uuid,
  emergency_launch boolean not null,
  first_received_at timestamptz not null,
  last_received_at timestamptz not null,
  primary key (activity_date, installation_id, platform)
);
create index if not exists idx_ota_device_activity_installation
  on public.ota_device_activity_daily(installation_id, platform, activity_date);

-- Only installations whose first instrumented heartbeat arrives after collection
-- starts enter retention cohorts. Existing installations still count as active.
-- Entry dimensions never change when an installation later changes channel/runtime.
create table if not exists public.ota_device_activity_cohorts (
  installation_id text not null,
  platform text not null check (platform in ('ios', 'android')),
  first_observed_at timestamptz not null,
  channel text not null,
  runtime_version text not null,
  launch_kind text not null check (launch_kind in ('ota', 'embedded', 'unknown')),
  primary key (installation_id, platform)
);
create index if not exists idx_ota_device_activity_cohort_date
  on public.ota_device_activity_cohorts(first_observed_at);

-- Callable by a scheduler; heartbeat also invokes it. Only the first successful
-- call each UTC day deletes expired rows. Subsequent calls perform no table scan.
create or replace function public.ota_prune_device_activity()
returns void language plpgsql set search_path = public as $$
declare
  today date := (clock_timestamp() at time zone 'UTC')::date;
begin
  update public.ota_device_analytics_metadata set last_pruned_on = today
   where singleton and last_pruned_on < today;
  if not found then return; end if;
  delete from public.ota_device_activity_daily where activity_date < today - 89;
  delete from public.ota_device_activity_cohorts
   where first_observed_at < ((today - 89)::timestamp at time zone 'UTC');
end $$;

create or replace function public.ota_capture_device_activity()
returns trigger language plpgsql set search_path = public as $$
declare
  previous_sequence bigint := 0;
  receipt_day date := (new.last_seen_at at time zone 'UTC')::date;
begin
  if tg_op = 'UPDATE' then previous_sequence := old.last_sequence; end if;
  -- FK cleanup, ordinary edits, rejected retries, and registration placeholders
  -- must never manufacture another day of activity.
  if new.last_sequence <= previous_sequence then return new; end if;
  perform public.ota_prune_device_activity();
  if previous_sequence = 0 then
    insert into public.ota_device_activity_cohorts
      (installation_id, platform, first_observed_at, channel, runtime_version, launch_kind)
    values (new.installation_id, new.platform, new.last_seen_at, new.channel, new.runtime_version, new.launch_kind)
    on conflict (installation_id, platform) do nothing;
  end if;
  insert into public.ota_device_activity_daily
    (activity_date, installation_id, platform, channel, runtime_version, launch_kind,
     native_version, native_build, reported_update_id, resolved_update_id, emergency_launch,
     first_received_at, last_received_at)
  values
    (receipt_day, new.installation_id, new.platform, new.channel, new.runtime_version, new.launch_kind,
     new.native_version, new.native_build, new.reported_update_id, new.resolved_update_id, new.emergency_launch,
     new.last_seen_at, new.last_seen_at)
  on conflict (activity_date, installation_id, platform) do update set
    channel = excluded.channel, runtime_version = excluded.runtime_version, launch_kind = excluded.launch_kind,
    native_version = excluded.native_version, native_build = excluded.native_build,
    reported_update_id = excluded.reported_update_id, resolved_update_id = excluded.resolved_update_id,
    emergency_launch = excluded.emergency_launch, last_received_at = excluded.last_received_at;
  return new;
end $$;

drop trigger if exists trg_ota_capture_device_activity on public.ota_device_state;
create trigger trg_ota_capture_device_activity after insert or update on public.ota_device_state
for each row execute function public.ota_capture_device_activity();

insert into public.ota_device_analytics_metadata(singleton, collection_started_at, last_pruned_on)
values (true, clock_timestamp(), (clock_timestamp() at time zone 'UTC')::date)
on conflict (singleton) do nothing;

-- Keep the original five-argument report RPC intact for older consumers.
-- One SQL statement gives every chart and the device page a consistent snapshot.
create or replace function public.ota_devices_report_v2(
  p_days integer default 7, p_platform text default null, p_channel text default null,
  p_runtime text default null, p_offset integer default 0,
  p_launch_kind text default null, p_search text default null)
returns table(report jsonb) language sql stable set search_path = public as $$
  with parameters as (
    select (now() at time zone 'UTC')::date as today,
      (now() at time zone 'UTC')::date - (p_days - 1) as first_day,
      now() - make_interval(days => p_days) as window_start,
      m.collection_started_at,
      greatest((m.collection_started_at at time zone 'UTC')::date,
        (now() at time zone 'UTC')::date - 89) as retained_from
    from public.ota_device_analytics_metadata m where singleton
  ), recent as (
    select s.* from public.ota_device_state s, parameters p
    where s.last_sequence > 0 and s.last_seen_at >= p.window_start
  ), filtered as (
    select * from recent
    where (p_platform is null or platform = p_platform)
      and (p_channel is null or channel = p_channel)
      and (p_runtime is null or runtime_version = p_runtime)
      and (p_launch_kind is null or launch_kind = p_launch_kind)
      and (p_search is null or position(lower(p_search) in lower(installation_id)) > 0)
  ), versions as (
    select platform, channel, runtime_version, native_version, native_build, launch_kind,
      coalesce(resolved_update_id, reported_update_id) as update_id,
      max(update_label) as update_label, count(*) as installations
    from filtered group by platform, channel, runtime_version, native_version, native_build,
      launch_kind, coalesce(resolved_update_id, reported_update_id)
  ), page as (
    select * from filtered order by last_seen_at desc, installation_id, platform limit 50 offset p_offset
  ), daily as (
    select d.* from public.ota_device_activity_daily d, parameters p
    where d.activity_date between greatest(p.first_day, p.retained_from) and p.today
  ), filtered_daily as (
    select d.* from daily d
    where (p_platform is null or d.platform = p_platform)
      and (p_channel is null or d.channel = p_channel)
      and (p_runtime is null or d.runtime_version = p_runtime)
      and (p_launch_kind is null or d.launch_kind = p_launch_kind)
      and (p_search is null or position(lower(p_search) in lower(d.installation_id)) > 0)
  ), calendar as (
    select p.first_day + n as date,
      case when p.first_day + n < p.retained_from then 'unavailable'
        when p.first_day + n = p.today
          or ((p.first_day + n)::timestamp at time zone 'UTC') < p.collection_started_at then 'partial'
        else 'complete' end as coverage
    from parameters p cross join generate_series(0, p_days - 1) n
  ), day_counts as (
    select d.activity_date, count(*) as active,
      count(*) filter (where (c.first_observed_at at time zone 'UTC')::date = d.activity_date) as newly_observed
    from filtered_daily d left join public.ota_device_activity_cohorts c
      on c.installation_id = d.installation_id and c.platform = d.platform
    group by d.activity_date
  ), activity as (
    select c.date, c.coverage,
      case when c.coverage <> 'unavailable' then coalesce(d.active, 0) end as active,
      case when c.coverage <> 'unavailable' then coalesce(d.newly_observed, 0) end as newly_observed
    from calendar c left join day_counts d on c.date = d.activity_date
  ), cohort_source as (
    select c.*, (c.first_observed_at at time zone 'UTC')::date as first_day,
      date_trunc('week', c.first_observed_at at time zone 'UTC')::date as week_start
    from public.ota_device_activity_cohorts c, parameters p
    where c.first_observed_at >= p.collection_started_at
      and (c.first_observed_at at time zone 'UTC')::date between p.retained_from and p.today
  ), cohort_members as (
    select * from cohort_source
    where (p_platform is null or platform = p_platform)
      and (p_channel is null or channel = p_channel)
      and (p_runtime is null or runtime_version = p_runtime)
      and (p_launch_kind is null or launch_kind = p_launch_kind)
      and (p_search is null or position(lower(p_search) in lower(installation_id)) > 0)
  ), cohort_sizes as (
    select week_start, count(*) as installations from cohort_members group by week_start
  ), retention_members as (
    select c.week_start, n.day,
      (n.day = 0 or c.first_day + n.day < p.today) as eligible,
      exists (select 1 from public.ota_device_activity_daily d
        where d.installation_id = c.installation_id and d.platform = c.platform
          and d.activity_date = c.first_day + n.day) as returned
    from cohort_members c cross join (values (0), (1), (7), (14), (30)) n(day)
      cross join parameters p
  ), retention_counts as (
    select week_start, day, count(*) filter (where eligible) as eligible,
      count(*) filter (where eligible and returned) as retained
    from retention_members group by week_start, day
  ), retention_rows as (
    select c.week_start, c.installations,
      jsonb_agg(jsonb_build_object('day', r.day, 'eligibleInstallations', r.eligible,
        'retainedInstallations', case when r.eligible > 0 then r.retained end,
        'rate', case when r.eligible > 0 then r.retained::numeric / r.eligible end) order by r.day) as cells
    from cohort_sizes c join retention_counts r using (week_start) group by c.week_start, c.installations
  ), adoption as (
    select date_trunc('week', first_seen_at at time zone 'UTC')::date as week_start,
      count(*) as installations,
      count(*) filter (where launch_kind = 'ota') as ota,
      count(*) filter (where launch_kind = 'embedded') as embedded,
      count(*) filter (where launch_kind = 'unknown') as unknown
    from filtered group by date_trunc('week', first_seen_at at time zone 'UTC')::date
  ), option_source as (
    select platform, channel, runtime_version, launch_kind from recent
    union select platform, channel, runtime_version, launch_kind from daily
    union select platform, channel, runtime_version, launch_kind from cohort_source
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered), 'pageSize', 50, 'offset', p_offset,
    'devices', coalesce((select jsonb_agg(to_jsonb(page) order by last_seen_at desc, installation_id, platform) from page), '[]'::jsonb),
    'versions', coalesce((select jsonb_agg(to_jsonb(versions) order by installations desc, platform, channel, runtime_version,
      native_version, native_build, launch_kind, update_id) from versions), '[]'::jsonb),
    'filters', jsonb_build_object('days', p_days, 'platform', p_platform, 'channel', p_channel,
      'runtime', p_runtime, 'launchKind', p_launch_kind, 'search', p_search),
    'options', jsonb_build_object(
      'platforms', coalesce((select jsonb_agg(v order by v) from (select distinct platform as v from option_source) t), '[]'::jsonb),
      'channels', coalesce((select jsonb_agg(v order by v) from (select distinct channel as v from option_source) t), '[]'::jsonb),
      'runtimes', coalesce((select jsonb_agg(v order by v) from (select distinct runtime_version as v from option_source) t), '[]'::jsonb),
      'launchKinds', coalesce((select jsonb_agg(v order by v) from (select distinct launch_kind as v from option_source) t), '[]'::jsonb)),
    'summary', (select jsonb_build_object('activeInstallations', count(*),
      'newInstallations', count(*) filter (where first_seen_at >= (select window_start from parameters)),
      'otaInstallations', count(*) filter (where launch_kind = 'ota'),
      'embeddedInstallations', count(*) filter (where launch_kind = 'embedded'),
      'unknownInstallations', count(*) filter (where launch_kind = 'unknown'),
      'emergencyInstallations', count(*) filter (where emergency_launch),
      'reportedVersions', (select count(*) from versions)) from filtered),
    'activity', coalesce((select jsonb_agg(jsonb_build_object('date', date, 'activeInstallations', active,
      'newInstallations', newly_observed, 'coverage', coverage) order by date) from activity), '[]'::jsonb),
    'adoptionCohorts', coalesce((select jsonb_agg(jsonb_build_object('weekStart', week_start, 'installations', installations,
      'otaInstallations', ota, 'embeddedInstallations', embedded, 'unknownInstallations', unknown) order by week_start) from adoption), '[]'::jsonb),
    'cohorts', coalesce((select jsonb_agg(jsonb_build_object('weekStart', week_start, 'installations', installations,
      'cells', cells) order by week_start) from retention_rows), '[]'::jsonb),
    'coverage', (select jsonb_build_object('collectionStartedAt', collection_started_at, 'retainedFrom', retained_from,
      'timezone', 'UTC', 'retentionDays', 90, 'cohortWindowDays', 90, 'activityBasis', 'accepted-heartbeat-receipt',
      'cohortBasis', 'first-recorded-heartbeat', 'cohortFilters', 'entry-state', 'todayIsPartial', true,
      'generatedAt', now(), 'windowStartedAt', window_start) from parameters)
  );
$$;

alter table public.ota_device_analytics_metadata enable row level security;
alter table public.ota_device_activity_daily enable row level security;
alter table public.ota_device_activity_cohorts enable row level security;
revoke all on public.ota_device_analytics_metadata, public.ota_device_activity_daily, public.ota_device_activity_cohorts from public;
revoke all on function public.ota_prune_device_activity() from public;
revoke all on function public.ota_capture_device_activity() from public;
revoke all on function public.ota_devices_report_v2(integer,text,text,text,integer,text,text) from public;
do $$ declare role_name text; begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists(select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on public.ota_device_analytics_metadata, public.ota_device_activity_daily, public.ota_device_activity_cohorts from %I', role_name);
      execute format('revoke all on function public.ota_prune_device_activity() from %I', role_name);
      execute format('revoke all on function public.ota_capture_device_activity() from %I', role_name);
      execute format('revoke all on function public.ota_devices_report_v2(integer,text,text,text,integer,text,text) from %I', role_name);
    end if;
  end loop;
  if exists(select 1 from pg_roles where rolname = 'service_role') then
    grant select, update on public.ota_device_analytics_metadata to service_role;
    grant select, insert, update, delete on public.ota_device_activity_daily, public.ota_device_activity_cohorts to service_role;
    grant execute on function public.ota_prune_device_activity() to service_role;
    grant execute on function public.ota_capture_device_activity() to service_role;
    grant execute on function public.ota_devices_report_v2(integer,text,text,text,integer,text,text) to service_role;
  end if;
end $$;
commit;
