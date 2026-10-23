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
