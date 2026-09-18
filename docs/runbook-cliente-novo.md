# Runbook — entrada de cliente novo

Procedimento operacional da Effect para colocar uma clínica no ar: provisionar a
conta, conectar o WhatsApp, configurar a Conversions API da Meta, subir a
campanha e validar que o lead qualificado volta para o anúncio.

Público: quem opera o `/admin` (equipe Effect) e o gestor de tráfego da conta do
cliente. A parte de código é a seção 2; quem só vai configurar pode ir direto
para a seção 4.

> **Estado em 18/09/2026 — leia antes de prometer qualquer coisa ao cliente.**
> O CRM **captura** o clique do anúncio e **registra** a conversão quando o
> atendente marca o lead, mas **não envia nada para a Meta ainda**: o remetente
> não existe no código (não há `src/lib/meta/`), e a pergunta que decide o
> desenho — se a Meta aceita um evento de business messaging com `ctwa_clid`
> sozinho, sem WABA por trás — ainda não foi respondida pelo experimento D0.
> Configurar a conta agora não é trabalho perdido: é o que faz o clique ser
> guardado e a conversão ficar registrada esperando. Mas "está reportando para a
> Meta" só pode ser dito depois da seção 2.1 e 2.2.

---

## 1. Ordem de execução

1. Provisionar a conta no `/admin` (seção 3).
2. Cliente conecta o WhatsApp por QR code (seção 3.3).
3. Gestor prepara o dataset e o token na Meta (seção 4).
4. Preencher a configuração de anúncios no `/admin` (seção 5).
5. Subir a campanha CTWA com a meta de desempenho certa (seção 4, passo 7).
6. Validar com código de teste e limpar o código (seção 6).
7. Rotina: o atendente marca a conversão no cartão do lead (seção 7).

---

## 2. Estado do código

### 2.1 O que existe e o que falta

| Parte | Estado | Onde |
| --- | --- | --- |
| Captura do `ctwa_clid` no webhook | pronta | `parseCtwa()` em `src/app/api/whatsapp/webhook/[secret]/route.ts:985` |
| Colunas de atribuição no contato | prontas | `contacts.ctwa_clid`, `ad_source_id`, `ctwa_clid_at` (`supabase/migrations/048_meta_capi.sql`) |
| Registro da conversão (outbox) | pronto | tabela `meta_capi_events` + gatilho em `deals` |
| Gatilho pela marca do cartão, não pelo status | **escrito, migration não aplicada** | `supabase/migrations/049_meta_capi_manual_mark.sql` |
| Marca de conversão no cartão do lead | pronta | `src/components/pipelines/deal-card.tsx` |
| Configuração Meta por conta | pronta | `PATCH /api/admin/accounts/[id]/meta` |
| Contadores no `/admin` | parciais — só `pending` e `unconfigured` | `src/app/admin/page.tsx:26` |
| **Envio para a Meta** | **não existe** | não há `src/lib/meta/`, nem passe de cron |
| Janela de 7 dias, retry, estado `expired` | não existe | task 8.1 de `openspec/changes/meta-capi-qualified-lead/tasks.md` |
| Validar dataset/token no onboarding | não existe | — |

### 2.2 O que precisa mudar, em ordem

**P0 — aplicar a migration 049.** Está escrita e não foi aplicada. Enquanto não
for, o gatilho ainda escuta `deals.status` e uma qualificação comum volta a
enfileirar conversão sozinha. Aplicar à mão no SQL editor do Supabase, como todas
as outras, e rodar as verificações das tasks 1.1–1.9 de
`openspec/changes/meta-capi-manual-qualification/tasks.md`.

**P0 — rodar o experimento D0** (tasks 4.1–4.5 de
`openspec/changes/meta-capi-qualified-lead/tasks.md`). É um evento de teste
postado à mão com um `ctwa_clid` real e fresco, `action_source:
business_messaging`, `messaging_channel: whatsapp`, sem WABA. Dois pontos que
decidem o resultado:

- `{"events_received": 1}` **não é aprovação.** A Meta devolve isso para evento
  aceito no envelope e descartado depois. O critério é o evento aparecer em
  Gerenciador de Eventos → Eventos de Teste em cerca de um minuto.
- Rodar os dois controles: repostar com um `ctwa_clid` lixo e repostar sem
  `messaging_channel`. Se o clique lixo também for "aceito" e o evento malformado
  não der erro, o dataset é um buraco negro e o sucesso aparente não vale.

