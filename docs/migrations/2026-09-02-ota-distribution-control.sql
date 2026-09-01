create table if not exists public.ota_distribution_control (
  singleton_id smallint primary key default 1,
  blocked boolean not null default false,
  version bigint not null default 1,
  reason text null,
  changed_at timestamptz not null default now(),
  changed_by jsonb not null default
    '{"type":"system","id":"migration","label":"Database migration"}'::jsonb,
  constraint ota_distribution_control_singleton_chk check (singleton_id = 1),
  constraint ota_distribution_control_version_chk check (version > 0),
  constraint ota_distribution_control_reason_chk check (
    (not blocked and reason is null)
    or (
      blocked
      and reason = btrim(reason)
      and char_length(reason) between 1 and 500
      and reason !~ '[[:cntrl:]]'
    )
  )
);

insert into public.ota_distribution_control (
  singleton_id,
  blocked,
  version,
  reason,
  changed_by
)
values (
  1,
  false,
  1,
  null,
  '{"type":"system","id":"migration","label":"Database migration"}'::jsonb
)
on conflict (singleton_id) do nothing;

create table if not exists public.ota_distribution_control_events (
  id bigserial primary key,
  previous_blocked boolean not null,
  blocked boolean not null,
  previous_version bigint not null,
  version bigint not null,
  reason text null,
  changed_at timestamptz not null,
  changed_by jsonb not null,
  constraint ota_distribution_control_events_versions_chk check (
    previous_version > 0 and version = previous_version + 1
  )
);

create index if not exists idx_ota_distribution_control_events_changed_at
  on public.ota_distribution_control_events (changed_at desc);

-- Serialize the emergency switch with every mutation that can start or
-- redirect OTA distribution. A transaction that gets this lock first is the
-- operation that takes effect first; the other transaction observes its
-- committed result after waiting. Keep this lock first in every code path
-- before taking row locks to avoid lock-order inversions.
create or replace function public.lock_ota_distribution_control()
returns void
language sql
set search_path = pg_catalog
as $$
  select pg_catalog.pg_advisory_xact_lock(20260902, 1);
$$;

revoke all on function public.lock_ota_distribution_control() from public;

create or replace function public.serialize_ota_distribution_statement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.lock_ota_distribution_control();
  return null;
end;
$$;

-- This statement-level trigger also serializes ordinary direct SQL updates
-- of the singleton. The RPC explicitly takes the same lock before touching
-- the row.
drop trigger if exists trg_ota_distribution_control_serialize_write
  on public.ota_distribution_control;
create trigger trg_ota_distribution_control_serialize_write
before insert or update or delete on public.ota_distribution_control
for each statement
execute function public.serialize_ota_distribution_statement();

-- Acquire the lock before PostgreSQL starts locking affected update/channel
-- rows. The row triggers below take it again (reentrantly) only when they need
-- to check BLOCKED, but the statement triggers establish a consistent global
-- lock order for multi-row and direct-SQL mutations.
drop trigger if exists trg_ota_distribution_serialize_update_insert
  on public.ota_updates;
create trigger trg_ota_distribution_serialize_update_insert
before insert on public.ota_updates
for each statement
execute function public.serialize_ota_distribution_statement();

drop trigger if exists trg_ota_distribution_serialize_update_activation
  on public.ota_updates;
create trigger trg_ota_distribution_serialize_update_activation
before update of is_active on public.ota_updates
for each statement
execute function public.serialize_ota_distribution_statement();

drop trigger if exists trg_ota_distribution_serialize_channel_insert
  on public.ota_update_channels;
create trigger trg_ota_distribution_serialize_channel_insert
before insert on public.ota_update_channels
for each statement
execute function public.serialize_ota_distribution_statement();

drop trigger if exists trg_ota_distribution_serialize_channel_change
  on public.ota_update_channels;
create trigger trg_ota_distribution_serialize_channel_change
before update of
  runtime_version,
  channel,
  platform,
  latest_update_id,
  latest_created_at,
  latest_created_at_path,
  active_update_id,
  active_changed_at,
  served_manifest_id,
  served_manifest_changed_at
on public.ota_update_channels
for each statement
execute function public.serialize_ota_distribution_statement();

