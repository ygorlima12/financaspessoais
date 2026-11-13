-- Meu Rumo Finanças — schema inicial
-- Valores monetários sempre em centavos (bigint).

create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table user_settings (
  user_id uuid primary key references users(id) on delete cascade,
  reserve_months int not null default 6,
  -- custo mensal informado manualmente; se nulo, usa a média de despesas dos últimos 3 meses
  reserve_monthly_cost_cents bigint,
  auto_confirm_captures boolean not null default false,
  updated_at timestamptz not null default now()
);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('corrente','poupanca','carteira','cartao','outro')),
  bank text,
  initial_balance_cents bigint not null default 0,
  color text not null default '#0a84ff',
  is_reserve boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index on accounts(user_id);

create table categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('receita','despesa')),
  icon text not null default '•',
  color text not null default '#8e8e93',
  monthly_budget_cents bigint,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name, kind)
);
create index on categories(user_id);

create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  icon text not null default '🎯',
  target_cents bigint not null check (target_cents > 0),
  saved_cents bigint not null default 0,
  deadline date,
  achieved boolean not null default false,
  created_at timestamptz not null default now()
);
create index on goals(user_id);

create table investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('renda_fixa','tesouro','acoes','fii','etf','cripto','previdencia','outro')),
  institution text,
  liquidity text,
  is_reserve boolean not null default false,
  goal_id uuid references goals(id) on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index on investments(user_id);

-- Dispositivos que enviam notificações (cada um com seu token)
create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  token_hint text not null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

-- Liga um app de banco (pacote Android) a uma conta.
-- channel separa "cartao" (compras no crédito) de "conta" (Pix, débito, transferências) do mesmo app.
create table app_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  package_name text not null,
  channel text not null default 'conta' check (channel in ('conta','cartao')),
  account_id uuid references accounts(id) on delete set null,
  auto_confirm boolean not null default false,
  unique (user_id, package_name, channel)
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  kind text not null check (kind in ('receita','despesa','transferencia','aporte','resgate')),
  amount_cents bigint not null check (amount_cents > 0),
  description text not null default '',
  occurred_at timestamptz not null default now(),
  transfer_account_id uuid references accounts(id) on delete cascade,
  investment_id uuid references investments(id) on delete set null,
  source text not null default 'manual' check (source in ('manual','notificacao')),
  notes text,
  created_at timestamptz not null default now()
);
create index on transactions(user_id, occurred_at desc);
create index on transactions(account_id);

-- Movimentos de investimento: aporte, resgate e rendimento (positivo ou negativo)
create table investment_movements (
  id uuid primary key default gen_random_uuid(),
  investment_id uuid not null references investments(id) on delete cascade,
  kind text not null check (kind in ('aporte','resgate','rendimento')),
  amount_cents bigint not null,
  occurred_at timestamptz not null default now(),
  transaction_id uuid references transactions(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index on investment_movements(investment_id, occurred_at);

-- Caixa de entrada: notificações capturadas
create table captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  device_id uuid references devices(id) on delete set null,
  package_name text,
  app_name text,
  title text,
  text text not null,
  received_at timestamptz not null default now(),
  amount_cents bigint,
  kind text check (kind in ('receita','despesa')),
  merchant text,
  bank text,
  channel text not null default 'conta' check (channel in ('conta','cartao')),
  confidence text check (confidence in ('alta','media','baixa')),
  status text not null default 'pendente' check (status in ('pendente','confirmada','ignorada','descartada')),
  discard_reason text,
  duplicate_of uuid references captures(id) on delete set null,
  transaction_id uuid references transactions(id) on delete set null,
  fingerprint text not null,
  created_at timestamptz not null default now()
);
create index on captures(user_id, status, received_at desc);
create index on captures(user_id, fingerprint, received_at desc);

-- Aprendizado de categoria por estabelecimento
create table merchant_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  pattern text not null,
  category_id uuid not null references categories(id) on delete cascade,
  unique (user_id, pattern)
);
