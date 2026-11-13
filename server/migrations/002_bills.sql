-- Módulo Contas: contas fixas e variáveis, recorrência e pagamentos

alter table user_settings add column fixed_limit_pct int not null default 40 check (fixed_limit_pct between 10 and 90);
-- renda líquida mensal informada; se nula, usa a média das entradas dos últimos 3 meses
alter table user_settings add column monthly_income_cents bigint;

create table bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  category_id uuid references categories(id) on delete set null,
  account_id uuid references accounts(id) on delete set null,   -- de onde costuma sair (conta ou cartão)
  amount_cents bigint not null check (amount_cents > 0),         -- valor mensal (previsto, se variável)
  nature text not null check (nature in ('fixa','variavel')),
  priority text not null default 'importante' check (priority in ('essencial','importante','superfluo')),
  due_day int not null check (due_day between 1 and 31),
  starts_on date not null default current_date,                  -- mês do primeiro vencimento
  ends_on date,                                                   -- último mês (null = sem fim)
  installments int check (installments > 0),                     -- total de parcelas (financiamento, parcelado)
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index on bills(user_id);

create table bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),         -- mês de competência (YYYY-MM)
  amount_cents bigint not null,
  paid_at timestamptz not null default now(),
  transaction_id uuid references transactions(id) on delete cascade,
  unique (bill_id, period)
);
create index on bill_payments(transaction_id);
