create extension if not exists pgcrypto;

create table if not exists public.ota_updates (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null unique,
  build_id uuid not null,
  runtime_version text not null,
  channel text not null,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null,
  created_at_path text not null,
  storage_bucket text not null,
  storage_base_path text not null,
  is_active boolean not null default false,
  updated_at timestamptz null,
  disabled_at timestamptz null,
  assets_count integer not null default 0,
  launch_asset_path text null,
  comment text null,
  rolled_back_from_update_id uuid null,
  delivery_mode text not null default 'manual',
  guard_action text null,
  guard_payload jsonb null,
  policy_version integer not null default 1,
  policy_published_at timestamptz null,
  manifest jsonb not null,
  inserted_at timestamptz not null default now(),
  modified_at timestamptz not null default now(),
  constraint ota_updates_active_dates_chk check (
    not is_active or disabled_at is null
  ),
  constraint ota_updates_delivery_mode_chk check (
    delivery_mode in ('manual', 'background')
  ),
  constraint ota_updates_guard_action_chk check (
    guard_action is null
    or (
      guard_action = btrim(guard_action)
      and char_length(guard_action) between 1 and 100
      and guard_action !~ '[[:cntrl:]]'
    )
  ),
  constraint ota_updates_guard_payload_requires_action_chk check (
    guard_payload is null or guard_action is not null
  ),
  constraint ota_updates_policy_version_chk check (policy_version > 0)
);

-- Keep schema.sql safe as an upgrade path from the removed rule-builder
-- model. Old rules are intentionally discarded rather than converted.
drop trigger if exists trg_ota_updates_lock_published_policy
  on public.ota_updates;

alter table public.ota_updates
  add column if not exists guard_action text null,
  add column if not exists guard_payload jsonb null;

alter table public.ota_updates
  drop constraint if exists ota_updates_guard_rules_array_chk,
  drop constraint if exists ota_updates_guard_action_chk,
  drop constraint if exists ota_updates_guard_payload_requires_action_chk,
  drop column if exists guard_rules,
  add constraint ota_updates_guard_action_chk check (
    guard_action is null
    or (
      guard_action = btrim(guard_action)
      and char_length(guard_action) between 1 and 100
      and guard_action !~ '[[:cntrl:]]'
    )
  ),
  add constraint ota_updates_guard_payload_requires_action_chk check (
    guard_payload is null or guard_action is not null
  );

create index if not exists idx_ota_updates_lookup
  on public.ota_updates (runtime_version, channel, platform, created_at desc);

-- Multiple eligible releases are supported for device targeting and public fallback.

comment on column public.ota_updates.disabled_at is
  'Inactive-state timestamp; disabled_at = created_at is the initial draft marker, not publication.';
comment on column public.ota_updates.policy_published_at is
  'First activation/publication timestamp. A null value identifies an editable draft policy.';

create table if not exists public.ota_update_channels (
  id bigserial primary key,
  runtime_version text not null,
  channel text not null,
  platform text not null check (platform in ('ios', 'android')),
  latest_update_id uuid null references public.ota_updates(update_id) on delete set null,
  latest_created_at timestamptz null,
  latest_created_at_path text null,
  active_update_id uuid null references public.ota_updates(update_id) on delete set null,
  active_changed_at timestamptz null,
  inserted_at timestamptz not null default now(),
  modified_at timestamptz not null default now(),
  unique (runtime_version, channel, platform)
);

comment on column public.ota_update_channels.latest_update_id is
  'Newest uploaded update; may reference an inactive draft and is not publication evidence.';

create or replace function public.set_modified_at()
returns trigger
language plpgsql
as $$
begin
  new.modified_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ota_updates_modified_at on public.ota_updates;
create trigger trg_ota_updates_modified_at
before update on public.ota_updates
for each row execute function public.set_modified_at();

create or replace function public.ota_updates_lock_published_policy()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_active and new.policy_published_at is null then
      new.policy_published_at := coalesce(
        new.updated_at,
        new.created_at,
        now()
      );
    end if;
    return new;
  end if;

  if new.is_active and not old.is_active
     and new.policy_published_at is null then
    new.policy_published_at := coalesce(
      new.updated_at,
      new.created_at,
      now()
    );
  end if;

  if old.policy_published_at is not null and (
    new.delivery_mode is distinct from old.delivery_mode
    or new.guard_action is distinct from old.guard_action
    or new.guard_payload is distinct from old.guard_payload
    or new.policy_version is distinct from old.policy_version
    or new.policy_published_at is distinct from old.policy_published_at
  ) then
    raise exception 'OTA update policy is immutable after publication';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ota_updates_lock_published_policy
  on public.ota_updates;
