import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNotification, toCents } from './parse.js';

type Case = {
  name: string;
  title?: string;
  text: string;
  pkg?: string;
  expect: { amount?: number; kind?: 'receita' | 'despesa' | null; merchant?: string | null; discard?: boolean; bank?: string };
};

const cases: Case[] = [
  { name: 'Nubank compra crédito', pkg: 'com.nu.production', title: 'Compra aprovada',
    text: 'Compra de R$ 45,90 APROVADA em PADARIA PAO QUENTE para o cartão com final 1234.',
    expect: { amount: 4590, kind: 'despesa', merchant: 'PADARIA PAO QUENTE', bank: 'Nubank' } },
  { name: 'Nubank transferência recebida', pkg: 'com.nu.production', title: 'Transferência recebida',
    text: 'Você recebeu uma transferência de R$ 1.250,00 de MARIA DA SILVA.',
    expect: { amount: 125000, kind: 'receita', merchant: 'MARIA DA SILVA' } },
  { name: 'Nubank pix recebido', pkg: 'com.nu.production',
    text: 'Você recebeu um Pix de R$ 80,00 de João Pereira.',
    expect: { amount: 8000, kind: 'receita', merchant: 'João Pereira' } },
  { name: 'Pix enviado', pkg: 'br.com.intermedium', title: 'Pix enviado',
    text: 'Pix de R$ 50,00 enviado para Carlos Souza.',
    expect: { amount: 5000, kind: 'despesa', merchant: 'Carlos Souza', bank: 'Inter' } },
  { name: 'Inter compra', pkg: 'br.com.intermedium',
    text: 'Compra aprovada no valor de R$ 23,50 em MERCADO BOM PRECO.',
    expect: { amount: 2350, kind: 'despesa', merchant: 'MERCADO BOM PRECO' } },
  { name: 'Itaú com hífen', pkg: 'com.itau',
    text: 'Compra aprovada no seu cartão final 1234 - R$ 89,90 - LOJAS RENNER',
    expect: { amount: 8990, kind: 'despesa', merchant: 'LOJAS RENNER', bank: 'Itaú' } },
  { name: 'C6 uber', pkg: 'com.c6bank.app',
    text: 'Compra aprovada: R$ 15,00 em UBER *TRIP às 22:10',
    expect: { amount: 1500, kind: 'despesa', merchant: 'UBER *TRIP' } },
  { name: 'Caixa valor depois', pkg: 'br.gov.caixa.tem',
    text: 'Pix recebido de FULANO DE TAL no valor de R$ 100,00',
    expect: { amount: 10000, kind: 'receita', merchant: 'FULANO DE TAL' } },
  { name: 'Mercado Pago você pagou', pkg: 'com.mercadopago.wallet',
    text: 'Você pagou R$ 32,40 a Restaurante Sabor.',
    expect: { amount: 3240, kind: 'despesa', merchant: 'Restaurante Sabor' } },
  { name: 'Valor com milhar sem centavos', text: 'Você recebeu R$ 2.000 de Empresa X',
    expect: { amount: 200000, kind: 'receita' } },
  { name: 'Estorno', pkg: 'com.nu.production',
    text: 'Estorno de compra de R$ 19,90 em NETFLIX.COM',
    expect: { amount: 1990, kind: 'receita' } },
  { name: 'Compra recusada', pkg: 'com.nu.production',
    text: 'Compra de R$ 300,00 em LOJA X foi recusada por saldo insuficiente.',
    expect: { discard: true } },
  { name: 'Compra negada', text: 'Compra NEGADA no valor de R$ 99,00 em AMAZON',
    expect: { discard: true } },
  { name: 'Promo', text: 'Você tem R$ 5.000,00 de empréstimo pré-aprovado! Aproveite.',
    expect: { discard: true } },
  { name: 'Rendimento', text: 'Seu dinheiro rendeu R$ 3,21 este mês.',
    expect: { discard: true } },
  { name: 'Aviso de fatura', text: 'Sua fatura fechou! Valor: R$ 1.234,56. Vencimento 10/12.',
    expect: { discard: true } },
  { name: 'Código', text: 'Seu código de verificação é 123456',
    expect: { discard: true } },
  { name: 'Pix agendado', text: 'Pix agendado de R$ 200,00 para amanhã',
    expect: { discard: true } },
  { name: 'Compra com limite disponível no texto continua valendo', pkg: 'com.nu.production',
    text: 'Compra aprovada de R$ 12,00 em PADARIA. Limite disponível: R$ 900,00',
    expect: { amount: 1200, kind: 'despesa', merchant: 'PADARIA' } },
  { name: 'Débito', text: 'Compra no débito de R$ 7,50 em CAFE DA ESQUINA',
    expect: { amount: 750, kind: 'despesa', merchant: 'CAFE DA ESQUINA' } },
  { name: 'Salário', text: 'Salário de R$ 5.300,00 creditado na sua conta',
    expect: { amount: 530000, kind: 'receita' } },
];

for (const c of cases) {
  test(c.name, () => {
    const r = parseNotification({ title: c.title, text: c.text, packageName: c.pkg });
    if (c.expect.discard) {
      assert.equal(r.isTransaction, false, `deveria descartar: ${JSON.stringify(r)}`);
      return;
    }
    assert.equal(r.isTransaction, true, JSON.stringify(r));
    if (c.expect.amount !== undefined) assert.equal(r.amountCents, c.expect.amount);
    if (c.expect.kind !== undefined) assert.equal(r.kind, c.expect.kind);
    if (c.expect.merchant !== undefined) assert.equal(r.merchant, c.expect.merchant);
    if (c.expect.bank !== undefined) assert.equal(r.bank, c.expect.bank);
  });
}

test('toCents', () => {
  assert.equal(toCents('1.234,56'), 123456);
  assert.equal(toCents('45,9'), 4590);
  assert.equal(toCents('12.50'), 1250);
  assert.equal(toCents('2.000'), 200000);
  assert.equal(toCents('7'), 700);
});

test('canal cartão x conta', () => {
  const c = (text: string) => parseNotification({ text, packageName: 'com.nu.production' }).channel;
  assert.equal(c('Compra de R$ 45,90 APROVADA em PADARIA para o cartão com final 1234.'), 'cartao');
  assert.equal(c('Compra no crédito de R$ 10,00 em LOJA'), 'cartao');
  assert.equal(c('Compra no débito de R$ 10,00 em LOJA com o cartão final 1234'), 'conta');
  assert.equal(c('Você recebeu um Pix de R$ 80,00 de João.'), 'conta');
  assert.equal(c('Salário de R$ 5.300,00 creditado na sua conta'), 'conta');
});
