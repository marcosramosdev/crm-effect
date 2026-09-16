# Plano de changes OpenSpec — adaptação do CRM para a realidade do cliente Effect

Documento de planejamento. Consolida as decisões tomadas na sessão de
levantamento e as organiza em 5 changes OpenSpec independentes, com escopo
delimitado, ordem de execução e dependências explícitas.

Nada aqui foi implementado ainda. Cada seção vira uma pasta em
`openspec/changes/<id>/` com `proposal.md`, `design.md`, `specs/` e `tasks.md`.

---

## Contexto do produto

O CRM é vendido **acoplado a outros serviços da Effect Digital**, nunca como
produto avulso self-service. Quem cria a conta do cliente é a Effect; o cliente
recebe credenciais já prontas e é responsável apenas por conectar o WhatsApp e
decidir se liga o atendimento automático por IA.

O cliente-alvo é clínica/consultório (neurologia, odontologia, psicologia). A
métrica central do negócio é **lead qualificado**, não venda fechada: as
campanhas da Meta são otimizadas para volume de leads qualificados, e é esse
evento que precisa voltar para a Conversions API.

---

## Decisões fechadas

| Tema | Decisão |
|---|---|
| Criação de contas | Signup público fechado. Formulário interno em `/admin`, acesso por lista de e-mails em `PLATFORM_ADMINS`. |
| Senha do cliente | Definida pela Effect no provisionamento. Troca não é forçada; banner sugere trocar. |
| Funil padrão | Modelos por especialidade (dentista, médico, psicólogo) escolhidos no provisionamento. Todos contêm a etapa **"Em contato"** como primeira e travada. |
| Etapa fixa | `pipeline_stages.is_system` — não pode ser renomeada, apagada nem tirada da primeira posição. |
| Agendamento | Coluna `deals.scheduled_at TIMESTAMPTZ` (um agendamento "atual" por lead). `expected_close_date` é removida. |
| Fuso | Coluna `accounts.timezone` com default `America/Sao_Paulo`, fora do formulário. |
| Status do deal | `won` renomeado para `qualified` em todo o stack (enum, tipos, componentes, i18n). `lost` mantido. |
| Tracking CTWA | Colunas `ctwa_clid`, `ad_source_id`, `ctwa_clid_at` em `contacts` (último clique vence). |
| Evento Meta | `Lead` disparado apenas quando o deal vira `qualified`. `action_source: business_messaging`, `event_id = deal.id`. |
| Credenciais Meta | Preenchidas pela Effect no provisionamento, cifradas, invisíveis para o cliente. |
| Falhas CAPI | Tabela `meta_capi_events` com status e erro, retry no cron, contador em `/admin`. Tela dedicada fica para depois. |
| Chave e modelo de IA | Definidos pela Effect via env (`AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`). `ai_configs.api_key` vira nullable e some da UI do cliente. |
| Feature flag | IA sai do conjunto escondido. `NEXT_PUBLIC_INCOMPLETE_FEATURES_ENABLED` continua valendo só para Broadcasts, Automations e Flows. |
| Auto-reply | Desligado por default. É isso que o cliente "ativa" no onboarding. |
| Rascunho de IA | Sempre disponível, independente do auto-reply. |
| Lembrete de agendamento | Template com variáveis, sem IA. Até 3 offsets configuráveis (default 5 dias / 1 dia / 2 horas). |
| Aprovação de envio | Nenhum lembrete sai sozinho. Vira pendência com **Aprovar / Recusar / Editar e enviar**. |
| Expiração | Pendência não aprovada até a hora do agendamento expira sozinha. |
| Botões do lembrete | Confirmar / Remarcar. "Confirmar" grava `appointment_confirmed_at` e **sinaliza** as pendências restantes sem cancelá-las. |
| Reativação | Nunca automática. Botão por lead gera rascunho de IA a partir do histórico da conversa. |
| Disparo em lote | Não existe — risco de bloqueio no WhatsApp e mensagem despersonalizada. |
| Estilo de comunicação | Amigável / Direto / Consultivo / Lembrete de vaga. Default por conta, trocável no momento do envio. |
| Calendário | Mês e semana, somente leitura. Clicar no agendamento abre a conversa do lead. |
| Lista de reativação | Aba dentro de `/pipelines`, com filtros de dias sem contato, etapa e agendamento futuro. |
| Agendador | `pg_cron` + `pg_net` chamando `/api/followups/cron` com `x-cron-secret`. |
| Instância UAZAPI | Provisionada automaticamente no formulário via `UAZAPI_ADMIN_TOKEN` (já presente em `.env.local`). Cliente só escaneia o QR. |

