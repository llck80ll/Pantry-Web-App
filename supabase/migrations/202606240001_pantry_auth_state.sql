create table if not exists public.pantry_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  household_size integer check (household_size is null or household_size between 1 and 20),
  cooking_level text check (cooking_level is null or cooking_level in ('beginner', 'home_cook', 'confident', 'advanced')),
  dietary_preferences text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pantry_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  selected_ingredients jsonb not null default '[]'::jsonb,
  favorite_recipes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint selected_ingredients_is_array check (jsonb_typeof(selected_ingredients) = 'array'),
  constraint favorite_recipes_is_array check (jsonb_typeof(favorite_recipes) = 'array')
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_pantry_profiles_updated_at on public.pantry_profiles;
create trigger set_pantry_profiles_updated_at
before update on public.pantry_profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_pantry_user_state_updated_at on public.pantry_user_state;
create trigger set_pantry_user_state_updated_at
before update on public.pantry_user_state
for each row execute function public.set_updated_at();

create or replace function public.create_pantry_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pantry_profiles (
    id,
    name,
    household_size,
    cooking_level,
    dietary_preferences
  )
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data ->> 'household_size', '')::integer,
    nullif(new.raw_user_meta_data ->> 'cooking_level', ''),
    coalesce(
      array(select jsonb_array_elements_text(new.raw_user_meta_data -> 'dietary_preferences')),
      '{}'::text[]
    )
  )
  on conflict (id) do nothing;

  insert into public.pantry_user_state (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists create_pantry_profile_after_signup on auth.users;
create trigger create_pantry_profile_after_signup
after insert on auth.users
for each row execute function public.create_pantry_profile_for_new_user();

alter table public.pantry_profiles enable row level security;
alter table public.pantry_user_state enable row level security;

drop policy if exists "Users can read their own pantry profile" on public.pantry_profiles;
create policy "Users can read their own pantry profile"
on public.pantry_profiles for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Users can update their own pantry profile" on public.pantry_profiles;
create policy "Users can update their own pantry profile"
on public.pantry_profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "Users can insert their own pantry profile" on public.pantry_profiles;
create policy "Users can insert their own pantry profile"
on public.pantry_profiles for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "Users can read their own pantry state" on public.pantry_user_state;
create policy "Users can read their own pantry state"
on public.pantry_user_state for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can write their own pantry state" on public.pantry_user_state;
create policy "Users can write their own pantry state"
on public.pantry_user_state for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own pantry state" on public.pantry_user_state;
create policy "Users can update their own pantry state"
on public.pantry_user_state for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke execute on function public.create_pantry_profile_for_new_user() from public;
revoke execute on function public.set_updated_at() from public;
