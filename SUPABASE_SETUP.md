# Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run [`supabase_schema/schema.sql`](supabase_schema/schema.sql).
3. Copy `.env.example` to `.env` for local development.
4. Fill in the project URL, anon key, and service-role key from **Project Settings -> API**.
5. In Vercel, add the same values under **Project Settings -> Environment Variables**.

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Never put it into `page.py`, browser JavaScript, or a public environment variable.

The current local in-memory matchmaking remains the fallback until the Supabase matchmaking adapter is enabled. The database schema and backend client are ready for that migration; realtime messages should use the `chat_messages` table, which is already added to the `supabase_realtime` publication.
