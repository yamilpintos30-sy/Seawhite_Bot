-- Último análisis de conversaciones por período (pestaña "Temas y quejas").
-- Se guarda para que el panel lo muestre al instante: generarlo de nuevo en
-- cada visita tarda y cuesta una llamada a la IA.
create table if not exists public.bot_insights (
  id          text primary key,           -- "dias:30"
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);

alter table public.bot_insights enable row level security;

comment on table public.bot_insights is 'Último análisis con IA de las conversaciones, por período.';
