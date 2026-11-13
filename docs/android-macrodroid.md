# Capturar notificações do banco no Android (MacroDroid)

O Android permite que um app autorizado leia as notificações. Vamos usar o **MacroDroid** (gratuito, Play Store) para
mandar cada notificação dos apps de banco para o webhook do Meu Rumo. O servidor lê o texto, extrai valor, tipo
(entrada/saída) e estabelecimento, e põe na **Caixa de entrada** para você confirmar com um toque.

> Os nomes dos menus podem mudar um pouco conforme a versão do MacroDroid. A lógica é sempre:
> **gatilho "Notificação recebida" → ação "Requisição HTTP (POST)"**.

## 1. Gere o token do celular

No sistema: **Ajustes › Celular › Gerar token**. Copie o token (`mrf_...`) — ele aparece só uma vez.
Anote também o **endereço do webhook** mostrado na mesma tela, algo como:

```
https://financas.seudominio.com.br/api/capture
```

## 2. Prepare o celular

1. Instale o **MacroDroid**.
2. Dê ao MacroDroid **acesso às notificações** (ele pede na primeira vez que você cria o gatilho; se não pedir:
   Configurações do Android › Apps › Acesso especial › Acesso a notificações › MacroDroid).
3. **Desative a otimização de bateria** para o MacroDroid (Configurações › Apps › MacroDroid › Bateria › Sem restrições).
   Sem isso, o Android pode "matar" o app e você perde notificações.
4. Nos apps dos bancos, confira se as **notificações de compra/Pix estão ligadas**.

## 3. Crie a macro

**Gatilho**
- *Notificação* › **Notificação recebida**
- Selecione os apps: Nubank, Inter, Itaú, C6, Mercado Pago, PicPay… (só os de banco)
- Conteúdo do texto: **qualquer**

**Ação**
- *Aplicativos/Web* › **Requisição HTTP** (HTTP Request)
- Método: **POST**
- URL: o endereço do webhook
- Cabeçalho (Headers): `Authorization` = `Bearer mrf_SEU_TOKEN`
- Corpo (Body), tipo **application/json**, conteúdo:

```json
{"package":"[notification_app_package]","app":"[app_name]","title":"[notification_title]","text":"[notification]"}
```

Os itens entre colchetes são *Magic Text* do MacroDroid. **Não digite à mão:** toque no botão de Magic Text (`...`)
e escolha *Texto da notificação*, *Título da notificação*, *Nome do app* e *Pacote do app* — assim o MacroDroid
coloca o código certo da sua versão. Se algum não existir, pode tirar; o único obrigatório é o **texto**.

> Aspas dentro do texto da notificação às vezes quebram o JSON. O servidor foi feito para recuperar esses casos,
> então não precisa se preocupar.

**Alternativa sem JSON** (se preferir): em vez de corpo JSON, use os campos de formulário/parâmetros
`package`, `app`, `title`, `text`, e o token em `token` (ex.: `.../api/capture?token=mrf_...`).

Salve a macro e deixe-a **ativada**.

## 4. Teste

1. Faça um Pix pequeno ou uma compra.
2. Abra o sistema › **Caixa** — a notificação deve aparecer com o valor já preenchido.
3. Toque em **Revisar e lançar**, escolha a conta (ex.: "Cartão Nubank") e a categoria.
   Deixe ligado *"Usar esta conta para as próximas notificações"* — da próxima vez aparece o botão **✓ Lançar** direto.

Para testar sem gastar nada, use **Ajustes › Celular › Testar leitura de notificação**, ou pelo terminal:

```bash
curl -X POST https://financas.seudominio.com.br/api/capture \
  -H "Authorization: Bearer mrf_SEU_TOKEN" -H "Content-Type: application/json" \
  -d '{"package":"com.nu.production","app":"Nubank","text":"Compra de R$ 12,90 APROVADA em PADARIA X para o cartão com final 1234."}'
```

## Como o sistema decide

| Notificação | O que acontece |
|---|---|
| Compra aprovada, Pix enviado, pagamento, saque | **Saída** na Caixa de entrada |
| Pix/transferência recebida, depósito, salário, estorno, reembolso | **Entrada** na Caixa de entrada |
| Compra **recusada/negada**, saldo insuficiente | Descartada (não houve gasto) |
| Código de verificação, agendamento, propaganda, aviso de fatura, "seu dinheiro rendeu" | Descartada |
| Mesma notificação repetida pelo Android | Ignorada (duplicata) |
| Mesmo valor chegando por dois apps em até 5 min | Marcada como **possível duplicada** |
| Pagamento de fatura | Vai com aviso: lance como **transferência** da conta para o cartão |

Tudo que foi descartado fica em **Caixa › Descartadas** por 30 dias — se algo deveria ter entrado, toque em *Recuperar*.

**Cartão x conta:** o sistema separa notificações de cartão de crédito das de conta (Pix/débito) do mesmo app,
então "Nubank · cartão" pode ir para a conta *Cartão Nubank* e "Nubank · conta" para a conta *Nubank*.

**Lançamento automático:** em **Ajustes › Celular**, ligue *Automático* num app (ou a opção geral) para que notificações
entendidas com segurança sejam lançadas sem passar pela Caixa de entrada. Recomendo usar alguns dias no modo manual antes.

**IA (opcional):** se você colocar `ANTHROPIC_API_KEY` no `.env`, notificações em formatos que as regras não entendem
são interpretadas por IA. Sem a chave, tudo funciona só com as regras.

## Problemas comuns

- **Nada chega:** veja em *Ajustes › Celular* se o aparelho mostra "último envio". Se nunca enviou, confira URL e token
  no MacroDroid (a resposta 401 significa token errado). Confira se a otimização de bateria está desligada.
- **Chega mas vai para Descartadas:** veja o motivo na própria notificação. Se for um formato novo do seu banco,
  copie o texto e me mande — dá para ajustar a regra em `server/src/parser/parse.ts` (e adicionar um teste em
  `parse.test.ts`).
