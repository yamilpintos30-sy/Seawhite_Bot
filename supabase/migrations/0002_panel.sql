-- Panel de administración: el contexto (base de conocimiento) que el equipo sube
-- desde la web vive acá. En Render el disco se borra en cada deploy, así que un
-- archivo subido NO puede guardarse en disco: se guarda en esta tabla y el bot
-- la lee (si está vacía, usa los archivos de la carpeta knowledge/ del repo).
create table if not exists public.bot_knowledge (
  id          text primary key,            -- nombre lógico, p. ej. "CargaDocumentacion"
  content     text not null,
  note        text,                        -- de dónde salió (nombre del archivo subido)
  updated_at  timestamptz not null default now()
);

-- Historial: cada versión subida queda guardada para poder volver atrás.
create table if not exists public.bot_knowledge_versions (
  id          bigint generated always as identity primary key,
  knowledge_id text not null,
  content     text not null,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists bot_knowledge_versions_idx on public.bot_knowledge_versions (knowledge_id, created_at desc);

-- Sólo la service-role key (la del bot) entra: RLS activo y sin políticas.
alter table public.bot_knowledge enable row level security;
alter table public.bot_knowledge_versions enable row level security;

comment on table public.bot_knowledge is 'Contexto vigente del bot, editable desde el panel web.';
comment on table public.bot_knowledge_versions is 'Versiones anteriores del contexto (para volver atrás).';