### Decisões adiadas conscientemente

- Controle de comparecimento/no-show (exigiria tabela `deal_appointments` no lugar da coluna única).
- Relatório de qual criativo gera mais lead qualificado (exigiria tabela `contact_ad_clicks` com histórico).
- Limite de consumo de IA por conta (a medição já existe em `src/lib/ai/usage.ts`).
- Tela dedicada de erros da Conversions API para operadores.
- Remarcar agendamento arrastando no calendário.
- Remoção de `deals.value` / `deals.currency`.

---

## Ordem de execução

```
1. lead-scheduling-and-calendar   (base: campo, calendário, rename)
        |
2. centralized-ai-setup           (chave/modelo por env, UI simplificada)
        |
3. client-provisioning            (consome 1 e 2: cria funil e ai_configs)
        |
4. followup-approval-queue        (consome 1 e 2: agendamento + rascunho IA)
        |
5. meta-capi-qualified-lead       (consome 1, 3 e 4: rename, credenciais, cron)
```

A change 2 vem antes da 3 porque o provisionamento cria a linha de `ai_configs`
e não faz sentido escrevê-la no formato antigo (com `api_key` obrigatório) para
migrar logo em seguida.

---

## Change 1 — `lead-scheduling-and-calendar`

### Why

O deal só guarda `expected_close_date DATE`. Clínica trabalha com hora marcada,
e todo o resto do plano (lembrete, calendário, fila de follow-up) depende de um
campo com data e hora. O status `won` também não descreve o que o negócio mede.

### What changes

- Adiciona `deals.scheduled_at TIMESTAMPTZ` e `deals.appointment_confirmed_at TIMESTAMPTZ`.
- Remove `deals.expected_close_date` e todos os seus usos.
- Adiciona `accounts.timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo'`.
- Renomeia o status `won` para `qualified`: CHECK constraint, `DealStatus`,
  componentes de pipeline/contato e as 3 chaves i18n.
- Nova rota `/calendar` com visão mensal e semanal dos leads agendados,
  somente leitura, mostrando nome do lead e horário. Clicar abre a conversa.

### Spec deltas

- `openspec/specs/deals/spec.md` — novos requisitos de agendamento e renomeação do status.
- Nova capability `calendar`.

### Arquivos principais

- `supabase/migrations/044_lead_scheduling.sql`
- `src/types/index.ts` (`DealStatus`)
- `src/components/pipelines/deal-form.tsx`, `deal-card.tsx`, `pipeline-board.tsx`, `pipeline-analytics.tsx`
- `src/components/contacts/contact-detail-view.tsx`
- `src/lib/inbox/deals.ts`
- `messages/{en,pt-BR,ko}.json`
- `src/app/(dashboard)/calendar/page.tsx` + `src/components/calendar/*`

### Fora de escopo

Arrastar para remarcar, criar agendamento pelo calendário, histórico de
remarcação, controle de comparecimento.

### Verificação

`deal-form` salva e relê data+hora no fuso da conta; `npm run test` verde em
`src/lib/inbox/deals.test.ts`; nenhuma ocorrência de `expected_close_date` ou
de `'won'` restante no repositório.

---

## Change 2 — `centralized-ai-setup`

### Why

A IA está pronta no código (providers, RAG, auto-reply, playground) mas
escondida atrás da mesma flag de Broadcasts/Flows, e exige que o cliente traga
a própria chave de OpenAI. Nenhum médico vai gerar uma API key. A chave e o
modelo passam a ser da Effect.

### What changes

- Remove AI Agents do conjunto gated; a flag continua cobrindo Broadcasts,
  Automations e Flows.
- `AI_PROVIDER`, `AI_MODEL` e `AI_API_KEY` no servidor; `ai_configs.api_key`
  vira nullable e é ignorada quando o env está presente.
