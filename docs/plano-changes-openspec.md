# Plano de changes — OpenSpec

Onze changes, uma branch cada, na ordem em que devem ser feitas. Cada bloco
traz o texto pronto para colar no `opsx:propose`, o nome da branch, as
decisões que aquela change carrega e as specs que ela toca.

## Antes de começar

Termine e arquive `openspec/changes/admin-client-lifecycle`. Faltam apenas
verificações manuais: a tarefa `3.3` (aplicar `050_account_deactivation.sql`
no editor SQL do Supabase), a `5.6` e as `7.1`–`7.3`. Enquanto ela estiver
aberta, as changes 1, 2 e 3 editam specs que ainda estão em delta, e o
`opsx:propose` vai gerar conflito sobre conflito.

Duas decisões desta rodada revogam o que essa change entregou. Está previsto:
a change 2 corrige a promessa de que desativar não apaga nada, e a change 3
desfaz a redução das especialidades a dentista e médico. A revogação é
explícita dentro de cada proposta, que é como o OpenSpec registra uma decisão
revista.

## Ordem e dependências

A seta significa dependência real: a change de baixo precisa da de cima já no
`main`.

| #   | Change                                    | Branch                                 | Depende de |
| --- | ----------------------------------------- | -------------------------------------- | ---------- |
| 1   | `platform-admin-profiles`                 | `feat/platform-admin-profiles`         | —          |
| 2   | `account-teardown-uazapi`                 | `feat/account-teardown-uazapi`         | —          |
| 3   | `health-specialties-and-funnel-templates` | `feat/specialties-and-funnels`         | —          |
| 4   | `brazilian-formatting`                    | `feat/brazilian-formatting`            | —          |
| 5   | `contact-always-lands-in-contato`         | `feat/contact-always-lands-in-contato` | 3          |
| 6   | `followup-single-placeholder`             | `fix/followup-single-placeholder`      | —          |
| 7   | `account-pendings-panel`                  | `feat/account-pendings-panel`          | 6          |
| 8   | `ai-conversation-controls`                | `feat/ai-conversation-controls`        | 7          |
| 9   | `ai-agent-prompt-builder`                 | `feat/ai-agent-prompt-builder`         | 3, 8       |
| 10  | `lost-deal-stops-meta-conversion`         | `feat/lost-deal-stops-meta-conversion` | —          |
| 11  | `demo-account-seed`                       | `feat/demo-account-seed`               | 3, 5, 6    |

As changes 1, 2, 3, 4, 6 e 10 não dependem de nada e podem correr em paralelo.
A 11 é a última porque semeia exatamente o que as outras definem.

Cada change atualiza o `CONTEXT.md` com os termos que ela resolve, em vez de
um mutirão de glossário no fim.

---

## 1. `platform-admin-profiles`

**Branch:** `feat/platform-admin-profiles`
**Specs:** `provisioning`, `admin-console`
**Depende de:** nada

### Decisões

- Os operadores de plataforma saem do `PLATFORM_ADMINS` e passam a viver em
  tabela. O env continua existindo como semente de bootstrap: quem está nele é
  **gerente**, e o deployment nunca fica trancado para fora de si mesmo.
- Dois papéis de operador. O **gerente** é o único que cadastra e remove
  operadores. O **admin** faz tudo com contas de cliente — provisiona,
  renomeia, reemite senha, desativa, reativa, edita a configuração de anúncios
  — e enxerga todas as contas, não só as que criou.
- Um operador não é membro de conta nenhuma. Ele é dono do produto; os
  usuários das contas são clientes do produto. O shell do cliente nunca
  renderiza para ele: nem barra lateral de conta, nem pendências de conectar
  WhatsApp ou configurar pixel.
- O login de um e-mail de operador leva direto ao `/admin`, e o encerramento de
  sessão mora lá dentro.

### Prompt para o `opsx:propose`

