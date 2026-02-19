-- ============================================================
-- WashUMed26 - DEXA App Initial Schema
-- Run in Supabase SQL Editor in order (top to bottom)
-- ============================================================

-- ----------------------------------------------------------------
-- TIER 1: profiles
-- Extends auth.users. Auto-populated via trigger on signup.
-- ----------------------------------------------------------------
create table profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  created_at timestamp with time zone default now()
);

-- ----------------------------------------------------------------
-- TIER 2: upload_sessions
-- One row per upload batch. Stores session metadata and stats.
-- ----------------------------------------------------------------
create table upload_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  created_at timestamp with time zone default now(),
  status text default 'success',          -- 'success' | 'partial' | 'failed'
  files_uploaded int,
  files_processed int,
  total_records int,
  duplicates_removed int,
  imputation_strategy text,
  batches_processed jsonb,                -- e.g. ["Batch_1", "Batch_2"]
  timepoints_found jsonb,                 -- e.g. ["Baseline", "Week_1"]
  csv_filename text,                      -- e.g. "DEXA_Enhanced_20260218_1445_01.csv"
  processing_warnings jsonb               -- array of warning strings
);

-- ----------------------------------------------------------------
-- TIER 3: dexa_records
-- One row per individual animal/subject measurement.
-- user_id is denormalized from the session for fast per-user queries.
-- ----------------------------------------------------------------
create table dexa_records (
  id uuid default gen_random_uuid() primary key,
  session_id uuid references upload_sessions(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  created_at timestamp with time zone default now(),
  -- Metadata
  batch text,
  subject_id text,
  timepoint text,
  gender text,
  filename text,
  -- DEXA Measurements
  total_weight numeric,
  soft_weight numeric,
  lean_weight numeric,
  fat_weight numeric,
  fat_percent numeric,
  bmc numeric,
  bmd numeric,
  bone_area numeric,
  sample_area numeric
);

-- ----------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Each user can only see and insert their own rows.
-- ----------------------------------------------------------------
alter table profiles enable row level security;
alter table upload_sessions enable row level security;
alter table dexa_records enable row level security;

-- profiles
create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

-- upload_sessions
create policy "Users can view own sessions"
  on upload_sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert own sessions"
  on upload_sessions for insert
  with check (auth.uid() = user_id);

-- dexa_records
create policy "Users can view own records"
  on dexa_records for select
  using (auth.uid() = user_id);

create policy "Users can insert own records"
  on dexa_records for insert
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------
-- TRIGGER: Auto-create profile row on new user signup
-- ----------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
