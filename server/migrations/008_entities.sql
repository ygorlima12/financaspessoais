-- Entidades: Família, empresas... Cada uma com contas, categorias, lançamentos e configurações próprias.

create table entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  kind text not null default 'pessoal' check (kind in ('pessoal','empresa')),
  icon text not null default '🏠',
  color text not null default '#0a84ff',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index on entities(user_id);

-- Uma entidade "Família" para cada usuário existente
insert into entities (user_id, name, kind, icon, is_default)
select id, 'Família', 'pessoal', '🏠', true from users;

-- Configurações por entidade (as do usuário continuam em user_settings só para a chave da IA)
create table entity_settings (
  entity_id uuid primary key references entities(id) on delete cascade,
  reserve_months int not null default 6,
  reserve_monthly_cost_cents bigint,
  auto_confirm_captures boolean not null default false,
  fixed_limit_pct int not null default 40 check (fixed_limit_pct between 10 and 90),
  monthly_income_cents bigint,
  wish_monthly_cents bigint,
  updated_at timestamptz not null default now()
);
insert into entity_settings (entity_id, reserve_months, reserve_monthly_cost_cents, auto_confirm_captures, fixed_limit_pct, monthly_income_cents, wish_monthly_cents)
select e.id, s.reserve_months, s.reserve_monthly_cost_cents, s.auto_confirm_captures, s.fixed_limit_pct, s.monthly_income_cents, s.wish_monthly_cents
from entities e join user_settings s on s.user_id = e.user_id where e.is_default;

-- entity_id em todas as tabelas de dados, preenchido com a entidade padrão do usuário
do $$
declare t text;
begin
  foreach t in array array['accounts','categories','goals','investments','devices','app_links','transactions','captures','merchant_rules','bills','wishes','spend_checks']
  loop
    execute format('alter table %I add column entity_id uuid references entities(id) on delete cascade', t);
    execute format('update %I x set entity_id = e.id from entities e where e.user_id = x.user_id and e.is_default', t);
    execute format('alter table %I alter column entity_id set not null', t);
    execute format('create index on %I(entity_id)', t);
  end loop;
end $$;

-- A unicidade de categoria e de app_links passa a ser por entidade
alter table categories drop constraint categories_user_id_name_kind_key;
alter table categories add constraint categories_entity_name_kind_key unique (entity_id, name, kind);
alter table app_links drop constraint app_links_user_id_package_name_channel_key;
alter table app_links add constraint app_links_entity_package_channel_key unique (entity_id, package_name, channel);
alter table merchant_rules drop constraint merchant_rules_user_id_pattern_key;
alter table merchant_rules add constraint merchant_rules_entity_pattern_key unique (entity_id, pattern);
