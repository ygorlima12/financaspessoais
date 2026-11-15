-- Cartão com dinheiro guardado: cada compra no cartão pode ser marcada como "guardada"
alter table transactions add column reserved_at timestamptz;
-- transferência (conta -> poupança) criada ao marcar como guardada, se o cartão estiver configurado
alter table transactions add column reserve_transaction_id uuid references transactions(id) on delete set null;
-- configuração por cartão: de onde sai e onde fica o dinheiro guardado
alter table accounts add column reserve_account_id uuid references accounts(id) on delete set null;
alter table accounts add column reserve_from_account_id uuid references accounts(id) on delete set null;
alter table accounts add column reserve_required boolean not null default true;
