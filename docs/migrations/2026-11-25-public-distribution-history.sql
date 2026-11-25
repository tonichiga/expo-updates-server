-- Apply after device-targeting-activation. Safe to reapply.
begin;
select public.lock_ota_distribution_control();

-- Deletion may need multiple requests to remove remote objects. A release
-- being removed remains available to retry cleanup, but can no longer serve.
alter table public.ota_updates add column if not exists deletion_pending boolean not null default false;
alter table public.ota_updates drop constraint if exists ota_deleting_update_inactive;
alter table public.ota_updates add constraint ota_deleting_update_inactive check (not deletion_pending or not is_active);

-- Keep the identity of a deleted artifact: deleting the last release must not
-- make its predecessor look like the release that an operator just stopped.
create table if not exists public.ota_public_distribution_events (
  id bigint generated always as identity primary key,
  runtime_version text not null,
  channel text not null,
  platform text not null,
  update_id uuid not null,
  event text not null check (event in ('baseline', 'activated', 'stopped')),
  recorded_at timestamptz not null default clock_timestamp()
);
create index if not exists idx_public_events_scope
  on public.ota_public_distribution_events(runtime_version, channel, platform, id desc);
alter table public.ota_public_distribution_events enable row level security;
revoke all on public.ota_public_distribution_events from public;

-- Old widening semantics could leave multiple public rows active. Retain only
-- the one the anonymous manifest selector actually preferred. Existing rows
-- with no serving pointer could never serve an anonymous client.
with ranked as (
  select u.update_id, c.latest_update_id is not null or c.active_update_id is not null as has_pointer,
    row_number() over (partition by u.runtime_version, u.channel, u.platform order by
      (u.update_id = c.active_update_id) desc nulls last,
      (u.update_id = c.latest_update_id) desc nulls last, u.created_at desc, u.update_id desc) as n
  from public.ota_updates u
  left join public.ota_update_channels c using (runtime_version, channel, platform)
  where u.is_active and u.audience_mode = 'all'
)
update public.ota_updates u set is_active=false, disabled_at=clock_timestamp(), updated_at=clock_timestamp()
from ranked r where r.update_id=u.update_id and (r.n>1 or not r.has_pointer);
-- A baseline observes the live public artifact. Publication timestamps, upload
-- order and device manifests cannot establish when or to whom older builds were activated.
insert into public.ota_public_distribution_events(runtime_version,channel,platform,update_id,event)
select u.runtime_version,u.channel,u.platform,u.update_id,'baseline'
from public.ota_updates u where u.is_active and u.audience_mode='all' and not exists (
  select 1 from public.ota_public_distribution_events e
  where (e.runtime_version,e.channel,e.platform)=(u.runtime_version,u.channel,u.platform)
);
create unique index if not exists idx_ota_one_public_release
  on public.ota_updates(runtime_version,channel,platform) where is_active and audience_mode='all';

create or replace function public.ota_activate_audience()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.is_active and new.audience_mode='all'
     and not (old.is_active and old.audience_mode='all') then
    perform public.assert_ota_distribution_mutation_allowed('starting public distribution');
    update public.ota_updates set is_active=false, disabled_at=clock_timestamp(), updated_at=clock_timestamp()
      where (runtime_version,channel,platform)=(new.runtime_version,new.channel,new.platform)
      and update_id<>new.update_id and is_active and audience_mode='all';
  end if;
  return new;
end $$;
drop trigger if exists trg_ota_updates_activate_audience on public.ota_updates;
create trigger trg_ota_updates_activate_audience before update of is_active,audience_mode on public.ota_updates
  for each row execute function public.ota_activate_audience();
drop trigger if exists trg_ota_history_serialize_audience on public.ota_updates;
create trigger trg_ota_history_serialize_audience before update of audience_mode or delete on public.ota_updates
  for each statement execute function public.serialize_ota_distribution_statement();

