-- Lançamento "já refletido no saldo": conta nas estatísticas do mês, mas não altera o saldo da conta
alter table transactions add column counted_in_opening boolean not null default false;