```
Tirar a lista de operadores de plataforma do env e colocá-la no banco, com dois
papéis, e separar por completo a sessão de operador da sessão de cliente.

Hoje `src/lib/provisioning/platform-admins.ts` lê `PLATFORM_ADMINS` e compara
e-mails. Quero uma tabela de operadores com nome, e-mail e papel, mais quem
cadastrou e quando. O `PLATFORM_ADMINS` continua valendo, mas só como semente:
todo e-mail que estiver nele é operador com papel de gerente, mesmo sem linha na
tabela — é o que impede o deployment de ficar sem ninguém que possa entrar.

Dois papéis. "Gerente" é o único que pode cadastrar e remover operadores, numa
tela nova dentro do /admin. "Admin" pode tudo que diz respeito a contas de
cliente — provisionar, renomear, reemitir senha, desativar, reativar, editar a
configuração de anúncios — e vê todas as contas, sem escopo por quem criou.
Nenhum dos dois pode se auto-remover ou se auto-promover.

Um operador não é membro de conta alguma: ele é o dono do produto, os usuários
das contas são clientes. Quando um e-mail de operador faz login, ele vai para
/admin, nunca para /dashboard, e nenhuma superfície de cliente renderiza para
ele — sem barra lateral de conta, sem banner de trocar senha, sem pendência de
conectar WhatsApp ou de configurar pixel. O botão de sair fica dentro do /admin.
Hoje `getCurrentAccount()` exige membership e o layout de dashboard assume que
todo mundo tem conta; isso precisa deixar de valer para operador.

Toda verificação de operador continua sendo refeita no servidor a cada ação,
como já é hoje, e agora consulta a tabela além do env.
```

---

## 2. `account-teardown-uazapi`

**Branch:** `feat/account-teardown-uazapi`
**Specs:** `admin-console`, `whatsapp-connection`
**Depende de:** nada

### Decisões

- Desativar uma conta apaga a instância dela no UAZAPI.
- Reativar devolve todos os dados do CRM — contatos, negócios, conversas — mas
  **não** a conexão: o cliente precisa parear o número outra vez.