Por que isso é um experimento e não uma leitura da documentação: a documentação
oficial da Meta para business messaging exige
`user_data.whatsapp_business_account_id` e cria o dataset a partir do WABA
(`POST /<WABA_ID>/dataset`, token de app com `whatsapp_business_management` e
`whatsapp_business_manage_events`). As clínicas rodam em UAZAPI e não têm WABA —
o caminho documentado não tem entrada. O caminho adotado (dataset no Gerenciador
de Eventos da própria Effect, token gerado ali, `ctwa_clid` sozinho) não é
documentado nem como suportado nem como proibido.

**P1 — o remetente.** Depois do D0 verde: `src/lib/meta/capi.ts` (montagem do
payload e chamada), um worker de outbox e uma rota de cron no mesmo padrão de
`src/app/api/followups/cron/route.ts` — segredo `x-cron-secret` conferido com
`timingSafeEqual`, agendado por `pg_cron` como em
`supabase/migrations/047_followup_queue.sql:209`. Regras que a spec já fixou:
checar os 7 dias antes da chamada, `event_id = deal.id` estável entre tentativas,
usar `meta_test_event_code` quando preenchido, e **nunca** reclamar linhas
`unconfigured` nem `canceled`.

**P1 — botão "validar dataset e token" no `/admin`.** Uma chamada
`GET /v23.0/<DATASET_ID>?fields=id,name,owner_business` com o token da conta
responde na hora se a configuração presta: `error.code 190` = token inválido,
`100` / `#803` = token e dataset em Business Managers diferentes. Hoje um erro de
digitação no dataset só aparece quando o primeiro lead qualificar — ou nunca.

**P2 — contadores completos** (`sent`, `failed`, `expired`, `canceled`) em
`src/app/admin/page.tsx`. Hoje a consulta filtra apenas `pending` e
`unconfigured`, então uma falha de entrega ficaria invisível no console.

**P2 — campos no formulário de provisionamento.** O provisionamento aceita só
`metaDatasetId` e `metaAccessToken` (`src/lib/provisioning/provision.ts:152`);
Página, nome do evento e código de teste só existem no painel de edição. Funciona,
mas obriga dois passos no dia da entrada.

**P2 — texto do checklist no `/admin`.** O item 5 de
`AdminConsole.metaConfig.setupChecklist` (em `messages/pt-BR.json` e
`messages/en.json`) ainda diz "qualifique um lead real". Depois da 049 o que
dispara a conversão é **marcar** no cartão, não qualificar.

**Fora de escopo enquanto o caminho for o dataset da Effect:** coluna
`meta_waba_id`, app Meta próprio, System User, Business Verification, App Review
e fluxo "conectar Meta" dentro do produto.

---

## 3. Provisionar a conta

### 3.1 Pré-requisitos do ambiente

O e-mail de quem vai operar precisa estar em `PLATFORM_ADMINS` (variável
server-side, sem `NEXT_PUBLIC_`). Sem isso o `/admin` não abre — a lista vazia
significa ninguém, não todo mundo. As demais variáveis obrigatórias estão em
`.env.local.example` (Supabase, `ENCRYPTION_KEY`, `UAZAPI_BASE_URL`,
`UAZAPI_ADMIN_TOKEN`).

### 3.2 Formulário `/admin`

Um envio cria login, conta, funil por especialidade, instância no gateway,
assistente de IA e as credenciais de anúncios. Campos:

| Campo | Observação |
| --- | --- |
| Nome da clínica | vira o nome da conta e do funil |
| Nome completo do cliente | dono da conta |
| E-mail do cliente | vira o login; e-mail já confirmado |
| Senha do cliente | definida pela Effect e entregue pelo seu canal |
| Especialidade | Dentista / Médico / Psicólogo — escolhe o modelo de etapas |
| Persona do assistente | texto da persona da IA |
| ID do dataset da Meta | opcional aqui, pode entrar depois (seção 5) |
| Token de acesso da Meta | opcional aqui, pode entrar depois (seção 5) |

As credenciais aparecem **uma vez** na tela de sucesso. Entregue ao cliente pelo
seu próprio canal.

Se o provisionamento falhar no meio, a tela informa a etapa (`failedStep`) e, se
a limpeza também falhar, o que sobrou para remover à mão (`cleanupIncomplete`).

### 3.3 Cliente conecta o WhatsApp

