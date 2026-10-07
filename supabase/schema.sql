-- Run once in a NEW dedicated Supabase project's SQL editor.
begin;
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'Ma carte' check (char_length(title) between 1 and 100),
  profile jsonb not null default '{}'::jsonb check (jsonb_typeof(profile)='object' and octet_length(profile::text)<16000),
  avatar_path text,
  logo_path text,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint avatar_owner_path check (avatar_path is null or avatar_path like owner_id::text || '/' || id::text || '/%'),
  constraint logo_owner_path check (logo_path is null or logo_path like owner_id::text || '/' || id::text || '/%')
);
create index cards_owner_idx on public.cards(owner_id);
alter table public.cards enable row level security;
revoke all on public.cards from anon, authenticated;
grant select on public.cards to anon;
grant select,insert,update,delete on public.cards to authenticated;
create policy "Published cards are readable" on public.cards for select to anon,authenticated using(published=true);
create policy "Owners read their own cards" on public.cards for select to authenticated using(owner_id=(select auth.uid()));
create policy "Owners create their own cards" on public.cards for insert to authenticated with check(owner_id=(select auth.uid()));
create policy "Owners update their own cards" on public.cards for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy "Owners delete their own cards" on public.cards for delete to authenticated using(owner_id=(select auth.uid()));
create function public.cards_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.id<>old.id or new.owner_id<>old.owner_id then raise exception 'Card identity cannot change'; end if;
 new.updated_at=now();
 return new;
end;$$;
create trigger cards_before_update before update on public.cards for each row execute function public.cards_guard();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('card-images','card-images',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy "Owners upload images" on storage.objects for insert to authenticated with check(bucket_id='card-images' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "Owners read images" on storage.objects for select to authenticated using(bucket_id='card-images' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "Published card images readable" on storage.objects for select to anon,authenticated using(bucket_id='card-images' and exists(select 1 from public.cards c where c.published=true and (c.avatar_path=name or c.logo_path=name)));
create policy "Owners delete images" on storage.objects for delete to authenticated using(bucket_id='card-images' and (storage.foldername(name))[1]=(select auth.uid())::text);
commit;
