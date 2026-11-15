-- Sonhos: produtos que se quer comprar, priorizados, com meta/investimento atrelados

create table wishes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  url text,
  price_cents bigint not null check (price_cents > 0),
  image_url text,
  notes text,
  rank int not null default 0,                 -- ordem de prioridade (menor = primeiro)
  status text not null default 'sonhando' check (status in ('sonhando','juntando','comprado','desistiu')),
  goal_id uuid references goals(id) on delete set null,
  bought_at date,
  bought_transaction_id uuid references transactions(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on wishes(user_id, status, rank);

-- quanto consegue guardar por mês para os sonhos (null = usa a sobra da análise de contas)
alter table user_settings add column wish_monthly_cents bigint;
