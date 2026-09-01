alter table public.ota_updates
  add column if not exists delivery_mode text not null default 'manual',
  add column if not exists guard_rules jsonb not null default '[]'::jsonb,
  add column if not exists policy_version integer not null default 1,
  add column if not exists policy_published_at timestamptz null;

alter table public.ota_updates
  drop constraint if exists ota_updates_delivery_mode_chk,
  add constraint ota_updates_delivery_mode_chk
    check (delivery_mode in ('manual', 'background')),
  drop constraint if exists ota_updates_guard_rules_array_chk,
  add constraint ota_updates_guard_rules_array_chk
    check (jsonb_typeof(guard_rules) = 'array'),
  drop constraint if exists ota_updates_policy_version_chk,
  add constraint ota_updates_policy_version_chk
    check (policy_version > 0);

-- Active rows, rows with an administrative state-change timestamp, rollback
-- targets, and explicitly pinned rows have participated in delivery.
update public.ota_updates u
set policy_published_at = coalesce(
  u.updated_at,
  u.disabled_at,
  u.created_at,
  now()
)
where u.policy_published_at is null
  and (
    u.is_active
    or (u.disabled_at is not null and u.updated_at is not null)
    or u.rolled_back_from_update_id is not null
    or exists (
      select 1
      from public.ota_update_channels c
      where c.active_update_id = u.update_id
    )
  );

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
    or new.guard_rules is distinct from old.guard_rules
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