-- Every upload is a draft. A legacy publisher setting true must still complete
-- as a draft and must not retire a live release or lock the draft policy.
create or replace function public.ota_insert_draft()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  new.is_active:=false;
  new.policy_published_at:=null;
  return new;
end $$;
drop trigger if exists trg_00_ota_insert_draft on public.ota_updates;
create trigger trg_00_ota_insert_draft before insert on public.ota_updates
  for each row execute function public.ota_insert_draft();

create or replace function public.ota_record_public_transition()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare was_public boolean := old.is_active and old.audience_mode='all';
        now_public boolean := false;
begin
  if tg_op <> 'DELETE' then
    now_public:=new.is_active and new.audience_mode='all';
    -- The writer creates an empty channel. Explicit SQL activation of its first
    -- draft also needs a pointer so that an intentional stop can stay fail-closed.
    if new.is_active and not old.is_active then
      update public.ota_update_channels set latest_update_id=new.update_id,latest_created_at=new.created_at,
        latest_created_at_path=new.created_at_path
      where (runtime_version,channel,platform)=(new.runtime_version,new.channel,new.platform)
        and latest_update_id is null and active_update_id is null;
    end if;
  end if;
  if was_public is distinct from now_public then
    insert into public.ota_public_distribution_events(runtime_version,channel,platform,update_id,event)
    values(old.runtime_version,old.channel,old.platform,old.update_id,
      case when now_public then 'activated' else 'stopped' end);
  end if;
  return null;
end $$;
revoke all on function public.ota_record_public_transition() from public;
drop trigger if exists trg_ota_record_public_transition on public.ota_updates;
create trigger trg_ota_record_public_transition after update of is_active,audience_mode or delete on public.ota_updates
  for each row execute function public.ota_record_public_transition();

-- Pick the previous *distinct activation*, even if the last release has been
-- stopped or deleted. Never restore a release that is currently device-only.
create or replace view public.ota_distribution_history as
select c.id,c.runtime_version,c.channel,c.platform,
  coalesce(latest_event.id,0)::text as revision,
  case when curr.is_active then curr.release end as current_release,
  prev.release as previous_release
