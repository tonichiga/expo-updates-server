-- Stable manifest identity: publication epochs and immutable ID mappings.
begin;

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

commit;
