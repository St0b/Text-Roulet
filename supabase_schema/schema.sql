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
    last_message_id bigint not null default 0,
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

create or replace function public.join_chat(p_client_id text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_room_id uuid;
    v_partner_name text := '';
begin
    select id into v_room_id from chat_rooms
    where status = 'waiting' order by created_at for update skip locked limit 1;
    if v_room_id is null then
        insert into chat_rooms(status) values ('waiting') returning id into v_room_id;
        insert into chat_members(room_id, client_id, display_name)
        values (v_room_id, p_client_id, p_display_name);
        return jsonb_build_object('state', 'waiting', 'partner', '', 'events', '[]'::jsonb);
    end if;
    select display_name into v_partner_name from chat_members where room_id = v_room_id limit 1;
    insert into chat_members(room_id, client_id, display_name)
    values (v_room_id, p_client_id, p_display_name);
    update chat_rooms set status = 'active' where id = v_room_id;
    return jsonb_build_object('state', 'matched', 'partner', v_partner_name,
        'events', jsonb_build_array(jsonb_build_object('type', 'matched', 'partner', v_partner_name)));
end;
$$;

create or replace function public.poll_chat(p_client_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_room_id uuid;
    v_last_id bigint;
    v_partner text := '';
    v_messages jsonb;
begin
    select room_id, last_message_id into v_room_id, v_last_id from chat_members where client_id = p_client_id;
    if v_room_id is null then return null; end if;
    update chat_members set last_seen = now() where client_id = p_client_id;
    select display_name into v_partner from chat_members where room_id = v_room_id and client_id <> p_client_id limit 1;
    select coalesce(jsonb_agg(jsonb_build_object('type','message','from',m.sender_id,'text',m.body) order by m.id), '[]'::jsonb)
    into v_messages from chat_messages m where m.room_id = v_room_id and m.id > v_last_id and m.sender_id <> p_client_id;
    select coalesce(max(id), v_last_id) into v_last_id from chat_messages where room_id = v_room_id;
    update chat_members set last_message_id = v_last_id where client_id = p_client_id;
    return jsonb_build_object('state', case when v_partner is null or v_partner = '' then 'waiting' else 'matched' end,
        'partner', coalesce(v_partner, ''), 'events', v_messages);
end;
$$;

create or replace function public.send_chat_message(p_client_id text, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_room_id uuid; v_member_count integer;
begin
    select room_id into v_room_id from chat_members where client_id = p_client_id;
    select count(*) into v_member_count from chat_members where room_id = v_room_id;
    if v_room_id is null or v_member_count <> 2 or length(trim(p_text)) = 0 then return jsonb_build_object('ok', false); end if;
    insert into chat_messages(room_id, sender_id, body) values (v_room_id, p_client_id, left(trim(p_text), 500));
    update chat_members set last_seen = now() where client_id = p_client_id;
    return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.next_chat(p_client_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_old_room_id uuid;
    v_new_room_id uuid;
    v_partner_name text := '';
begin
    select room_id into v_old_room_id from chat_members where client_id = p_client_id for update;
    if v_old_room_id is not null then
        delete from chat_members where client_id = p_client_id;
        update chat_rooms set status = 'closed', closed_at = now() where id = v_old_room_id;
    end if;

    select id into v_new_room_id from chat_rooms
    where status = 'waiting' order by created_at for update skip locked limit 1;
    if v_new_room_id is null then
        insert into chat_rooms(status) values ('waiting') returning id into v_new_room_id;
        insert into chat_members(room_id, client_id, display_name)
        values (v_new_room_id, p_client_id, 'visitor-' || left(p_client_id, 4));
        return jsonb_build_object('state', 'waiting', 'partner', '', 'events', '[]'::jsonb);
    end if;
    select display_name into v_partner_name from chat_members where room_id = v_new_room_id limit 1;
    insert into chat_members(room_id, client_id, display_name)
    values (v_new_room_id, p_client_id, 'visitor-' || left(p_client_id, 4));
    update chat_rooms set status = 'active' where id = v_new_room_id;
    return jsonb_build_object('state', 'matched', 'partner', v_partner_name,
        'events', jsonb_build_array(jsonb_build_object('type', 'matched', 'partner', v_partner_name)));
end;
$$;

create or replace function public.leave_chat(p_client_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_room_id uuid;
begin
    select room_id into v_room_id from chat_members where client_id = p_client_id;
    delete from chat_members where client_id = p_client_id;
    if v_room_id is not null then
        update chat_rooms set status = 'closed', closed_at = now() where id = v_room_id;
    end if;
    return jsonb_build_object('ok', true);
end;
$$;
