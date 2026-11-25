alter table public.ota_updates
  drop constraint if exists ota_updates_delivery_mode_chk,
  add constraint ota_updates_delivery_mode_chk
    check (delivery_mode in ('manual', 'background', 'manual-postpone')
    and (delivery_mode <> 'manual-postpone' or guard_action is null));
