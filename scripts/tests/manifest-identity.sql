-- Run only in a disposable database after schema.sql and the identity migration:
-- psql "$OTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/tests/manifest-identity.sql
-- All test fixtures and switch changes are rolled back.
begin;

do $$
declare
  update_a uuid := gen_random_uuid();
  update_b uuid := gen_random_uuid();
  manifest_id uuid := gen_random_uuid();
  test_scope text := 'manifest-identity-test-' || gen_random_uuid()::text;
  previous_epoch uuid;
  previous_time timestamptz;
  current_channel public.ota_update_channels%rowtype;
  original_mapping public.ota_served_manifest_log%rowtype;
  field_name text;
  replacement text;
begin
  update public.ota_distribution_control
     set blocked = false, reason = null
   where singleton_id = 1;

  insert into public.ota_updates (
    update_id, build_id, runtime_version, channel, platform, created_at,
    created_at_path, storage_bucket, storage_base_path, manifest
  )
  values
    (update_a, update_a, test_scope, test_scope, 'android', now() - interval '2 days',
     'a', 'test', 'a', '{}'),
    (update_b, update_b, test_scope, test_scope, 'android', now() - interval '1 day',
     'b', 'test', 'b', '{}');

  insert into public.ota_update_channels (
    runtime_version, channel, platform, latest_update_id
  ) values (test_scope, test_scope, 'android', update_a);

  update public.ota_updates set is_active = true where update_id = update_a;
  select * into strict current_channel from public.ota_update_channels
   where runtime_version = test_scope;
  previous_epoch := current_channel.served_manifest_id;
  previous_time := current_channel.served_manifest_changed_at;

  -- A repeated activation must not create a new publication.
  update public.ota_updates set is_active = true where update_id = update_a;
  select * into strict current_channel from public.ota_update_channels
   where runtime_version = test_scope;
  if current_channel.served_manifest_id <> previous_epoch
     or current_channel.served_manifest_changed_at <> previous_time then
    raise exception 'No-op activation rotated the epoch';
  end if;

  -- Uploading draft B moves latest; A is still the active fallback.
  update public.ota_update_channels set latest_update_id = update_b
   where runtime_version = test_scope;
  select * into strict current_channel from public.ota_update_channels
   where runtime_version = test_scope;
  if current_channel.served_manifest_id = previous_epoch
     or date_trunc('milliseconds', current_channel.served_manifest_changed_at)
        <= date_trunc('milliseconds', previous_time) then
    raise exception 'Draft upload did not advance the epoch';
  end if;
  previous_epoch := current_channel.served_manifest_id;
  previous_time := current_channel.served_manifest_changed_at;

  update public.ota_updates set is_active = false where update_id = update_a;
  update public.ota_updates set is_active = true where update_id = update_b;
  select * into strict current_channel from public.ota_update_channels
   where runtime_version = test_scope;
  if current_channel.latest_update_id <> update_b
     or current_channel.active_update_id is not null
     or current_channel.served_manifest_id = previous_epoch
     or date_trunc('milliseconds', current_channel.served_manifest_changed_at)
        <= date_trunc('milliseconds', previous_time) then
    raise exception 'Draft activation with unchanged pointers did not advance the epoch';
  end if;

  -- Clock skew and repeated operations inside one transaction remain monotonic.
  update public.ota_update_channels
     set served_manifest_changed_at = clock_timestamp() + interval '1 day'
   where runtime_version = test_scope;
  select served_manifest_changed_at into previous_time from public.ota_update_channels
   where runtime_version = test_scope;
  update public.ota_update_channels
     set active_update_id = update_a, active_changed_at = clock_timestamp()
   where runtime_version = test_scope;
  select * into strict current_channel from public.ota_update_channels
   where runtime_version = test_scope;
  if date_trunc('milliseconds', current_channel.served_manifest_changed_at)
     <= date_trunc('milliseconds', previous_time) then
    raise exception 'Pointer rotation moved publication time backwards';
  end if;
  previous_epoch := current_channel.served_manifest_id;
  previous_time := current_channel.served_manifest_changed_at;
  update public.ota_update_channels
     set active_changed_at = active_changed_at + interval '1 millisecond'
   where runtime_version = test_scope;
  select * into strict current_channel from public.ota_update_channels
   where runtime_version = test_scope;
  if current_channel.served_manifest_id = previous_epoch
     or date_trunc('milliseconds', current_channel.served_manifest_changed_at)
        <= date_trunc('milliseconds', previous_time) then
    raise exception 'Repeated rollback did not advance identity and time';
  end if;

  -- The emergency distribution guard still wins; no epoch mutation on failure.
  previous_epoch := current_channel.served_manifest_id;
  previous_time := current_channel.served_manifest_changed_at;
  update public.ota_updates set is_active = false where update_id = update_b;
  update public.ota_distribution_control
     set blocked = true, reason = 'manifest identity test'
   where singleton_id = 1;
  begin
    update public.ota_updates set is_active = true where update_id = update_a;
    raise exception 'Blocked activation unexpectedly succeeded';
  exception when sqlstate 'P0OTA' then
    null;
  end;
  select * into strict current_channel from public.ota_update_channels
   where runtime_version = test_scope;
  if current_channel.served_manifest_id <> previous_epoch
     or current_channel.served_manifest_changed_at <> previous_time then
    raise exception 'Blocked activation changed channel identity';
  end if;
  update public.ota_distribution_control set blocked = false, reason = null
   where singleton_id = 1;

  insert into public.ota_served_manifest_log (
    served_manifest_id, update_id, runtime_version, channel, platform, reason
  ) values (manifest_id, update_a, test_scope, test_scope, 'android', 'deploy');
  select * into strict original_mapping from public.ota_served_manifest_log
   where served_manifest_id = manifest_id;

  -- Equivalent retries (including ON CONFLICT) succeed and preserve first-seen.
  insert into public.ota_served_manifest_log (
    served_manifest_id, update_id, runtime_version, channel, platform, reason, created_at
  ) values (manifest_id, update_a, test_scope, test_scope, 'android', 'rollback', now() + interval '1 hour')
  on conflict (served_manifest_id) do update set
    update_id = excluded.update_id, runtime_version = excluded.runtime_version,
    channel = excluded.channel, platform = excluded.platform,
    reason = excluded.reason, created_at = excluded.created_at;
  if (select created_at from public.ota_served_manifest_log where served_manifest_id = manifest_id)
     <> original_mapping.created_at then
    raise exception 'Mapping retry changed the first-recorded time';
  end if;

  -- A conflicting upsert cannot silently relabel previously served devices.
  begin
    insert into public.ota_served_manifest_log (
      served_manifest_id, update_id, runtime_version, channel, platform
    ) values (manifest_id, update_b, test_scope, test_scope, 'android')
    on conflict (served_manifest_id) do update set update_id = excluded.update_id;
    raise exception 'Conflicting mapping upsert unexpectedly succeeded';
  exception when check_violation then
    if sqlerrm not like 'OTA_MANIFEST_IDENTITY_CONFLICT:%' then raise; end if;
  end;

  foreach field_name in array array[
    'served_manifest_id', 'update_id', 'runtime_version', 'channel', 'platform'
  ] loop
    replacement := case field_name
      when 'served_manifest_id' then gen_random_uuid()::text
      when 'update_id' then update_b::text
      when 'platform' then 'ios'
      else 'changed'
    end;
    begin
      execute format(
        'update public.ota_served_manifest_log set %I = %L where served_manifest_id = %L',
        field_name, replacement, manifest_id
      );
      raise exception 'Changing identity field % unexpectedly succeeded', field_name;
    exception when check_violation then
      if sqlerrm not like 'OTA_MANIFEST_IDENTITY_CONFLICT:%' then raise; end if;
    end;
  end loop;

  if (select update_id from public.ota_served_manifest_log where served_manifest_id = manifest_id)
     <> update_a then
    raise exception 'Historical mapping was modified';
  end if;

  -- Direct active inserts also rotate an already existing empty channel.
  insert into public.ota_update_channels (runtime_version, channel, platform)
  values (test_scope, test_scope || '-insert', 'android')
  returning served_manifest_id, served_manifest_changed_at
  into previous_epoch, previous_time;
  insert into public.ota_updates (
    update_id, build_id, runtime_version, channel, platform, created_at,
    created_at_path, storage_bucket, storage_base_path, manifest, is_active
  ) values (
    gen_random_uuid(), gen_random_uuid(), test_scope, test_scope || '-insert',
    'android', now(), 'insert', 'test', 'insert', '{}', true
  );
  select * into strict current_channel from public.ota_update_channels
   where runtime_version = test_scope and channel = test_scope || '-insert';
  if current_channel.served_manifest_id = previous_epoch
     or date_trunc('milliseconds', current_channel.served_manifest_changed_at)
        <= date_trunc('milliseconds', previous_time) then
    raise exception 'Active insert did not advance an existing channel epoch';
  end if;
end;
$$;

rollback;