- A promessa atual de `admin-client-lifecycle` ("nada foi apagado, reativar
  devolve tudo como estava") passa a ser falsa sobre a conexão e precisa ser
  corrigida na spec e no texto de confirmação.

### Prompt para o `opsx:propose`

```
Quando um operador desativa uma conta, apagar a instância dela no UAZAPI.

Hoje a desativação só marca `accounts.deactivated_at` e cancela as conversões à
espera. A instância no gateway continua de pé, ocupando um slot e mantendo uma
sessão de WhatsApp viva de um cliente que não é mais cliente.

Desativar passa a apagar a instância no gateway. Reativar devolve todos os dados
do CRM — contatos, negócios, conversas, histórico — mas não devolve a conexão: o
cliente vai precisar escanear o QR code de novo e a conta volta com o WhatsApp
desconectado.

Isso contradiz o que a spec de admin-console afirma hoje, que desativar não
apaga nada e reativar devolve tudo como estava. A afirmação precisa ser
corrigida onde estiver, e a confirmação de desativação precisa dizer, com todas
as letras, que a conexão do WhatsApp será perdida e exigirá novo pareamento —
antes de o operador confirmar, não depois.

Se o gateway não responder na hora de apagar, a conta ainda assim é desativada e
o operador é avisado de qual instância ficou para trás, identificada o bastante
para remover à mão. Uma conta que não pode ser desativada porque o gateway caiu
é pior que uma instância órfã.
```

---

## 3. `health-specialties-and-funnel-templates`

**Branch:** `feat/specialties-and-funnels`
**Specs:** `provisioning`, `deals`
**Depende de:** nada

### Decisões

- Especialidade e modelo de funil deixam de ser o mesmo campo. Especialidade é
  o nicho de saúde em que o cliente atua; o modelo de funil é o pipeline
  principal da conta. São escolhas independentes no provisionamento.
- A especialidade não decide mais nada: descreve a clínica e entra no contexto
  da IA.
- Lista de especialidades: as 14 profissões de saúde reconhecidas pelo Conselho
  Nacional de Saúde — assistente social, biólogo, biomédico, profissional de
  educação física, enfermeiro, farmacêutico, fisioterapeuta, fonoaudiólogo,
  médico, médico veterinário, nutricionista, odontólogo, psicólogo, terapeuta
  ocupacional — mais "estética e cosmetologia" e mais "Outros", que abre campo
  de texto livre.
- Quatro modelos de funil, todos com "Em contato" como primeira etapa e etapa
  de sistema, e "Perdido" como última.
- Os quatro pipelines se chamam **"Funil de vendas"**. O que varia são as
  etapas.
- "Perdido" é organização visual do time. Arrastar um card para lá **não**
  mexe no `status` do negócio, e marcar um negócio como perdido não move o
  card. O `status = lost` continua sendo a decisão, como já é hoje.
- Revoga a redução a `dentist` e `physician` feita em `admin-client-lifecycle`.

### Prompt para o `opsx:propose`

```
Separar especialidade de modelo de funil no provisionamento, trocar a lista de
especialidades e substituir os templates de pipeline por quatro.

Hoje escolher a especialidade escolhe o template de pipeline — um campo com dois
papéis, e por isso o conjunto foi reduzido a dentista e médico. Passam a ser
dois campos independentes. Especialidade é o nicho de saúde em que o cliente
atua: descreve a clínica, entra no contexto da IA e não decide mais nada. Modelo
de funil é o pipeline principal que a conta vai nascer com, escolhido pelo
gestor antes de criar a conta.

A lista de especialidades passa a ser as 14 profissões de saúde reconhecidas
pelo Conselho Nacional de Saúde — assistente social, biólogo, biomédico,
profissional de educação física, enfermeiro, farmacêutico, fisioterapeuta,
fonoaudiólogo, médico, médico veterinário, nutricionista, odontólogo, psicólogo
e terapeuta ocupacional — mais "estética e cosmetologia", mais "Outros", que
abre um campo de texto livre. Isso desfaz a redução a dentista e médico que a
change admin-client-lifecycle fez.

Quatro modelos de funil, nesta ordem de etapas:

1. Em contato, Follow-up, Avaliação agendada, Avaliação realizada, Orçamento
   apresentado, Procedimento agendado, Concluído, Perdido
2. Em contato, Follow-up, Consulta agendada, Consulta realizada, Tratamento
   indicado, Retorno agendado, Concluído, Perdido
3. Em contato, Follow-up, Avaliação agendada, Avaliação realizada, Proposta
   apresentada, Procedimento agendado, Concluído, Perdido
4. Em contato, Follow-up, Reunião agendada, Reunião realizada, Proposta enviada,
   Negociação, Fechado, Perdido

Os quatro pipelines se chamam "Funil de vendas" — o nome é o mesmo, o que muda
são as etapas. "Em contato" continua sendo a primeira etapa e a etapa de
sistema protegida, em todos.

"Perdido" é só organização visual do quadro. Arrastar um card para "Perdido" não
altera o status do negócio, e marcar um negócio como perdido não move o card. O
status `lost`, com o motivo que já existe, continua sendo a decisão de verdade.

Contas já provisionadas não são tocadas: um template é lido uma vez, na criação.
```

---

## 4. `brazilian-formatting`

**Branch:** `feat/brazilian-formatting`
**Specs:** `localization`
**Depende de:** nada

### Decisões

- Todo número, moeda e data formata em `pt-BR`, não no locale do navegador de
  quem está olhando.
- Contas novas nascem com moeda `BRL` em vez de `USD`.
- Seletor de data vira o do shadcn (`calendar`, sobre `react-day-picker`), com
  dia e hora no mesmo controle, no lugar dos `datetime-local` de hoje.
- Nenhum identificador interno aparece para o usuário.

### Prompt para o `opsx:propose`

```
Três acertos de apresentação, todos mecânicos, numa change só.

Primeiro, formatação brasileira. Há cerca de oito chamadas de `toLocaleString()`
sem locale espalhadas pelo app — dashboard, broadcasts, console de admin — e
cada uma formata no locale do navegador de quem está olhando, não no do produto.
Todas passam a formatar em pt-BR. E `accounts.default_currency` tem default
'USD' desde a migration 021: contas novas passam a nascer em BRL. Contas que já
existem ficam como estão; trocar a moeda de uma conta em operação reinterpreta
os valores dos negócios dela.

Segundo, o seletor de data. Hoje o agendamento do lead usa um input
`datetime-local` cru. Instalar o componente `calendar` do shadcn e montar um
seletor único de data e hora, aplicado ao agendamento do lead e a todo filtro de
data da aplicação.

Terceiro, nenhum identificador interno visível. `memberLabel()` em
`src/lib/account/members.ts` cai para o `user_id` — um UUID — quando o membro
não tem nome nem e-mail, e o mesmo fallback está em `automation-builder.tsx`.
Passa a mostrar um rótulo legível de membro sem nome. Vale como regra geral:
nenhuma tela mostra UUID ao usuário, em lugar nenhum — nem no seletor de
pipeline, nem no de responsável pelo atendimento, nem em mensagem de erro.
```

---

## 5. `contact-always-lands-in-contato`

**Branch:** `feat/contact-always-lands-in-contato`
**Specs:** `contacts`, `deals`, `provisioning`
**Depende de:** 3

### Decisões

- Todo contato criado ganha um negócio na etapa "Em contato" do funil da conta,
  em todas as portas: formulário de contato, importação CSV, API pública
  `/api/v1/contacts`, automação e mensagem recebida no WhatsApp.
- Iniciar uma conversa com um contato que ainda não tem negócio também cria o
  negócio. Não é preciso esperar o lead responder.
- Deixa de ser opt-in: hoje depende de `whatsapp_config.inbound_default_pipeline_id`
  estar configurado, e falha em silêncio quando não está.
- A importação avisa quantos negócios vai criar antes de confirmar.
- Contas existentes: a migração cria o negócio que falta para contatos órfãos e
  **não** funde os que têm mais de um — fundir apagaria histórico.

### Prompt para o `opsx:propose`

```
Fazer com que todo contato tenha um negócio em "Em contato", por qualquer porta
que ele entre, e também quando somos nós que iniciamos a conversa.

Hoje só a mensagem recebida no WhatsApp cria negócio, é opt-in (depende de
`whatsapp_config.inbound_default_pipeline_id` e `inbound_default_stage_id` terem
sido configurados) e é best-effort: se falhar, registra no log e segue. O
resultado é contato sem negócio, que não aparece no funil.

Passa a valer em todas as portas de criação de contato: o formulário de contato,
a importação de CSV, a API pública POST /api/v1/contacts, a automação e a
mensagem recebida no WhatsApp. Todo contato criado ganha um negócio na etapa "Em
contato" do funil da conta, com o status open.

E quando somos nós que abrimos a conversa: iniciar um atendimento no WhatsApp
com um contato que ainda não tem negócio cria o negócio na hora, sem esperar o
lead responder.

O destino deixa de ser configuração opcional e passa a ser a etapa de sistema
"Em contato" do funil principal da conta, que toda conta provisionada tem.

Na importação de CSV, avisar quantos negócios serão criados antes de confirmar —
importar quinhentas linhas cria quinhentos negócios e isso não pode ser
surpresa.

Para contas que já existem, uma migração cria o negócio que falta a cada contato
órfão. Contatos que hoje têm mais de um negócio ficam como estão: fundir
apagaria histórico. O que muda é que não se cria mais órfão daqui para frente.
```

---

## 6. `followup-single-placeholder`

**Branch:** `fix/followup-single-placeholder`
**Specs:** `followups`
**Depende de:** nada

### Decisões

- O modelo de lembrete passa a aceitar um único placeholder, `{horario}`, que
  rende dia e hora no fuso da conta.
- `{nome}`, `{data}`, `{hora}` e `{medico}` deixam de existir. Uma migração
  reescreve os modelos já salvos.
- Os dois botões — confirmar e remarcar — já existem e continuam.
- Corrige o `FORMATTING_ERROR` que aparece no console ao abrir as configurações
  de negócios. A causa não é o follow-up: é a string de ajuda em
  `messages/en.json` e `messages/pt-BR.json`, linha 1860, onde `{medico}` está
  escrito solto e o next-intl o lê como variável ICU não fornecida. Some junto
  com o placeholder.

### Prompt para o `opsx:propose`

```
Reduzir o modelo do lembrete de follow-up a um único placeholder e matar o
FORMATTING_ERROR que ele causa hoje.

O modelo aceita quatro placeholders: {nome}, {data}, {hora} e {medico}. Passa a
aceitar um só, {horario}, que rende o dia e a hora do agendamento no fuso da
conta — por exemplo "12/03 às 14:30". Dia e hora juntos: um lembrete enviado
cinco dias antes sem a data não serve para nada.

Os outros quatro deixam de ser aceitos. Uma migração reescreve os modelos já
salvos para o novo formato, e a validação passa a recusar qualquer placeholder
fora de {horario}.

A mensagem continua saindo como mensagem interativa com os dois botões, o de
confirmar e o de remarcar, exatamente como já sai hoje.

Isso também resolve um erro que aparece no console do navegador ao abrir as
configurações de negócios:

  FORMATTING_ERROR: The intl string context variable "medico" was not provided
  to the string "{medico} reads the deal custom field named medico..."

A causa não é o follow-up: é a string de ajuda em messages/en.json e
messages/pt-BR.json, na linha 1860, onde {medico} aparece solto no texto e o
next-intl o interpreta como variável ICU que ninguém forneceu. A string some
junto com o placeholder. Se sobrar qualquer outro texto de ajuda citando um
placeholder literalmente, ele precisa ser escapado como ICU, não deixado solto.
```

---

## 7. `account-pendings-panel`

**Branch:** `feat/account-pendings-panel`
**Specs:** nova capability `pendings`, `followups`
**Depende de:** 6

### Decisões

- **Pendência** é um objeto novo, da conta e não de uma pessoa: todo membro vê
  todas as pendências, para saber o que está aberto em cada atendimento.
- Estado `pendente ⇄ atendido`, alternável nos dois sentidos, registrando quem
  mudou e quando. Dar como atendido por engano tem volta.
- As notificações pessoais que já existem (`conversation_assigned`, com
  `user_id` e `read_at`) ficam como estão. "Te atribuíram isso" é legitimamente
  pessoal.
- A página de notificações mostra as duas coisas, com as pendências em cima —
  são elas que exigem ação.
- Os follow-ups pendentes, que já vivem nessa página, são a primeira fonte de
  pendência.

### Prompt para o `opsx:propose`

```
Criar pendência como um objeto da conta e reorganizar a página de notificações
em volta dela.

Hoje a tabela `notifications` (migration 027) é pessoal: tem user_id, tem
read_at, e a RLS entrega cada linha só ao dono. Só existe um tipo em uso,
conversation_assigned. Isso serve para "te atribuíram uma conversa", mas não
serve para "este atendimento está esperando alguém" — que é da conta inteira e
precisa ser visível para todo mundo.

Pendência é um objeto novo, ao lado das notificações, não no lugar delas. Ela
pertence à conta, aponta para o atendimento de onde nasceu, e todo membro da
conta vê todas. O estado alterna entre pendente e atendido, nos dois sentidos —
marcar como atendido por engano tem que ter volta — e cada mudança registra quem
fez e quando. Botões para marcar como atendido e para devolver a pendente.

As notificações pessoais continuam como estão: conversation_assigned segue
pessoal, com read_at, sem mudança nenhuma.

A página de notificações passa a mostrar as duas seções, com as pendências em
cima, porque são elas que exigem ação. Os follow-ups pendentes, que já aparecem
nessa página numa seção própria, são a primeira fonte de pendência e passam a
usar esse mecanismo.
```

---

## 8. `ai-conversation-controls`

**Branch:** `feat/ai-conversation-controls`
**Specs:** `ai-assistant`, `whatsapp-messaging`, `inbox`
**Depende de:** 7

### Decisões

- Todo envio ao gateway leva um `delay` aleatório entre 3000 e 5000 ms. O
  campo é nativo do UAZAPI e já exibe "Digitando…" durante a espera — o
  servidor não bloqueia. Broadcasts ficam de fora: já têm ritmo próprio.
- Botão de ligar e desligar a IA por atendimento, sobre a coluna
  `conversations.ai_autoreply_disabled`, que já existe desde a migration 029.
- Depois que um agente envia uma mensagem manual, a IA fica parada por 24 horas
  naquele atendimento. O prazo é configuração da conta, com 24 h de padrão.
- Só mensagem manual pausa. Abrir, ler ou atribuir não pausam.
- O gate `if (conv.assigned_agent_id) return;` em `auto-reply.ts` sai: atribuir
  deixa de parar a IA.
- O banner do atendimento diz por que a IA está ativa ou parada, e quanto falta
  para a pausa acabar.
- Quando a IA pede transferência, nasce uma pendência (change 7) — hoje, sem
  `handoff_agent_id` configurado, a conversa é marcada e ninguém é avisado.

### Prompt para o `opsx:propose`

```
Dar controle operacional sobre a IA em cada atendimento, e fazer com que ela
escreva com ritmo humano.

Primeiro, o ritmo. Todo envio de mensagem ao UAZAPI passa a levar um delay
aleatório entre 3000 e 5000 milissegundos. O UAZAPI tem um campo `delay` nativo
no payload de envio que já mostra "Digitando..." para o lead durante a espera —
usar esse campo, nunca um timer no servidor, senão o webhook e a interface
travam junto. Broadcasts ficam de fora: já têm o próprio controle de ritmo.

Segundo, um botão por atendimento que mostra se a IA está ativa ali e permite
parar ou reativar. A coluna `conversations.ai_autoreply_disabled` já existe
desde a migration 029 e é exatamente isso; falta a interface e falta ela ser
reversível pelo agente.

Terceiro, pausa automática. Depois que um agente envia uma mensagem manual num
atendimento, a IA fica parada ali por 24 horas. O prazo é configuração da conta,
guardado junto das demais configurações da IA, com 24 horas de padrão. Só
mensagem manual pausa: abrir a conversa, ler ou se atribuir a ela não pausam
nada, porque todo mundo abre conversa sem intenção de assumir.

Quarto, tirar o gate de atribuição. Hoje `src/lib/ai/auto-reply.ts` tem
`if (conv.assigned_agent_id) return;` — ter dono humano cala a IA. Isso sai. O
que segura a IA passa a ser o botão, a pausa de 24 horas, o teto de respostas
por conversa e o handoff que a própria IA pede.

O banner do atendimento precisa dizer por que a IA está ativa ou parada, e
quanto tempo falta quando a pausa é automática. Nunca deve ser surpresa.

Por último, quando a IA pede transferência ela hoje marca a conversa, atribui ao
agente de handoff se houver um configurado, e não avisa mais ninguém — se não
houver, ninguém fica sabendo. Passa a criar uma pendência da conta, visível para
todos no painel de notificações.
```

---

## 9. `ai-agent-prompt-builder`

**Branch:** `feat/ai-agent-prompt-builder`
**Specs:** `ai-assistant`
**Depende de:** 3, 8

### Decisões

- A configuração do agente deixa de ser um textarea livre e vira um formulário
  em passos, dentro de um modal: Identidade, Clínica, Procedimentos (lista),
  Especialidade, Objeções.
- O template do prompt fica fixo no código. As regras de publicidade médica
  (CFM 1.974/2011) não podem ser editáveis, e um template no código melhora
  todas as contas de uma vez quando é atualizado.
- O prompt final é montado na geração, não guardado como texto.
- A edição livre continua existindo, mas só para operador Effect.
- A ferramenta `adicionar_nome` passa a existir: a IA grava o nome do lead
  **só** quando o contato ainda não tem nome, e nunca sobrescreve um nome
  digitado por uma pessoa. A validação descrita no prompt ("Ana" sim, "quero
  agendar" não) vira código, não confiança no modelo.

### Prompt para o `opsx:propose`

```
Trocar a configuração do agente de atendimento por um formulário guiado, com o
template do prompt fixo no código.

Hoje a configuração do agente é um textarea livre (`ai_configs.system_prompt`):
o cliente escreve o que quiser e o resultado é imprevisível. O template que
queremos usar é longo, tem por volta de trinta variáveis e traz regras que não
podem ser editadas por ninguém.

O template passa a viver no código, não no banco. O cliente preenche só as
variáveis, num modal em passos: Identidade (nome do assistente, nome da clínica,
gênero dos artigos), Clínica (profissional e registro, endereço, dias e horários
de atendimento, valor da consulta, formas de pagamento, WhatsApp, Instagram),
Procedimentos (uma lista de itens com nome, descrição e benefício, que o cliente
adiciona e remove), Especialidade (perfil do paciente ideal, diferenciais do
profissional, sinais de emergência) e Objeções (as objeções mais comuns e como
responder).

O prompt final é montado na hora da geração a partir do template mais os valores
preenchidos. Não é salvo como texto — assim, melhorar o template melhora todas
as contas de uma vez, sem editar conta por conta.

As regras de publicidade médica (CFM 1.974/2011) que já são parte fixa do
scaffold continuam fixas e fora do alcance do formulário, como já são hoje.

A edição livre do prompt continua existindo, mas só para operador de plataforma,
não para o cliente.

O template descreve duas ferramentas. `transferir_atendimento` já existe no
código como o sentinela de handoff. `adicionar_nome` não existe e passa a
existir: quando o lead informa o próprio nome, a IA grava esse nome no contato —
mas só quando o contato ainda não tem nome, e nunca por cima de um nome que uma
pessoa digitou. A validação que o template descreve em prosa ("Ana" é nome,
"quero agendar" não é) tem que ser código nosso, não confiança no modelo.
```

---

## 10. `lost-deal-stops-meta-conversion`

**Branch:** `feat/lost-deal-stops-meta-conversion`
**Specs:** `meta-conversions`, `deals`; verbete do `CONTEXT.md`
**Depende de:** nada

### Decisões

- Marcar um negócio como perdido cancela a conversão que ainda estiver à espera
  de envio e retira o controle de marcação do card.
- O gatilho é `status = lost`, não a etapa "Perdido" do quadro. A etapa é
  organização do time; o status é a decisão.
- Conversão já enviada fica. Não existe desfazer na Meta, e apagar o registro
  mentiria sobre o que foi enviado.
- **Revoga uma decisão anterior**: `meta-conversions/spec.md` (requisito na
  linha 27) e o verbete "Conversion mark" do `CONTEXT.md` dizem hoje que a
  marcação é independente do status e que um negócio perdido pode ser marcado.
  Deixa de valer.

### Prompt para o `opsx:propose`

```
Parar de enviar conversão para a Meta quando o negócio é dado como perdido.

Hoje a spec de meta-conversions diz, e o CONTEXT.md repete no verbete
"Conversion mark", que a marcação de conversão é independente do status do
negócio — um negócio perdido pode ser marcado, e mudar o status não altera
marcação nenhuma. Foi decisão deliberada, e esta change a revoga: se a venda
morreu, a Meta não deve aprender com aquele clique.

Marcar um negócio como perdido passa a cancelar a conversão que ainda estiver à
espera de envio e a retirar o controle de marcação do card. O gatilho é o status
`lost`, não a etapa "Perdido" do quadro — a etapa é organização visual do time,
o status é a decisão.

Conversão já enviada fica como está. Não existe desfazer do lado da Meta, e
apagar o registro mentiria sobre o que de fato foi enviado.

Reabrir um negócio perdido devolve o controle de marcação. A conversão cancelada
não volta sozinha: quem reabriu marca de novo se quiser, e aí vale a regra de
sempre sobre o clique estar ou não velho demais para a Meta aceitar.

Atualizar o verbete "Conversion mark" do CONTEXT.md junto, já que a frase "a
lost one marked" deixa de ser verdade.
```

---

## 11. `demo-account-seed`

**Branch:** `feat/demo-account-seed`
**Specs:** `provisioning`, `admin-console`
**Depende de:** 3, 5, 6

### Decisões

- Caixa opcional no formulário de provisionamento **e** botão na página da
  conta no `/admin`, os dois chamando a mesma rotina, mais um botão para
  remover os dados de demonstração.
- Tudo o que a rotina cria carrega marcação `is_demo`, para a remoção ser
  exata em vez de arqueologia.
- Conteúdo: 8 contatos, 8 negócios espalhados por todas as etapas do funil que
  a conta escolheu, conversas com histórico de mensagens, 2 agendamentos
  futuros e 3 follow-ups pendentes na fila.

### Prompt para o `opsx:propose`

```
Popular uma conta com dados de demonstração, para o cliente conseguir testar o
produto antes de ter movimento de verdade.

Uma conta recém-provisionada está vazia: funil sem cards, caixa de entrada sem
conversas, fila de follow-up sem nada. O cliente entra e não tem o que olhar,
nem como experimentar aprovar um lembrete.

Uma rotina de semeadura, com dois gatilhos: uma caixa opcional no formulário de
provisionamento, para já nascer povoada, e um botão na página da conta dentro do
/admin, para semear depois. Mais um terceiro botão, que remove os dados de
demonstração.

Tudo o que a rotina cria carrega uma marcação de demonstração — contatos,
negócios, conversas, mensagens, agendamentos, follow-ups. A remoção apaga
exatamente o que foi semeado e não encosta em nada que o cliente tenha criado.
Sem essa marcação, remover vira arqueologia.

O que a rotina cria: oito contatos com nome e telefone plausíveis, oito negócios
espalhados por todas as etapas do funil que aquela conta escolheu, conversas com
histórico de mensagens trocadas nos dois sentidos, dois agendamentos futuros e
três follow-ups pendentes na fila esperando aprovação — que é justamente o que
dá para experimentar aprovar, rejeitar e editar.

Nenhuma mensagem é enviada de verdade em nenhum momento: os dados são semeados
direto no banco, o gateway do WhatsApp não é acionado.
```
