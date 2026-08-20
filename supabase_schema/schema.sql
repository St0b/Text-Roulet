-- Run this file in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.chat_rooms (
    id uuid primary key default gen_random_uuid(),
    status text not null default 'waiting' check (status in ('waiting', 'active', 'closed')),
    created_at timestamptz not null default now(),
    closed_at timestamptz
);

create table if not exists public.chat_members (
    room_id uuid not null references public.chat_rooms(id) on delete cascade,
    client_id text not null,
    display_name text not null,
    last_seen timestamptz not null default now(),
    joined_at timestamptz not null default now(),
    primary key (room_id, client_id)
);

create table if not exists public.chat_messages (
    id bigint generated always as identity primary key,
    room_id uuid not null references public.chat_rooms(id) on delete cascade,
    sender_id text not null,
    body text not null check (char_length(body) between 1 and 500),
    created_at timestamptz not null default now()
);

create index if not exists chat_members_last_seen_idx on public.chat_members(last_seen);
create index if not exists chat_messages_room_created_idx on public.chat_messages(room_id, created_at);

alter table public.chat_rooms enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;

-- The server uses SUPABASE_SERVICE_ROLE_KEY for matchmaking and inserts.
-- Keep that key out of browser code and never expose it as a public policy.

alter table public.chat_messages replica identity full;
alter publication supabase_realtime add table public.chat_messages;
