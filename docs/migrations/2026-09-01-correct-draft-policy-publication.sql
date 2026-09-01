begin;

-- The original policy migration could mistake the upload-time disabled marker
-- for historical publication. Remove only markers on conservative,
-- never-published draft signatures. The trigger must be absent for this
-- one-time repair because clearing policy_published_at is otherwise correctly
-- rejected for published rows.
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
  and u.guard_rules = '[]'::jsonb
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
