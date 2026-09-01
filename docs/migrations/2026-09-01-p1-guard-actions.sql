create extension if not exists pgcrypto;

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