O cliente entra com as credenciais e conecta o número por QR code
(`src/components/connection/connection-manager.tsx`). O webhook do gateway é
registrado automaticamente no provisionamento — não há nada para colar na UAZAPI
à mão.

Só depois dessa conexão os anúncios podem apontar para o número: mensagem que
chega antes de conectar não entra no CRM, e o `ctwa_clid` dela se perde.

---

## 4. Tutorial do gestor de tráfego

### Passo 1 — o que você precisa ter em mãos

- Acesso de administrador à **conta de anúncio** do cliente e à **Página** que
  roda os anúncios.
- Acesso ao **Gerenciador de Eventos do Business Manager da Effect**.
- O número de WhatsApp do cliente já conectado no CRM (seção 3.3).

Não é preciso pedir ao cliente: WhatsApp Business API oficial, WABA, acesso ao
Business Manager dele, app da Meta ou verificação de negócio. Nada disso é usado
neste desenho.

### Passo 2 — criar o dataset

Gerenciador de Eventos da Effect → criar um conjunto de dados para esta clínica.
Se a clínica já tiver um Pixel, dá para reaproveitar — anote de qual Business
Manager ele é, porque token e dataset precisam estar sob o mesmo BM.

Copie o **ID do conjunto de dados** (é o `meta_dataset_id`).

### Passo 3 — compartilhar com a conta de anúncio do cliente

No próprio dataset, compartilhe com a conta de anúncio do cliente. Sem esse
compartilhamento o evento até chega, mas não otimiza campanha nenhuma: o
conjunto de anúncios não enxerga o dataset.

### Passo 4 — gerar o token

No dataset → **Configurações → Conversions API → Gerar token de acesso**.

Copie na hora. A Meta não guarda o token e não mostra de novo. Ele fica preso à
pessoa que gerou: se o acesso dessa pessoa mudar, o token morre junto (ver
seção 8).

### Passo 5 — ID da Página

É o ID da Página que veicula os anúncios CTWA. Aparece na URL do criativo que o
próprio webhook recebe, em `externalAdReply.mediaURL` — por exemplo, em
`https://www.facebook.com/61587334015088/videos/1332056855401835/` o ID é
`61587334015088`.

Serve só para diagnóstico ("de qual Página saem os anúncios desta conta"). Nunca
é enviado para a Meta: identidade por Página é o caminho do Messenger, e aqui o
evento é de WhatsApp.

### Passo 6 — preencher o `/admin`

`/admin` → seção **Configuração de anúncios** → conta da clínica → **Editar**.
Campos na seção 5.

### Passo 7 — a campanha

- Anúncio **Click-to-WhatsApp**, com destino WhatsApp, apontando para o número
  conectado no CRM.
- A **meta de desempenho do conjunto de anúncios tem que ser o mesmo evento**
  configurado em "Nome do evento" (padrão `Lead`), com local de conversão
  WhatsApp.

Essa é a armadilha mais cara do processo: se o conjunto otimiza para um evento e
o CRM reporta outro, não aparece erro nenhum de nenhum dos dois lados — e a
campanha simplesmente não aprende. Nada no código consegue verificar isso.

---

## 5. Dados exigidos no `/admin` (referência)

| Campo na tela | Coluna | De onde vem | Obrigatório | Comportamento |
| --- | --- | --- | --- | --- |
| ID do dataset | `meta_dataset_id` | Gerenciador de Eventos da Effect (passo 2) | sim, para reportar | vazio = as conversões viram `unconfigured` e ficam contadas como não reportadas |
| Token de acesso | `meta_access_token` | dataset → Conversions API (passo 4) | sim | guardado cifrado; **deixar em branco mantém** o token atual, não apaga |
| ID da Página | `meta_page_id` | Página do anúncio (passo 5) | não | diagnóstico; nunca enviado |
| Nome do evento | `meta_event_name` | combinado com a campanha | tem padrão `Lead` | só letras, números e `_`; precisa bater com a meta do conjunto de anúncios |
| Código de teste do evento | `meta_test_event_code` | Gerenciador de Eventos → Eventos de Teste | só durante a validação | **limpar depois** — ver seção 6 |
| Enviar telefone com hash | `meta_send_ph` | decisão jurídica, não técnica | não, padrão desligado | só ligar quando existir consentimento ou política de privacidade cobrindo o compartilhamento do telefone do paciente com plataforma de anúncios (LGPD art. 6 e, para clínica, art. 11) |

