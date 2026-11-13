// Pacotes Android conhecidos -> nome do banco.
// A comparação é por prefixo, então "com.itau" cobre "com.itau.empresas" etc.
const BANKS: Array<[string, string]> = [
  ['com.nu.production', 'Nubank'],
  ['br.com.intermedium', 'Inter'],
  ['com.itau', 'Itaú'],
  ['br.com.itau', 'Itaú'],
  ['br.com.bradesco', 'Bradesco'],
  ['com.bradesco', 'Bradesco'],
  ['br.com.bb.android', 'Banco do Brasil'],
  ['br.com.gabba.caixa', 'Caixa'],
  ['br.gov.caixa', 'Caixa'],
  ['com.santander', 'Santander'],
  ['br.com.santander', 'Santander'],
  ['com.c6bank', 'C6 Bank'],
  ['com.picpay', 'PicPay'],
  ['com.mercadopago', 'Mercado Pago'],
  ['br.com.original', 'Original'],
  ['br.com.neon', 'Neon'],
  ['com.neon', 'Neon'],
  ['br.com.uol.ps', 'PagBank'],
  ['com.btgpactual', 'BTG Pactual'],
  ['br.com.xp', 'XP'],
  ['com.sicredi', 'Sicredi'],
  ['br.com.sicredi', 'Sicredi'],
  ['br.com.sicoobnet', 'Sicoob'],
  ['com.sicoob', 'Sicoob'],
  ['br.com.banrisul', 'Banrisul'],
  ['com.willbank', 'Will Bank'],
  ['br.com.will', 'Will Bank'],
  ['com.google.android.apps.walletnfcrel', 'Google Wallet'],
  ['com.samsung.android.spay', 'Samsung Wallet'],
];

export function bankFromPackage(pkg?: string | null, appName?: string | null): string | null {
  if (pkg) {
    const p = pkg.toLowerCase();
    for (const [prefix, name] of BANKS) if (p.startsWith(prefix.toLowerCase())) return name;
  }
  return appName?.trim() || null;
}
