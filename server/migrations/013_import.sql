-- Importação de extrato CSV: cada linha importada (ou reconhecida) guarda uma impressão digital
-- para que reimportar o mesmo arquivo não duplique nada.
alter table transactions drop constraint if exists transactions_source_check;
alter table transactions add constraint transactions_source_check check (source in ('manual','notificacao','importacao'));

create table import_rows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  fingerprint text not null,                 -- data|valor|descrição|detalhe|nº de repetição no dia
  transaction_id uuid references transactions(id) on delete cascade,
  ignored boolean not null default false,
  created_at timestamptz not null default now(),
  unique (account_id, fingerprint)
);
