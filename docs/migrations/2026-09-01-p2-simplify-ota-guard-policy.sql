begin;

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

create trigger trg_ota_updates_lock_published_policy
before insert or update on public.ota_updates
for each row execute function public.ota_updates_lock_published_policy();

commit;