create trigger trg_ota_updates_lock_published_policy
before insert or update on public.ota_updates
for each row execute function public.ota_updates_lock_published_policy();

drop trigger if exists trg_ota_update_channels_modified_at on public.ota_update_channels;
create trigger trg_ota_update_channels_modified_at
before update on public.ota_update_channels
for each row execute function public.set_modified_at();

alter table public.ota_update_channels
  add column if not exists served_manifest_id uuid not null default gen_random_uuid();

alter table public.ota_update_channels
  add column if not exists served_manifest_changed_at timestamptz not null default now();

create or replace function public.ota_channels_rotate_served_manifest_id()
returns trigger
language plpgsql
as $$
begin
  if (
    old.latest_update_id is distinct from new.latest_update_id
    or old.active_update_id is distinct from new.active_update_id
    or old.active_changed_at is distinct from new.active_changed_at
  ) then
    new.served_manifest_id := gen_random_uuid();
    -- Expo compares timestamps at millisecond precision, including within
    -- one transaction. now() alone can produce equal publication times.
    new.served_manifest_changed_at := greatest(
      clock_timestamp(),
      old.served_manifest_changed_at + interval '1 millisecond',
      old.active_changed_at + interval '1 millisecond',
      new.active_changed_at
    );
  end if;
  return new;
end;
$$;

-- 4) Триггер
drop trigger if exists trg_ota_channels_rotate_served_manifest_id on public.ota_update_channels;

create trigger trg_ota_channels_rotate_served_manifest_id
before update on public.ota_update_channels
for each row
execute function public.ota_channels_rotate_served_manifest_id();

-- 5) Индекс (не обязателен, но полезен для отладки/поиска)
create index if not exists idx_ota_channels_served_manifest_id
  on public.ota_update_channels(served_manifest_id);

create or replace function public.ota_channels_validate_scope_pointers()
returns trigger
language plpgsql
as $$
declare
  latest_row record;
  active_row record;
begin
  if new.latest_update_id is not null then
    select runtime_version, channel, platform
      into latest_row
      from public.ota_updates
     where update_id = new.latest_update_id;

    if not found then
      raise exception
        'latest_update_id % does not exist in ota_updates',
        new.latest_update_id;
    end if;

    if latest_row.runtime_version is distinct from new.runtime_version
       or latest_row.channel is distinct from new.channel
       or latest_row.platform is distinct from new.platform then
      raise exception
        'latest_update_id % points outside scope (%/%/%), row scope is (%/%/%)',
        new.latest_update_id,
        latest_row.runtime_version,
        latest_row.channel,
        latest_row.platform,
        new.runtime_version,
        new.channel,
        new.platform;
    end if;
  end if;

  if new.active_update_id is not null then
    select runtime_version, channel, platform
      into active_row
      from public.ota_updates
     where update_id = new.active_update_id;

    if not found then
      raise exception
        'active_update_id % does not exist in ota_updates',
        new.active_update_id;
    end if;

    if active_row.runtime_version is distinct from new.runtime_version
       or active_row.channel is distinct from new.channel
       or active_row.platform is distinct from new.platform then
      raise exception
        'active_update_id % points outside scope (%/%/%), row scope is (%/%/%)',
        new.active_update_id,
        active_row.runtime_version,
        active_row.channel,
        active_row.platform,
        new.runtime_version,
        new.channel,
        new.platform;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ota_channels_validate_scope_pointers
  on public.ota_update_channels;
create trigger trg_ota_channels_validate_scope_pointers
before insert or update on public.ota_update_channels
for each row
execute function public.ota_channels_validate_scope_pointers();

create table if not exists public.ota_embedded_updates (
  id uuid primary key default gen_random_uuid(),
  embedded_update_id uuid not null unique,
  app_version text null,
  created_at timestamptz not null,
  channel text not null,
  platform text not null check (platform in ('ios', 'android')),
  is_embedded boolean not null default true,
  inserted_at timestamptz not null default now(),
  modified_at timestamptz not null default now()
);

create index if not exists idx_ota_embedded_updates_lookup
  on public.ota_embedded_updates (channel, platform, created_at desc);

