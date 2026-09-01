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

create unique index if not exists idx_ota_updates_one_active_per_scope
  on public.ota_updates (runtime_version, channel, platform)
  where is_active;

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
  ) then
    new.served_manifest_id := gen_random_uuid();
    new.served_manifest_changed_at := now();
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