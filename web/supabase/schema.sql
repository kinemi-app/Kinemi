-- Kinemi accounts: run this once in your Supabase project (SQL Editor → New query → paste → Run).
-- It is safe to run again: everything is created only if it isn't there yet.
--
-- What it makes:
--   studio_items        every user's studio, one row per asset, folder, tag, chat, cast member,
--                       plus one row each for the settings and the drafts
--   delete_my_account() lets a signed-in user delete their own account (Settings → Account)
--   studio-files        a private bucket for the images and clips people import
-- Row Level Security keeps every user to their own rows and their own folder of files.

-- ---------------------------------------------------------------------------
-- The studio
-- ---------------------------------------------------------------------------
create table if not exists public.studio_items (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text        not null check (kind in ('asset', 'folder', 'tag', 'chat', 'cast', 'settings', 'drafts')),
  id         text        not null check (char_length(id) between 1 and 200),
  data       jsonb       not null default '{}'::jsonb,
  -- a deletion is kept as a mark, so every device learns about it
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);

-- devices ask for "everything that changed since…"
create index if not exists studio_items_changed on public.studio_items (user_id, updated_at);

alter table public.studio_items enable row level security;

drop policy if exists "studio: read own" on public.studio_items;
create policy "studio: read own" on public.studio_items
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "studio: add own" on public.studio_items;
create policy "studio: add own" on public.studio_items
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "studio: change own" on public.studio_items;
create policy "studio: change own" on public.studio_items
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "studio: delete own" on public.studio_items;
create policy "studio: delete own" on public.studio_items
  for delete to authenticated using ((select auth.uid()) = user_id);

-- updated_at always comes from the server's clock
create or replace function public.studio_items_touch() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists studio_items_touch on public.studio_items;
create trigger studio_items_touch before insert or update on public.studio_items
  for each row execute function public.studio_items_touch();

-- ---------------------------------------------------------------------------
-- Deleting your own account (the studio's rows go with it: on delete cascade)
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account() returns void
  language sql security definer set search_path = '' as $$
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Imported files: studio-files/<user id>/<asset id>, private, 50 MB each at most
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('studio-files', 'studio-files', false, 52428800, array['image/*', 'video/*', 'audio/*'])
on conflict (id) do nothing;

drop policy if exists "studio files: read own" on storage.objects;
create policy "studio files: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'studio-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "studio files: add own" on storage.objects;
create policy "studio files: add own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'studio-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "studio files: change own" on storage.objects;
create policy "studio files: change own" on storage.objects
  for update to authenticated
  using (bucket_id = 'studio-files' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'studio-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "studio files: delete own" on storage.objects;
create policy "studio files: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'studio-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