create or replace function public.assert_ota_distribution_mutation_allowed(
  p_operation text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  distribution_blocked boolean;
begin
  perform public.lock_ota_distribution_control();

  select blocked
    into distribution_blocked
    from public.ota_distribution_control
   where singleton_id = 1
     for share;

  if not found then
    raise exception
      'OTA_DISTRIBUTION_CONTROL_MISSING: singleton row is required'
      using errcode = '55000';
  end if;

  if distribution_blocked then
    raise exception
      'OTA_DISTRIBUTION_BLOCKED: % is not allowed while global OTA distribution is blocked',
      p_operation
      using
        errcode = 'P0OTA',
        hint = 'Deactivate updates or resume OTA distribution first.';
  end if;
end;
$$;

revoke all on function public.assert_ota_distribution_mutation_allowed(text)
  from public;

create or replace function public.guard_ota_update_distribution()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Inactive inserts and all edits that do not activate a row stay available.
  -- In particular, true -> false is deliberately allowed for incident repair.
  if (tg_op = 'INSERT' and not new.is_active)
     or (
       tg_op = 'UPDATE'
       and not (new.is_active and not old.is_active)
     ) then
    return new;
  end if;

  perform public.assert_ota_distribution_mutation_allowed(
    case
      when tg_op = 'INSERT' then 'inserting an active OTA update'
      else 'activating an OTA update'
    end
  );
  return new;
end;
$$;

drop trigger if exists trg_ota_distribution_guard_updates
  on public.ota_updates;
create trigger trg_ota_distribution_guard_updates
before insert or update on public.ota_updates
for each row
execute function public.guard_ota_update_distribution();

create or replace function public.guard_ota_channel_distribution()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changes_distribution_state boolean;
begin
  if tg_op = 'INSERT' then
    -- Empty channel rows do not distribute an update.
    changes_distribution_state :=
      new.latest_update_id is not null
      or new.active_update_id is not null;
  else
    changes_distribution_state :=
      new.runtime_version is distinct from old.runtime_version
      or new.channel is distinct from old.channel
      or new.platform is distinct from old.platform
      or new.latest_update_id is distinct from old.latest_update_id
      or new.latest_created_at is distinct from old.latest_created_at
      or new.latest_created_at_path is distinct from old.latest_created_at_path
      or new.active_update_id is distinct from old.active_update_id
      or new.active_changed_at is distinct from old.active_changed_at
      or new.served_manifest_id is distinct from old.served_manifest_id
      or new.served_manifest_changed_at
        is distinct from old.served_manifest_changed_at;
  end if;

  if not changes_distribution_state then
    return new;
  end if;

  -- Clearing every serving pointer only removes distribution and is the
  -- channel-side part of deactivation. Clearing a rollback pointer while a
  -- latest pointer remains would promote latest, so it is still guarded.
  if new.latest_update_id is null and new.active_update_id is null then
    return new;
  end if;

  perform public.assert_ota_distribution_mutation_allowed(
    'changing OTA channel distribution state'
  );
  return new;
end;
$$;

drop trigger if exists trg_ota_distribution_guard_channels
  on public.ota_update_channels;
create trigger trg_ota_distribution_guard_channels
before insert or update on public.ota_update_channels
for each row
execute function public.guard_ota_channel_distribution();

create or replace function public.set_ota_distribution_control(
  p_blocked boolean,
  p_reason text,
  p_expected_version bigint,
  p_changed_by jsonb
)
returns setof public.ota_distribution_control
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  previous_row public.ota_distribution_control%rowtype;
  updated_row public.ota_distribution_control%rowtype;
  normalized_reason text;
begin
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'expectedVersion must be a positive integer'
      using errcode = '22023';
  end if;

  if p_changed_by is null
     or jsonb_typeof(p_changed_by) <> 'object'
     or nullif(btrim(p_changed_by->>'type'), '') is null
     or nullif(btrim(p_changed_by->>'id'), '') is null
     or nullif(btrim(p_changed_by->>'label'), '') is null then
    raise exception 'changedBy principal metadata is invalid'
      using errcode = '22023';
  end if;

  normalized_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_blocked and normalized_reason is null then
    raise exception 'reason is required when OTA distribution is blocked'
      using errcode = '22023';
  end if;
  if p_blocked and (
    char_length(normalized_reason) > 500
    or normalized_reason ~ '[[:cntrl:]]'
  ) then
    raise exception 'reason must contain at most 500 characters and no control characters'
      using errcode = '22023';
  end if;
  if not p_blocked then
    normalized_reason := null;
  end if;

  perform public.lock_ota_distribution_control();

  select *
    into previous_row
    from public.ota_distribution_control
   where singleton_id = 1
     for update;

  if not found then
    raise exception 'OTA distribution control singleton is missing'
      using errcode = '55000';
  end if;

  update public.ota_distribution_control
     set blocked = p_blocked,
         version = version + 1,
         reason = normalized_reason,
         changed_at = now(),
         changed_by = p_changed_by
   where singleton_id = 1
     and version = p_expected_version
  returning * into updated_row;

  if not found then
    raise exception 'OTA distribution control version conflict'
      using errcode = '40001';
  end if;

  insert into public.ota_distribution_control_events (
    previous_blocked,
    blocked,
    previous_version,
    version,
    reason,
    changed_at,
    changed_by
  )
  values (
    previous_row.blocked,
    updated_row.blocked,
    previous_row.version,
    updated_row.version,
    updated_row.reason,
    updated_row.changed_at,
    updated_row.changed_by
  );

  return next updated_row;
end;
$$;

revoke all on function public.set_ota_distribution_control(
  boolean,
  text,
  bigint,
  jsonb
) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.set_ota_distribution_control(
      boolean,
      text,
      bigint,
      jsonb
    ) to service_role;
  end if;
end;
$$;
