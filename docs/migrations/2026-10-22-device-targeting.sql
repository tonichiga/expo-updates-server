-- Apply after device-version-metadata. Existing releases remain public.
begin;
-- Targeted releases coexist with their public fallback.
drop index if exists public.idx_ota_updates_one_active_per_scope;
alter table public.ota_updates
  add column if not exists audience_mode text not null default 'all' check (audience_mode in ('all','devices')),
  add column if not exists audience_installation_ids text[] not null default '{}',
  add column if not exists audience_device_ids text[] not null default '{}',
  add column if not exists audience_version integer not null default 1 check (audience_version > 0);
alter table public.ota_device_state add column if not exists device_id text check (device_id ~ '^[0-9a-f]{64}$');
create index if not exists idx_ota_device_state_device on public.ota_device_state(device_id,platform);
create table if not exists public.ota_named_devices (
  device_id text primary key check (device_id ~ '^[0-9a-f]{64}$'),
  name text not null check (length(name) between 1 and 80 and name = btrim(name) and name !~ '[[:cntrl:]]')
);
alter table public.ota_named_devices enable row level security;
revoke all on public.ota_named_devices from public;

create or replace function public.ota_latest_eligible_update(p_runtime text, p_channel text, p_platform text,
  p_installation text default null, p_device text default null)
returns setof public.ota_updates language sql stable set search_path=public as $$
  select * from public.ota_updates where runtime_version=p_runtime and channel=p_channel and platform=p_platform and is_active
    and (audience_mode='all' or (audience_mode='devices' and
      (p_installation=any(audience_installation_ids) or p_device=any(audience_device_ids))))
  order by created_at desc, update_id desc limit 1;
$$;

create or replace function public.ota_replace_audience(p_update uuid, p_mode text, p_installations jsonb,
  p_devices jsonb, p_version integer)
returns setof public.ota_updates language plpgsql set search_path=public as $$
declare ids text[]; devices text[];
begin
  perform public.assert_ota_distribution_mutation_allowed('change update audience');
  if p_mode is null or p_mode not in ('all','devices') or jsonb_typeof(p_installations) is distinct from 'array'
     or jsonb_typeof(p_devices) is distinct from 'array' then raise exception 'INVALID_AUDIENCE'; end if;
  select coalesce(array_agg(distinct value),'{}') into ids from jsonb_array_elements_text(p_installations);
  select coalesce(array_agg(distinct value),'{}') into devices from jsonb_array_elements_text(p_devices);
  if cardinality(ids)>100 or cardinality(devices)>100 or
     exists(select 1 from unnest(ids) id where id is null or id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') or
     exists(select 1 from unnest(devices) id where id is null or id !~ '^[0-9a-f]{64}$') or
     (p_mode='devices' and cardinality(ids)+cardinality(devices)=0)
     then raise exception 'INVALID_AUDIENCE'; end if;
  return query update public.ota_updates set audience_mode=p_mode, audience_installation_ids=ids,
    audience_device_ids=devices,audience_version=audience_version+1
    where update_id=p_update and audience_version=p_version returning *;
  if not found then raise exception 'AUDIENCE_CONFLICT'; end if;
end $$;

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
    device_id=coalesce(p_event->>'deviceId',previous.device_id),
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


revoke all on function public.ota_latest_eligible_update(text,text,text,text,text) from public;
revoke all on function public.ota_replace_audience(uuid,text,jsonb,jsonb,integer) from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant all on public.ota_named_devices to service_role;
    grant execute on function public.ota_latest_eligible_update(text,text,text,text,text) to service_role;
    grant execute on function public.ota_replace_audience(uuid,text,jsonb,jsonb,integer) to service_role;
    drop policy if exists ota_named_devices_service on public.ota_named_devices;
    create policy ota_named_devices_service on public.ota_named_devices to service_role using (true) with check (true);
  end if;
end $$;
commit;