drop trigger if exists trg_ota_embedded_updates_modified_at
  on public.ota_embedded_updates;
create trigger trg_ota_embedded_updates_modified_at
before update on public.ota_embedded_updates
for each row execute function public.set_modified_at();

create or replace function public.preserve_embedded_update_app_version()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and nullif(btrim(new.app_version), '') is null then
    new.app_version := old.app_version;
  else
    new.app_version := nullif(btrim(new.app_version), '');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ota_embedded_updates_preserve_app_version
  on public.ota_embedded_updates;
create trigger trg_ota_embedded_updates_preserve_app_version
before insert or update on public.ota_embedded_updates
for each row execute function public.preserve_embedded_update_app_version();

create table if not exists public.ota_served_manifest_log (
  served_manifest_id uuid primary key,
  update_id uuid not null
    references public.ota_updates(update_id) on delete cascade,
  runtime_version text not null,
  channel text not null,
  platform text not null check (platform in ('ios', 'android')),
  reason text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ota_served_manifest_log_update_id
  on public.ota_served_manifest_log (update_id);

create index if not exists idx_ota_served_manifest_log_scope
  on public.ota_served_manifest_log (
    runtime_version,
    channel,
    platform,
    created_at desc
  );

-- Repair policy markers incorrectly backfilled onto untouched, never-served
-- drafts. This block intentionally follows ota_served_manifest_log creation so
-- schema.sql is also a safe upgrade path for already-running installations.
begin;

drop trigger if exists trg_ota_updates_lock_published_policy
  on public.ota_updates;

update public.ota_updates u
set policy_published_at = null
where u.policy_published_at is not null
  and u.policy_published_at = coalesce(
    u.updated_at,
    u.disabled_at,
    u.created_at
  )
  and not u.is_active
  and u.disabled_at is not null
  and u.disabled_at = u.created_at
  and u.delivery_mode = 'manual'
  and u.guard_action is null
  and u.guard_payload is null
  and u.policy_version = 1
  and u.rolled_back_from_update_id is null
  and not exists (
    select 1
    from public.ota_served_manifest_log sml
    where sml.update_id = u.update_id
  )
  -- latest_update_id tracks the newest upload and may reference this inactive
  -- draft. It is intentionally not treated as publication evidence.
  and not exists (
    select 1
    from public.ota_update_channels c
    where c.active_update_id = u.update_id
  );

create trigger trg_ota_updates_lock_published_policy
before insert or update on public.ota_updates
for each row execute function public.ota_updates_lock_published_policy();

commit;

create table if not exists public.ota_device_state (
  installation_id text not null,
  platform text not null check (platform in ('ios', 'android')),
  runtime_version text not null,
  embedded_update_id uuid null,
  current_update_id uuid null
    references public.ota_updates(update_id) on delete set null,
  served_manifest_id uuid null,
  channel text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (installation_id, platform)
);

create index if not exists idx_ota_device_state_runtime
  on public.ota_device_state (runtime_version, channel, platform);

create index if not exists idx_ota_device_state_update_id
  on public.ota_device_state (current_update_id);

create table if not exists public.ota_device_transitions (
  id bigserial primary key,
  installation_id text not null,
  platform text not null check (platform in ('ios', 'android')),
  from_runtime text null,
  from_update_id uuid null,
  to_runtime text not null,
  to_update_id uuid null,
  transition_type text not null,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_ota_device_transitions_installation
  on public.ota_device_transitions (
    installation_id,
    platform,
    occurred_at desc
  );

create index if not exists idx_ota_device_transitions_from_update
  on public.ota_device_transitions (from_update_id);

create index if not exists idx_ota_device_transitions_to_update
  on public.ota_device_transitions (to_update_id);

create table if not exists public.ota_access_tokens (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  token_prefix text not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null check (cardinality(scopes) > 0),
  expires_at timestamptz null,
  revoked_at timestamptz null,
  last_used_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint ota_access_tokens_scopes_chk check (
    scopes <@ array[
      'updates:read',
      'updates:write',
      'redirects:read',
      'redirects:write'
    ]::text[]
  )
);

create index if not exists idx_ota_access_tokens_active_hash
  on public.ota_access_tokens (token_hash)
  where revoked_at is null;

create table if not exists public.ota_guard_actions (
  id uuid primary key default gen_random_uuid(),
  action_key text not null,
  created_at timestamptz not null default now(),
  constraint ota_guard_actions_action_key_chk check (
    action_key = btrim(action_key)
    and char_length(action_key) between 1 and 100
    and action_key !~ '[[:cntrl:]]'
  )
);

create unique index if not exists idx_ota_guard_actions_action_key
  on public.ota_guard_actions (action_key);

insert into public.ota_guard_actions (action_key)
values ('ota-force-store-update')
on conflict (action_key) do nothing;

create table if not exists public.ota_emergency_redirects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 120),
  enabled boolean not null default true,
  embedded_update_id uuid not null,
  runtime_version text not null,
  platform text not null check (platform in ('ios', 'android')),
  from_channel text not null,
  to_channel text not null,
  target_mode text not null check (target_mode in ('pinned', 'follow')),
  expected_update_id uuid null,
  created_at timestamptz not null default now(),
  modified_at timestamptz not null default now(),
  constraint ota_emergency_redirect_channels_chk check (
    from_channel <> to_channel
  ),
  constraint ota_emergency_redirect_pinned_target_chk check (
    target_mode <> 'pinned' or expected_update_id is not null
  ),
  unique (embedded_update_id, runtime_version, platform, from_channel)
);

