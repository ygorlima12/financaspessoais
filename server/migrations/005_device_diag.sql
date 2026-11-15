-- Diagnóstico do celular: o que chegou no último envio e qual foi o resultado
alter table devices add column last_status text;
alter table devices add column last_result text;
alter table devices add column last_payload text;