O cliente não vê nenhum desses campos: as colunas são invisíveis para a sessão da
clínica por decisão da migration 046.

Estado que o painel mostra por conta: **Reportando** / **Não reportando**,
**Configuração parcial** (dataset ou token faltando), **Modo de teste** (código
de teste preenchido), quantas conversões estão pendentes e quantas ficaram sem
configuração.

---

## 6. Validação

1. Preencha o **código de teste do evento** no `/admin`, tirado de Gerenciador de
   Eventos → Eventos de Teste.
2. Pegue um lead real que veio de anúncio (o contato precisa ter `ctwa_clid` —
   na prática: o cartão dele mostra o botão de marcar conversão; lead orgânico
   não mostra).
3. Marque a conversão no cartão.
4. Confira o evento em **Eventos de Teste**. Enquanto o remetente da seção 2.2
   não existir, esta etapa não vai acontecer — o que dá para conferir hoje é a
   linha registrada e o contador de pendentes no `/admin`.
5. **Limpe o código de teste.** Conta esquecida em modo de teste parece
   perfeitamente configurada e não reporta nada para otimização.

---

## 7. Rotina do dia a dia

Quem atende marca a conversão **no cartão do lead**, no botão do megafone. Essa
marca é a decisão de reportar aquele lead para a Meta.

- **Mover o cartão de coluna não reporta nada.** Qualificar ou perder o negócio
  também não: status é resultado comercial, a marca é decisão de anúncio.
- Desmarcar cancela a conversão que ainda não foi entregue. O que já foi enviado
  fica como está — a Meta não desaprende.
- Marcar de novo revive a mesma conversão, com o clique e o horário do momento.
- Lead que não veio de anúncio não tem o botão: não existe clique para creditar.

---

## 8. Armadilhas conhecidas

- **Sete dias.** A Meta descarta evento cujo clique tem mais de 7 dias. Para
  clínica com ciclo "lead hoje, consulta semana que vem", isso é rotina, não
  exceção. Marcar o lead semanas depois não adianta.
- **Evento divergente da campanha.** Zero erro aqui, zero otimização lá (passo 7).
- **Código de teste esquecido.** Ver seção 6.
- **Token preso à pessoa.** Gerado no Gerenciador de Eventos, morre com o acesso
  de quem gerou. A falha aparece como rejeição permanente no registro da
  conversão, nunca de forma proativa.
- **Telefone com hash.** Continua sendo dado pessoal; para clínica, "esta pessoa
  falou com este consultório" é inferência sobre saúde. O padrão é desligado, e é
  para continuar desligado sem base escrita.
- **Reentrega da UAZAPI.** O gateway reentrega mensagens; a captura ignora clique
  repetido igual ao já guardado, para não empurrar a janela de 7 dias para frente
  artificialmente.
- **Apagar o negócio apaga o registro da conversão** (`ON DELETE CASCADE`). Bom
  para privacidade, ruim para auditoria.

---

## 9. Checklist de conta nova

- [ ] E-mail do operador em `PLATFORM_ADMINS`.
- [ ] Conta provisionada no `/admin`; credenciais entregues ao cliente.
- [ ] Cliente conectou o WhatsApp por QR e o painel mostra conectado.
- [ ] Dataset criado no Gerenciador de Eventos da Effect.
- [ ] Dataset compartilhado com a conta de anúncio do cliente.
- [ ] Token gerado no dataset e colado no `/admin`.
- [ ] ID da Página e nome do evento preenchidos.
- [ ] Campanha CTWA no ar, destino WhatsApp, meta de desempenho = nome do evento.
- [ ] Primeiro lead de anúncio chegou e o cartão dele mostra o botão de marcar.
- [ ] Marca feita em um lead; `/admin` mostra a conversão contabilizada.
- [ ] Código de teste limpo.
- [ ] **Pendente de produto:** migration 049 aplicada, experimento D0 rodado e
      remetente implementado (seção 2.2). Até lá a conta está preparada, não
      reportando.

---

## 10. Onde está cada coisa

- Plano geral das mudanças: [`plano-changes-openspec.md`](./plano-changes-openspec.md)
- Captura e registro da conversão: `openspec/changes/meta-capi-qualified-lead/`
- Marca no cartão: `openspec/changes/meta-capi-manual-qualification/`
- Vocabulário do produto (Qualificação × Marca de conversão): `CONTEXT.md`