create index if not exists idx_ota_emergency_redirect_lookup
  on public.ota_emergency_redirects (
    embedded_update_id,
    runtime_version,
    platform,
    from_channel
  )
  where enabled;

drop trigger if exists trg_ota_emergency_redirects_modified_at
  on public.ota_emergency_redirects;
create trigger trg_ota_emergency_redirects_modified_at
before update on public.ota_emergency_redirects
for each row execute function public.set_modified_at();

create table if not exists public.ota_admin_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin', 'operator', 'viewer')),
  is_active boolean not null default true,
  last_login_at timestamptz null,
  created_at timestamptz not null default now(),
  modified_at timestamptz not null default now(),
  constraint ota_admin_users_username_chk check (
    username = lower(username)
    and username ~ '^[a-z0-9._-]{3,64}$'
  )
);

create table if not exists public.ota_admin_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.ota_admin_users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_ota_admin_sessions_active_hash
  on public.ota_admin_sessions (token_hash)
  where revoked_at is null;

create index if not exists idx_ota_admin_sessions_user
  on public.ota_admin_sessions (user_id, expires_at desc);

drop trigger if exists trg_ota_admin_users_modified_at
  on public.ota_admin_users;
create trigger trg_ota_admin_users_modified_at
before update on public.ota_admin_users
for each row execute function public.set_modified_at();

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

create or replace function public.ota_updates_rotate_channel_on_activation()
returns trigger
language plpgsql
as $$
begin
  if not new.is_active then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.is_active then
      return new;
    end if;
  end if;

  -- latest_update_id may already point at this previously inactive draft.
  -- Activating it must still advance the epoch and the manifest timestamp.
  update public.ota_update_channels
     set served_manifest_id = gen_random_uuid(),
         served_manifest_changed_at = greatest(
           clock_timestamp(),
           served_manifest_changed_at + interval '1 millisecond',
           active_changed_at + interval '1 millisecond'
         )
   where runtime_version = new.runtime_version
     and channel = new.channel
     and platform = new.platform;
  return new;
end;
$$;

drop trigger if exists trg_ota_updates_rotate_channel_on_activation
  on public.ota_updates;
create trigger trg_ota_updates_rotate_channel_on_activation
after insert or update of is_active on public.ota_updates
for each row execute function public.ota_updates_rotate_channel_on_activation();

create or replace function public.ota_served_manifest_preserve_identity()
returns trigger
language plpgsql
as $$
begin
  if old.served_manifest_id is distinct from new.served_manifest_id
     or old.update_id is distinct from new.update_id
     or old.runtime_version is distinct from new.runtime_version
     or old.channel is distinct from new.channel
     or old.platform is distinct from new.platform then
    raise exception 'OTA_MANIFEST_IDENTITY_CONFLICT: served manifest identity cannot be reassigned'
      using errcode = '23514';
  end if;
  -- Repeated manifest checks must not change the first-recorded timestamp.
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists trg_ota_served_manifest_preserve_identity
  on public.ota_served_manifest_log;
create trigger trg_ota_served_manifest_preserve_identity
before update on public.ota_served_manifest_log
for each row execute function public.ota_served_manifest_preserve_identity();

-- Installation telemetry (2026-10-19).
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

-- Daily device analytics (2026-10-22).
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

