-- Compras parceladas no cartão: a 1ª parcela é o lançamento; as demais viram uma conta parcelada em bills
alter table transactions add column installment_bill_id uuid references bills(id) on delete set null;
alter table transactions add column installment_no int;
alter table transactions add column installments int;
