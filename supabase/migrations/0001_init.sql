-- Esquema inicial del bot de WhatsApp SEA WHITE.
-- Ejecutar en el SQL Editor de Supabase (proyecto "Sea-White-chatbot") o con `supabase db push`.

-- Sesiones: estado de la conversación por cada chat de Chatwoot.
create table if not exists public.bot_sessions (
  conversation_id   text primary key,
  account_id        text not null,
  state             text not null,
  context           jsonb not null default '{}'::jsonb,
  history           jsonb not null default '[]'::jsonb,
  handed_off_until  timestamptz,
  contact           jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists bot_sessions_updated_at_idx on public.bot_sessions (updated_at);

-- Registro de mensajes entrantes y salientes (auditoría / mejora de la base de conocimiento).
create table if not exists public.bot_messages (
  id               bigint generated always as identity primary key,
  conversation_id  text not null,
  account_id       text not null,
  direction        text not null check (direction in ('in', 'out')),
  content          text,
  state            text,
  meta             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists bot_messages_conversation_idx on public.bot_messages (conversation_id, created_at);
create index if not exists bot_messages_created_at_idx on public.bot_messages (created_at);

-- El bot accede con la service-role key (que ignora RLS). Activamos RLS sin políticas
-- para que la anon key no pueda leer ni escribir estas tablas.
alter table public.bot_sessions enable row level security;
alter table public.bot_messages enable row level security;

comment on table public.bot_sessions is 'Estado de cada conversación del bot de WhatsApp (menú actual, contexto, historial corto).';
comment on table public.bot_messages is 'Mensajes entrantes/salientes del bot para auditoría y análisis de consultas.';