-- Device version metadata (2026-10-22).
-- Apply after 2026-10-22-device-analytics.sql. Safe to reapply.
-- Version names come from manifest metadata, never the publication message.
begin;

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
  ), version_counts as (
    select platform, channel, runtime_version, native_version, native_build, launch_kind,
      coalesce(resolved_update_id, reported_update_id) as update_id,
      max(update_label) as update_label, count(*) as installations
    from filtered group by platform, channel, runtime_version, native_version, native_build,
      launch_kind, coalesce(resolved_update_id, reported_update_id)
  ), versions as (
    select v.*, case when v.launch_kind = 'ota' then coalesce(
      case when jsonb_typeof(u.manifest #> '{extra,expoClient,version}') = 'string'
        then nullif(btrim(u.manifest #>> '{extra,expoClient,version}'), '') end,
      case when jsonb_typeof(u.manifest #> '{expoClient,version}') = 'string'
        then nullif(btrim(u.manifest #>> '{expoClient,version}'), '') end
    ) when v.launch_kind = 'embedded' then coalesce(nullif(btrim(e.app_version), ''), v.native_version)
      else null end as app_version
    from version_counts v
    left join public.ota_updates u on v.launch_kind = 'ota' and u.update_id = v.update_id
      and u.runtime_version = v.runtime_version and u.channel = v.channel and u.platform = v.platform
    left join public.ota_embedded_updates e on v.launch_kind = 'embedded' and e.embedded_update_id = v.update_id
      and e.channel = v.channel and e.platform = v.platform
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

commit;

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

-- Atomic audience activation and incident deactivation (2026-10-22).
-- Apply after 2026-10-22-device-targeting.sql. Repeatable; no release backfill.
begin;

-- JS OTA forcing is distinct from asking for a new binary from the store.
insert into public.ota_guard_actions (action_key)
values ('ota-force-update')
on conflict (action_key) do nothing;

-- Audience changes and activations take the existing distribution advisory lock
-- before any row lock. Evaluate NEW.audience_mode in the activation statement,
-- rather than trusting an earlier application read followed by separate writes.
create or replace function public.ota_activate_audience()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_active and new.audience_mode = 'all' then
    perform public.assert_ota_distribution_mutation_allowed('activating a public OTA update');
    update public.ota_updates set is_active = false,
      disabled_at = clock_timestamp(), updated_at = clock_timestamp()
      where runtime_version = new.runtime_version and channel = new.channel
        and platform = new.platform and update_id <> new.update_id and is_active;
  end if;
  return new;
end $$;
revoke all on function public.ota_activate_audience() from public;
drop trigger if exists trg_ota_updates_activate_audience on public.ota_updates;
create trigger trg_ota_updates_activate_audience
before insert or update of is_active on public.ota_updates
for each row execute function public.ota_activate_audience();

create or replace function public.guard_ota_channel_distribution()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changes_distribution_state boolean;
  latest_active public.ota_updates%rowtype;
  surviving_rollback uuid;
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

  -- Disabling a targeted update can leave an active public fallback. Updating
  -- pointers to reflect that removal must remain possible while distribution is
  -- blocked, just as clearing the last active pointer was before targeting.
  -- Require an already retired pointer; do not permit a promotion or a new scope.
  if tg_op = 'UPDATE'
     and new.runtime_version = old.runtime_version
     and new.channel = old.channel and new.platform = old.platform
     and (
       (old.latest_update_id is not null and not exists (
         select 1 from public.ota_updates where update_id = old.latest_update_id and is_active))
       or (old.active_update_id is not null and not exists (
         select 1 from public.ota_updates where update_id = old.active_update_id and is_active))
     ) then
    select * into latest_active from public.ota_updates
      where runtime_version = old.runtime_version and channel = old.channel
        and platform = old.platform and is_active
      order by created_at desc, update_id desc limit 1;
    select update_id into surviving_rollback from public.ota_updates
      where update_id = old.active_update_id and is_active
        and update_id is distinct from latest_active.update_id;
    if new.latest_update_id is not distinct from latest_active.update_id
       and new.latest_created_at is not distinct from latest_active.created_at
       and new.latest_created_at_path is not distinct from latest_active.created_at_path
       and new.active_update_id is not distinct from surviving_rollback then
      return new;
    end if;
  end if;

  perform public.assert_ota_distribution_mutation_allowed(
    'changing OTA channel distribution state'
  );
  return new;
end;
$$;


commit;