from public.ota_update_channels c
left join lateral (
  select e.id from public.ota_public_distribution_events e
  where (e.runtime_version,e.channel,e.platform)=(c.runtime_version,c.channel,c.platform)
  order by e.id desc limit 1
) latest_event on true
left join lateral (
  select e.update_id from public.ota_public_distribution_events e
  where (e.runtime_version,e.channel,e.platform)=(c.runtime_version,c.channel,c.platform)
    and e.event <> 'stopped' order by e.id desc limit 1
) last_activation on true
left join lateral (
  select u.is_active, jsonb_build_object('updateId',u.update_id,'comment',u.comment,'createdAt',u.created_at,
    'appVersion',coalesce(nullif(btrim(u.manifest#>>'{extra,expoClient,version}'),''),
                          nullif(btrim(u.manifest#>>'{expoClient,version}'),'')),
    'activatedAt',case when e.event='activated' then e.recorded_at end) as release
  from public.ota_updates u join public.ota_public_distribution_events e using(update_id,runtime_version,channel,platform)
  where u.update_id=last_activation.update_id and u.audience_mode='all' and e.event<>'stopped'
  order by e.id desc limit 1
) curr on true
left join lateral (
  select jsonb_build_object('updateId',u.update_id,'comment',u.comment,'createdAt',u.created_at,
    'appVersion',coalesce(nullif(btrim(u.manifest#>>'{extra,expoClient,version}'),''),
                          nullif(btrim(u.manifest#>>'{expoClient,version}'),'')),
    'activatedAt',case when e.event='activated' then e.recorded_at end) as release
  from public.ota_public_distribution_events e join public.ota_updates u using(update_id,runtime_version,channel,platform)
  where (e.runtime_version,e.channel,e.platform)=(c.runtime_version,c.channel,c.platform)
    and e.event<>'stopped' and u.update_id<>last_activation.update_id and u.audience_mode='all' and not u.is_active and not u.deletion_pending
  order by e.id desc limit 1
) prev on true;
revoke all on public.ota_distribution_history from public;

-- The switch, validation, activation, public history and serving pointers use
-- one transaction and the same lock as audience edits and publisher INSERTs.
create or replace function public.ota_change_distribution(p_update uuid,p_action text,p_revision text default null)
returns table(result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare
  u public.ota_updates%rowtype;
  c public.ota_update_channels%rowtype;
  newest public.ota_updates%rowtype;
  serving public.ota_updates%rowtype;
  latest public.ota_updates%rowtype;
  pinned uuid;
  history public.ota_distribution_history%rowtype;
  changed_at timestamptz;
begin
  perform public.lock_ota_distribution_control();
  if p_action is null or p_action not in ('activate','stop','restore','rollback','promote','select-latest','retire','delete') then
    raise exception 'Invalid distribution action';
  end if;
  if p_action not in ('stop','retire','delete') then
    perform public.assert_ota_distribution_mutation_allowed(p_action);
  end if;
  select * into u from public.ota_updates where update_id=p_update for update;
  if not found then raise exception 'DISTRIBUTION_CONFLICT: Release no longer exists'; end if;
  if u.deletion_pending and p_action not in ('stop','retire','delete') then
    raise exception 'DISTRIBUTION_CONFLICT: This release is being deleted';
  end if;
  insert into public.ota_update_channels(runtime_version,channel,platform)
    values(u.runtime_version,u.channel,u.platform) on conflict(runtime_version,channel,platform) do nothing;
  select * into strict c from public.ota_update_channels
    where (runtime_version,channel,platform)=(u.runtime_version,u.channel,u.platform) for update;
  select * into newest from public.ota_updates
    where (runtime_version,channel,platform)=(u.runtime_version,u.channel,u.platform)
    order by created_at desc,update_id desc limit 1;
  pinned:=c.active_update_id;
  if pinned=c.latest_update_id then pinned:=null; end if;
  if p_action='restore' then
    select * into history from public.ota_distribution_history where id=c.id;
    if p_revision is distinct from history.revision or
       p_update is distinct from (history.previous_release->>'updateId')::uuid then
      raise exception 'DISTRIBUTION_CONFLICT: Previous release changed. Refresh and try again.';
    end if;
  elsif p_action='activate' then
    if p_update<>newest.update_id or pinned is not null then
      raise exception 'DISTRIBUTION_CONFLICT: Direct activation requires the newest release and no active rollback';
    end if;
  elsif p_action='promote' then
    if pinned is null or p_update is distinct from c.latest_update_id then
      raise exception 'DISTRIBUTION_CONFLICT: Promote requires the latest release and an active rollback';
    end if;
  elsif p_action='rollback' then
    select * into serving from public.ota_updates
      where (runtime_version,channel,platform)=(u.runtime_version,u.channel,u.platform) and is_active
      and (u.audience_mode='devices' or audience_mode='all')
      order by (update_id=pinned) desc nulls last, (update_id=c.latest_update_id) desc nulls last,
        created_at desc,update_id desc limit 1;
    if serving.update_id is null or serving.created_at<=u.created_at then
      raise exception 'DISTRIBUTION_CONFLICT: Rollback requires a newer active release in this scope';
    end if;
  elsif p_action='select-latest' then
    if not u.is_active or pinned is not null then
      raise exception 'DISTRIBUTION_CONFLICT: Latest must be active and rollback must be off';
    end if;
  end if;
  changed_at:=clock_timestamp();
  if p_action in ('stop','retire','delete') then
    if u.is_active or p_action='retire' then
      update public.ota_updates set is_active=false,disabled_at=coalesce(disabled_at,changed_at),updated_at=changed_at,
        deletion_pending=deletion_pending or p_action='retire' where update_id=p_update;
    end if;
    if c.active_update_id=p_update or c.latest_update_id=p_update then
      select * into latest from public.ota_updates
        where (runtime_version,channel,platform)=(u.runtime_version,u.channel,u.platform) and is_active
        order by created_at desc,update_id desc limit 1;
      if pinned=p_update or pinned=latest.update_id then pinned:=null; end if;
      update public.ota_update_channels set latest_update_id=latest.update_id,latest_created_at=latest.created_at,
        latest_created_at_path=latest.created_at_path,active_update_id=pinned,active_changed_at=changed_at
        where id=c.id returning * into c;
    end if;
    if p_action='delete' then delete from public.ota_updates where update_id=p_update; end if;
  else
    if not u.is_active then
      update public.ota_updates set is_active=true,disabled_at=null,updated_at=changed_at,
        rolled_back_from_update_id=case when p_action='rollback' then serving.update_id else rolled_back_from_update_id end
        where update_id=p_update returning * into u;
    end if;
    latest:=u;
    pinned:=null;
    if p_action='rollback' then
      latest:=newest; pinned:=p_update;
    elsif p_action='restore' then
      -- A newer active smoke stays selected for its allowed identities. The
      -- anonymous eligibility lookup resolves the manually restored public row.
      select * into latest from public.ota_updates
        where (runtime_version,channel,platform)=(u.runtime_version,u.channel,u.platform) and is_active
        order by created_at desc,update_id desc limit 1;
    end if;
    update public.ota_update_channels set latest_update_id=latest.update_id,latest_created_at=latest.created_at,
      latest_created_at_path=latest.created_at_path,active_update_id=pinned,active_changed_at=changed_at
      where id=c.id and (latest_update_id,active_update_id) is distinct from (latest.update_id,pinned)
      returning * into c;
    if not found then
      select * into c from public.ota_update_channels where (runtime_version,channel,platform)=(u.runtime_version,u.channel,u.platform);
    end if;
  end if;
  return query select jsonb_build_object('updated',true,'disabled',p_action in ('stop','retire','delete'),
    'state',case when p_action in ('stop','retire','delete') then 'disabled' else 'active' end,
    'fallbackApplied',p_action in ('stop','retire','delete') and u.audience_mode='devices' and c.latest_update_id is not null,
    'activeUpdateId',c.active_update_id,'latestUpdateId',c.latest_update_id,'activeChangedAt',c.active_changed_at,
    'rollbackActive',c.active_update_id is not null and c.active_update_id<>c.latest_update_id,
    'rollbackAssigned',p_action='rollback','promoted',p_action='promote',
    'id',u.update_id,'updateId',u.update_id,'buildId',u.build_id,'runtimeVersion',u.runtime_version,
    'platform',u.platform,'channel',u.channel,'createdAt',u.created_at,'createdAtPath',u.created_at_path,
    'updatedAt',u.updated_at,'isActive',p_action not in ('stop','retire','delete'),'reason',p_action);
end $$;
revoke all on function public.ota_change_distribution(uuid,text,text) from public;
do $$ begin
  if exists(select from pg_roles where rolname='anon') then
    revoke all on public.ota_distribution_history, public.ota_public_distribution_events from anon;
    revoke all on function public.ota_change_distribution(uuid,text,text) from anon;
  end if;
  if exists(select from pg_roles where rolname='authenticated') then
    revoke all on public.ota_distribution_history, public.ota_public_distribution_events from authenticated;
    revoke all on function public.ota_change_distribution(uuid,text,text) from authenticated;
  end if;
  if exists(select from pg_roles where rolname='service_role') then
    -- The invoker-security audience RPC checks the global stop before the
    -- trigger promotes a live smoke to public distribution.
    grant execute on function public.assert_ota_distribution_mutation_allowed(text) to service_role;
    grant select on public.ota_distribution_history to service_role;
    grant execute on function public.ota_change_distribution(uuid,text,text) to service_role;
  end if;
end $$;
commit;
