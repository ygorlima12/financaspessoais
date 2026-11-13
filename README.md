# Meu Rumo · Finanças

Sistema pessoal de finanças focado em **crescimento financeiro**: lançamentos, orçamento, investimentos,
reserva de emergência e metas — com **captura automática das notificações do banco** no Android.

- **Início:** patrimônio total e evolução em 12 meses, entradas x saídas, taxa de poupança, gastos por categoria, orçamento, reserva e metas.
- **Lançamentos:** entradas, saídas e transferências por mês, com busca e filtros.
- **Caixa de entrada:** notificações do banco capturadas no celular, já com valor, tipo e estabelecimento; confirme com um toque.
  O sistema aprende a categoria de cada estabelecimento e a conta de cada app.
- **Crescer:** investimentos (aportes, resgates, atualização de valor e rendimento), reserva de emergência
  (meta em meses de custo de vida) e metas com prazo e quanto guardar por mês.
- **Ajustes:** contas e cartões, categorias com limite mensal, tokens do celular, exportação CSV.
- Funciona como app no celular (PWA: "Adicionar à tela inicial"), com tema claro/escuro automático.

## Stack

| Parte | Tecnologia |
|---|---|
| Backend | Node 22 + Fastify + PostgreSQL (`postgres.js`), TypeScript |
| Frontend | React + Vite + Recharts, TypeScript |
| Deploy | Docker Compose (app + Postgres + backup diário), Caddy opcional para HTTPS |
| Captura | MacroDroid (Android) → webhook `POST /api/capture` |

Valores são guardados em **centavos** (inteiros), nunca em ponto flutuante.

## Subir na VPS

Pré-requisito: Docker e Docker Compose instalados, e um subdomínio apontando para o IP da VPS
(ex.: `financas.meurumodiario.com.br`, registro **A**).

```bash
git clone https://github.com/ygorlima12/meurumo-financas.git
cd meurumo-financas
cp .env.example .env
# edite o .env: DOMAIN, POSTGRES_PASSWORD (openssl rand -hex 24), JWT_SECRET (openssl rand -hex 32)
nano .env
```

Escolha **um** dos jeitos de expor com HTTPS:

**A) A VPS ainda não tem proxy nas portas 80/443** — use o Caddy incluso (certificado automático):

```bash
docker compose --profile caddy up -d --build
```

**B) A VPS já tem Nginx/Traefik/Caddy/Easypanel** (por exemplo, servindo outro sistema) — suba só o app:

```bash
docker compose up -d --build
```

e aponte seu proxy para `http://127.0.0.1:3010` (porta definida em `APP_PORT`). Exemplo Nginx:

```nginx
server {
    server_name financas.seudominio.com.br;
    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

(depois `certbot --nginx -d financas.seudominio.com.br`).

Abra o domínio no navegador: a **primeira conta criada** é a sua. Depois disso o cadastro fica fechado
(`ALLOW_SIGNUP=false`). Para liberar outra pessoa, mude para `true`, `docker compose up -d`, crie a conta e volte para `false`.

As migrações do banco rodam sozinhas ao iniciar.

### Atualizar

```bash
git pull && docker compose up -d --build     # (+ --profile caddy se usar o Caddy)
```

### Backup

O serviço `backup` grava `backups/financas-AAAA-MM-DD.sql.gz` todo dia e mantém 30 dias.
Copie essa pasta para fora da VPS de vez em quando. Para restaurar:

```bash
gunzip -c backups/financas-2026-11-13.sql.gz | docker compose exec -T db psql -U financas financas
```

## Conectar o celular

Passo a passo em **[docs/android-macrodroid.md](docs/android-macrodroid.md)**. Resumo: gere um token em
*Ajustes › Celular*, crie no MacroDroid o gatilho *Notificação recebida* (apps dos bancos) com a ação
*Requisição HTTP POST* para `https://SEU_DOMINIO/api/capture`, cabeçalho `Authorization: Bearer SEU_TOKEN`.

## Como os números são calculados

- **Saldo da conta** = saldo inicial + entradas + resgates − saídas − aportes ± transferências.
- **Cartão de crédito** é uma conta que fica negativa conforme você gasta. Pagar a fatura = **transferência** da conta
  corrente para o cartão (assim a compra não conta duas vezes).
- **Patrimônio** = soma de todas as contas + valor atual dos investimentos.
- **Investimento:** valor = aportes − resgates + rendimentos. "Atualizar valor" grava a diferença como rendimento.
  Aporte com conta de origem tira o dinheiro da conta (não conta como gasto).
- **Reserva de emergência:** soma das contas/investimentos marcados como reserva ÷ (custo mensal × meses).
  O custo mensal é o que você informar ou a média das despesas dos últimos 3 meses.
- **Metas:** valor guardado + saldo dos investimentos vinculados; com prazo, mostra quanto guardar por mês.
- **Taxa de poupança** = (entradas − saídas) ÷ entradas do mês.

## Desenvolvimento local

```bash
# Postgres local (ou: docker run -d -p 5432:5432 -e POSTGRES_USER=financas -e POSTGRES_PASSWORD=financas postgres:16-alpine)
npm run install:all
npm run dev:server     # API em http://localhost:3000 (usa postgres://financas:financas@localhost:5432/financas)
npm run dev:web        # app em http://localhost:5173 (proxy de /api para a 3000)
npm test               # testes do leitor de notificações
```

Estrutura:

```
server/
  migrations/        SQL do banco (aplicado automaticamente)
  src/parser/        leitor de notificações bancárias (+ testes) e fallback com IA
  src/routes/        API (auth, contas, categorias, lançamentos, captura, investimentos, metas/reserva/painel)
  src/lib/finance.ts cálculos de saldo, patrimônio, reserva e metas
web/src/
  pages/             Início, Lançamentos, Caixa de entrada, Crescer, Ajustes
  components/        formulário de lançamento e componentes de interface
docs/                guia do MacroDroid
```

## Próximos passos possíveis

- Open Finance (Pluggy/Belvo) para conciliar com o extrato oficial.
- App Android próprio (NotificationListenerService) no lugar do MacroDroid.
- Lançamentos recorrentes e previsão de fluxo de caixa.
