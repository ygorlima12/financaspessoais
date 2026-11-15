-- Cartão de crédito: ciclo da fatura e limite
alter table accounts add column closing_day int check (closing_day between 1 and 31);
alter table accounts add column due_day int check (due_day between 1 and 31);
alter table accounts add column limit_cents bigint check (limit_cents > 0);
