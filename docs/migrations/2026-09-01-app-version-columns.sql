alter table public.ota_embedded_updates
  add column if not exists app_version text null;

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