- Tela de IA simplificada: contexto/persona da clínica, estilo de comunicação
  padrão, base de conhecimento, e dois toggles — "IA responde automaticamente"
  (off por default) e "IA sugere rascunhos" (on).
- Novo campo `ai_configs.followup_style` com os valores Amigável, Direto,
  Consultivo e Lembrete de vaga, usado como default e trocável no envio.
- O prompt de follow-up proíbe promessa de resultado e linguagem
  sensacionalista (publicidade médica, CFM 1.974/2011).

### Spec deltas

- `openspec/specs/feature-availability/spec.md` — reduz o conjunto gated a três features.
- Nova capability `ai-assistant`.

### Arquivos principais

- `supabase/migrations/045_centralized_ai_config.sql`
- `src/lib/ai/config.ts`, `src/lib/ai/defaults.ts`, `src/lib/ai/generate.ts`
- `src/app/(dashboard)/agents/page.tsx`, `src/components/agents/*`
- O módulo que implementa a flag de features incompletas hoje

### Fora de escopo

Limite de consumo por conta, escolha de modelo por cliente, wizard em passos.

### Verificação

Conta sem `api_key` gera resposta usando a chave do env; `/agents` acessível
com a flag desligada; `/broadcasts` continua redirecionando para o dashboard.

---

## Change 3 — `client-provisioning`

### Why

Hoje qualquer pessoa cria conta em `/signup` e começa do zero. O modelo de
venda é o oposto: a Effect provisiona a conta inteira e entrega credenciais.

### What changes

- Fecha o signup público.
- Rota `/admin` protegida por `PLATFORM_ADMINS` (lista de e-mails em env).
- Formulário de provisionamento cria, em uma transação: usuário no Supabase
  Auth com e-mail já confirmado, `accounts`, `account_members` como `owner`,
  pipeline a partir do modelo de especialidade escolhido, instância UAZAPI via
  `UAZAPI_ADMIN_TOKEN`, `ai_configs` com a persona inicial e as credenciais
  Meta cifradas.
- Modelos de funil por especialidade (dentista, médico, psicólogo), definidos
  em código. Todos começam com a etapa "Em contato".
- `pipeline_stages.is_system BOOLEAN` — a etapa "Em contato" não pode ser
  renomeada, apagada nem sair da primeira posição, na UI e no banco.
- `whatsapp_config.inbound_default_stage_id` apontado para a etapa fixa, para
  que todo lead novo do WhatsApp caia nela.
- Colunas de credencial Meta (`meta_dataset_id`, `meta_access_token` cifrado).
- Banner sugerindo troca de senha no primeiro acesso.

### Spec deltas

- Nova capability `provisioning`.
- Requisito de etapa de sistema na capability de pipelines/deals.

### Arquivos principais

- `supabase/migrations/046_provisioning.sql`
- `src/app/admin/*`, `src/lib/provisioning/*`
- `src/lib/whatsapp/uazapi-admin.ts` (criação de instância)
- `src/app/(auth)/signup/page.tsx` (remoção)

### Fora de escopo

Papel `platform_admin` no banco, autoatendimento, cobrança, tela de erros CAPI.

### Verificação

Provisionar uma conta de teste ponta a ponta: login com a senha entregue,
funil com "Em contato" travada, QR code disponível em `/connection`, tentativa
de apagar a etapa fixa recusada.

---

## Change 4 — `followup-approval-queue`

### Why

Lembrete de consulta e reativação de lead parado são hoje trabalho manual, e
nenhuma mensagem automática pode sair sem revisão humana num contexto de saúde.

### What changes

- Tabela `followup_messages`: deal, offset, corpo renderizado, status
  (`pending`, `approved`, `sent`, `rejected`, `expired`), timestamps.
- Configuração por conta: até 3 offsets de lembrete (default 5 dias, 1 dia, 2
  horas), template do lembrete com `{nome}`, `{data}`, `{hora}`, `{medico}`, e
  o N de dias que define "lead parado" (default 15).
- `pg_cron` + `pg_net` chamando `/api/followups/cron` com `x-cron-secret`. O
  cron apenas materializa pendências e expira as vencidas; não envia nada.
- Seção "Pendentes de envio" na página de notificações, com **Aprovar**,
  **Recusar** e **Editar e enviar**.
