-- Divisões da entrada: cada receita é repartida em "potes" (dízimo, reserva, investimento, viagem, mesada…)
-- por percentual. Cada pote pode apontar para algo que já existe no app, e "separar" cria o lançamento certo.

create table divisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  name text not null,
  icon text not null default '📦',
  percent numeric(6,2) not null default 0 check (percent >= 0 and percent <= 100),
  -- para onde vai o dinheiro quando você "separa":
  --   nenhum       = só marca como feito
  --   reserva      = transfere para a conta/investimento marcado como reserva de emergência
  --   investimento = aporte no investimento destination_id
  --   meta         = soma ao valor guardado da meta destination_id
  --   categoria    = cria uma saída na categoria destination_id (dízimo, oferta…)
  --   conta        = transfere para a conta destination_id (mesada, conta da Rebeca…)
  destination_type text not null default 'nenhum'
    check (destination_type in ('nenhum','reserva','investimento','meta','categoria','conta')),
  destination_id uuid,
  -- só se aplica às entradas recebidas por esta pessoa (null = todas)
  only_for text,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on divisions(entity_id, position);

create table division_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  transaction_id uuid not null references transactions(id) on delete cascade,
  division_id uuid not null references divisions(id) on delete cascade,
  amount_cents bigint not null check (amount_cents >= 0),
  done_at timestamptz,
  done_transaction_id uuid references transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (transaction_id, division_id)
);
create index on division_allocations(entity_id, done_at);

-- quem recebeu a entrada (Ygor, Rebeca…) — usado pelas divisões com only_for
alter table transactions add column received_by text;

-- pessoas que recebem entradas nesta entidade
alter table entity_settings add column members text[] not null default '{}';
