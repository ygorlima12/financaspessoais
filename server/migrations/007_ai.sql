-- Chave da API da Claude por usuário (criptografada) e histórico de consultas "posso gastar?"
alter table user_settings add column anthropic_key_enc text;
alter table user_settings add column anthropic_model text;

create table spend_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  amount_cents bigint not null,
  purpose text not null,
  reason text,
  category_id uuid references categories(id) on delete set null,
  account_id uuid references accounts(id) on delete set null,
  priority text,
  verdict text not null,
  headline text,
  explanation text,
  used_ai boolean not null default false,
  created_at timestamptz not null default now()
);
create index on spend_checks(user_id, created_at desc);
