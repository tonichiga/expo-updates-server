-- Apply after schema.sql (including manifest identity). Safe to reapply.
begin;
alter table public.ota_device_state
  add column if not exists reported_update_id uuid,
  add column if not exists resolved_update_id uuid,
  add column if not exists update_label text,
  add column if not exists launch_kind text not null default 'unknown' check (launch_kind in ('embedded','ota','unknown')),
  add column if not exists native_version text,
  add column if not exists native_build text,
  add column if not exists emergency_launch boolean not null default false,
  add column if not exists observed_at timestamptz,
  add column if not exists last_event_id uuid,
  add column if not exists last_sequence bigint not null default 0 check (last_sequence between 0 and 9007199254740991);
alter table public.ota_device_transitions
  add column if not exists event_id uuid,
  add column if not exists before_state jsonb,
  add column if not exists after_state jsonb;
create index if not exists idx_ota_device_state_seen on public.ota_device_state(last_seen_at desc, installation_id, platform);

-- Invoker privileges only; the application backend is the sole database caller.
create or replace function public.ota_record_heartbeat(p_event jsonb)
returns table(result text) language plpgsql set search_path = public as $$
declare
  previous public.ota_device_state%rowtype;
  artifact uuid;
  label text;
  kind text;
  before_version jsonb;
  after_version jsonb;
  seq bigint := (p_event->>'sequence')::bigint;
  reported uuid := (p_event->>'updateId')::uuid;
  receipt timestamptz;
begin
  if seq < 1 or seq > 9007199254740991 then raise exception 'INVALID_SEQUENCE'; end if;
  insert into public.ota_device_state(installation_id,platform,runtime_version,channel)
  values(p_event->>'installationId',p_event->>'platform',p_event->>'runtimeVersion',p_event->>'channel')
  on conflict (installation_id,platform) do nothing;
  select * into strict previous from public.ota_device_state
  where installation_id=p_event->>'installationId' and platform=p_event->>'platform' for update;
  if seq < previous.last_sequence then return query select 'stale'::text; return; end if;
  if seq = previous.last_sequence then
    if previous.last_event_id = (p_event->>'eventId')::uuid then
      return query select 'duplicate'::text; return;
    end if;
    raise exception 'HEARTBEAT_SEQUENCE_CONFLICT';
  end if;
  receipt := greatest(previous.last_seen_at, clock_timestamp());
  kind := case when (p_event->>'isEmbeddedLaunch')::boolean then 'embedded' else 'unknown' end;
  if kind <> 'embedded' and reported is not null then
    select u.update_id,u.comment into artifact,label from public.ota_updates u
    where u.runtime_version=p_event->>'runtimeVersion' and u.channel=p_event->>'channel' and u.platform=p_event->>'platform'
      and (u.update_id=reported or exists(select 1 from public.ota_served_manifest_log m
        where m.served_manifest_id=reported and m.update_id=u.update_id and m.runtime_version=u.runtime_version
          and m.channel=u.channel and m.platform=u.platform))
    order by (u.update_id=reported) asc limit 1;
    if artifact is null and previous.launch_kind='ota' and previous.reported_update_id=reported
       and previous.runtime_version=p_event->>'runtimeVersion' and previous.channel=p_event->>'channel' then
      artifact := previous.resolved_update_id; label := previous.update_label;
    end if;
    if artifact is not null then kind := 'ota'; end if;
  end if;
  before_version := jsonb_build_object('runtime',previous.runtime_version,'channel',previous.channel,
    'nativeVersion',previous.native_version,'nativeBuild',previous.native_build,'kind',previous.launch_kind,
    'updateId',coalesce(previous.resolved_update_id,previous.reported_update_id));
  after_version := jsonb_build_object('runtime',p_event->>'runtimeVersion','channel',p_event->>'channel',
    'nativeVersion',p_event->>'nativeVersion','nativeBuild',p_event->>'nativeBuild','kind',kind,
    'updateId',coalesce(artifact,reported));
  update public.ota_device_state set
    runtime_version=p_event->>'runtimeVersion',channel=p_event->>'channel',
    embedded_update_id=case when kind='embedded' then reported else previous.embedded_update_id end,
    current_update_id=(select update_id from public.ota_updates where update_id=artifact),
    served_manifest_id=case when kind<>'embedded' then reported end,
    reported_update_id=reported,resolved_update_id=artifact,update_label=label,launch_kind=kind,
    native_version=p_event->>'nativeVersion',native_build=p_event->>'nativeBuild',
    emergency_launch=(p_event->>'isEmergencyLaunch')::boolean,observed_at=(p_event->>'observedAt')::timestamptz,
    last_event_id=(p_event->>'eventId')::uuid,last_sequence=seq,last_seen_at=receipt
  where installation_id=previous.installation_id and platform=previous.platform;
  if previous.last_sequence=0 or before_version is distinct from after_version then
    insert into public.ota_device_transitions(installation_id,platform,from_runtime,from_update_id,to_runtime,to_update_id,
      transition_type,occurred_at,event_id,before_state,after_state)
    values(previous.installation_id,previous.platform,case when previous.last_sequence>0 then previous.runtime_version end,
      previous.resolved_update_id,p_event->>'runtimeVersion',artifact,
      case when previous.last_sequence=0 then 'first_seen' else 'version_changed' end,receipt,
      (p_event->>'eventId')::uuid,case when previous.last_sequence>0 then before_version end,after_version);
  end if;
  return query select 'accepted'::text;
