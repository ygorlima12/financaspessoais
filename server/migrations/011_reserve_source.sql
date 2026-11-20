-- Fonte do custo mensal usado na meta da reserva de emergência:
--   contas  = soma das contas cadastradas vigentes no mês (padrão)
--   media   = média das despesas dos últimos 3 meses
--   manual  = valor informado em reserve_monthly_cost_cents
alter table entity_settings add column if not exists reserve_cost_source text not null default 'contas';
-- Todas as entidades passam a usar as contas cadastradas; o valor manual fica guardado e pode ser reativado em Configurar.