- Envio usa `sendInteractiveButtons()` com Confirmar / Remarcar. A resposta
  chega como `interactive_reply_id` no webhook: "Confirmar" grava
  `appointment_confirmed_at` e sinaliza as pendências restantes do mesmo deal;
  "Remarcar" notifica no inbox sem alterar `scheduled_at`.
- Botão "Follow-up com IA" em todo lead: gera rascunho a partir do histórico da
  conversa, respeitando o estilo escolhido, e abre para revisão antes do envio.
- Aba de reativação dentro de `/pipelines`: lista filtrável por dias sem
  contato (`conversations.last_message_at`), etapa do funil e presença de
  agendamento futuro, com badge de contagem.

### Spec deltas

- Nova capability `followups`.
- `openspec/specs/inbox/spec.md` — tratamento da resposta de botão.

### Arquivos principais

- `supabase/migrations/047_followup_queue.sql`
- `src/app/api/followups/cron/route.ts`
- `src/lib/followups/*`
- `src/app/(dashboard)/notifications/page.tsx`
- `src/app/(dashboard)/pipelines/page.tsx`
- `src/app/api/whatsapp/webhook/[secret]/route.ts` (resposta de botão)
- `src/app/api/ai/draft`, `src/lib/ai/generate.ts`

### Fora de escopo

Envio em lote, reativação automática, IA no texto do lembrete, cancelamento
por botão.

### Verificação

Teste de unidade da materialização de pendências (offsets, deduplicação por
`deal + offset`, expiração após o horário do agendamento) e do roteamento da
resposta de botão. Um agendamento de teste gera exatamente 3 pendências.

---

## Change 5 — `meta-capi-qualified-lead`

### Why

As campanhas otimizam por lead qualificado, mas a Meta nunca recebe o sinal: o
tracking CTWA que chega no webhook da UAZAPI (`ctwaClid`, `sourceID`,
`conversionSource`) é descartado hoje.

### What changes

- O webhook passa a persistir `ctwa_clid`, `ad_source_id` e `ctwa_clid_at` em
  `contacts` quando a mensagem traz `contextInfo.externalAdReply`.
- Quando um deal vira `qualified`, envia `Lead` para
  `graph.facebook.com/v23.0/<dataset_id>/events` com
  `action_source: "business_messaging"`, `messaging_channel: "whatsapp"`,
  `user_data.ctwa_clid` e `event_id = deal.id` para deduplicação.
- Tabela `meta_capi_events` com status, payload e erro. Falhas entram em retry
  no cron já criado na change 4.
- Contador de falhas exposto em `/admin`.

### Spec deltas

- Nova capability `meta-conversions`.
- `openspec/specs/whatsapp-messaging/spec.md` — captura do tracking no inbound.

### Arquivos principais

- `supabase/migrations/048_meta_capi.sql`
- `src/app/api/whatsapp/webhook/[secret]/route.ts`
- `src/lib/meta/capi.ts`
- `src/lib/inbox/deals.ts` (gatilho na mudança de status)
- `src/app/admin/*`

### Fora de escopo

Evento no agendamento, relatório de criativo dentro do CRM, hash de telefone,
tela dedicada de erros.

### Verificação

Teste com o payload real do webhook (exemplo do Dr. Arthur Pena) confirmando
que o `ctwa_clid` é extraído e gravado; envio para a Meta com `event_id`
estável não duplica o evento quando reprocessado.

---

## Riscos conhecidos

1. **Janela do `ctwa_clid`.** A Meta descarta eventos cujo clique é antigo
   demais. Lead que qualifica semanas depois não gera evento válido — isso fica
   visível em `meta_capi_events` como falha, não como silêncio.
2. **Token Meta vencido.** Sem a tela dedicada, o contador em `/admin` é a
   única superfície. Vale checar periodicamente até a tela existir.
3. **Auto-reply em contexto clínico.** O toggle existe e vem desligado.
   `src/lib/ai/handoff.ts` já implementa a saída para humano, mas o limiar
   precisa ser calibrado antes de oferecer o recurso a um cliente.
4. **Remoção de `expected_close_date`.** É destrutiva e sem down-migration.
   Fazer backup antes de aplicar em produção.