end $$;

-- One statement gives the page and version distribution the same database snapshot.
create or replace function public.ota_devices_report(p_days integer default 7, p_platform text default null,
  p_channel text default null, p_runtime text default null, p_offset integer default 0)
returns table(report jsonb) language sql stable set search_path=public as $$
  with filtered as (
    select * from public.ota_device_state where last_sequence>0
      and last_seen_at >= now() - make_interval(days => p_days)
      and (p_platform is null or platform=p_platform)
      and (p_channel is null or channel=p_channel)
      and (p_runtime is null or runtime_version=p_runtime)
  ), versions as (
    select platform,channel,runtime_version,native_version,native_build,launch_kind,
      coalesce(resolved_update_id,reported_update_id) as update_id,max(update_label) as update_label,count(*) as installations
    from filtered group by platform,channel,runtime_version,native_version,native_build,launch_kind,
      coalesce(resolved_update_id,reported_update_id)
  ), page as (select * from filtered order by last_seen_at desc,installation_id,platform limit 50 offset p_offset)
  select jsonb_build_object('total',(select count(*) from filtered),'pageSize',50,
    'devices',coalesce((select jsonb_agg(to_jsonb(page) order by last_seen_at desc,installation_id,platform) from page),'[]'::jsonb),
    'versions',coalesce((select jsonb_agg(to_jsonb(versions) order by installations desc,platform,channel,runtime_version,update_id) from versions),'[]'::jsonb));
$$;

alter table public.ota_device_state enable row level security;
alter table public.ota_device_transitions enable row level security;
revoke all on public.ota_device_state, public.ota_device_transitions from public;
revoke all on function public.ota_record_heartbeat(jsonb) from public;
revoke all on function public.ota_devices_report(integer,text,text,text,integer) from public;
do $$ declare role_name text; begin
  foreach role_name in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on public.ota_device_state, public.ota_device_transitions from %I',role_name);
      execute format('revoke all on sequence public.ota_device_transitions_id_seq from %I',role_name);
      execute format('revoke all on function public.ota_record_heartbeat(jsonb) from %I',role_name);
      execute format('revoke all on function public.ota_devices_report(integer,text,text,text,integer) from %I',role_name);
    end if;
  end loop;
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant select,insert,update on public.ota_device_state, public.ota_device_transitions to service_role;
    grant usage,select on sequence public.ota_device_transitions_id_seq to service_role;
    grant execute on function public.ota_record_heartbeat(jsonb) to service_role;
    grant execute on function public.ota_devices_report(integer,text,text,text,integer) to service_role;
  end if;
end $$;
commit;
