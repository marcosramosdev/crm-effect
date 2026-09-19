## Why

Today the specialty control does two unrelated jobs: it says what kind of clinic
this is, and it picks the pipeline the account is born with. Because the second
job is expensive — every specialty needs a hand-written funnel — the first job
was cut down to fit it, and `admin-client-lifecycle` reduced the whole list to
two values, dentist and physician. The agency sells to far more than two
professions, so operators pick a specialty that is wrong about the clinic just
to get the funnel they want.

Splitting the field ends the trade: the specialty can describe any health
profession, and the funnel can be chosen for how that clinic actually sells.

## What Changes

- **BREAKING** Specialty and funnel model become two independent, both required,
  provisioning fields. Choosing a specialty no longer chooses a pipeline.
- **BREAKING** The specialty list is replaced. It becomes the 14 health
  professions recognised by the Conselho Nacional de Saúde — assistente social,
  biólogo, biomédico, profissional de educação física, enfermeiro, farmacêutico,
  fisioterapeuta, fonoaudiólogo, médico, médico veterinário, nutricionista,
  odontólogo, psicólogo, terapeuta ocupacional — plus "estética e cosmetologia",
  plus "Outros", which opens a free-text field. This revokes the reduction to
  `dentist` and `physician` made by `admin-client-lifecycle`.
- The specialty stops deciding anything. It is recorded on the account as a
  description of the clinic, and an operator can read it back on the account's
  console page. Feeding it to the assistant is deliberately **not** in this
  change.
- **BREAKING** The two specialty pipeline templates are replaced by four funnel
  models, offered as "Modelo 1" … "Modelo 4" with their stage sequence shown
  under each. Every model opens with the protected system stage "Em contato" and
  closes with "Perdido".
- **BREAKING** The seeded pipeline is named "Funil de vendas" for all four
  models, instead of being named after the clinic.
- "Perdido" is stated as board organisation only: dragging a card into it does
  not change the deal's `status`, and marking a deal lost does not move its card.
  `status = lost`, with the reason it already captures, stays the decision.
- Accounts that already exist are not touched. A template is read once, at
  creation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `provisioning`: specialty and funnel model become two separate required
  inputs; the specialty list and its stored value are replaced; "Specialty
  templates seed the pipeline" is replaced by four funnel models and a fixed
  pipeline name.
- `deals`: a stage named "Perdido" is board organisation, decoupled in both
  directions from the deal's `lost` status.
- `admin-console`: the account's console page shows the recorded specialty among
  the facts the system knows about the account.

## Impact

- `src/lib/provisioning/templates.ts` — the specialty union and the two
  templates are replaced by a specialty list and four funnel models; the stage
  colour palette grows from six entries to eight.
- `src/lib/provisioning/provision.ts` — `ProvisionInput` gains the funnel model
  and the free-text specialty, `DEFAULT_SPECIALTY` is removed, the pipeline is
  named "Funil de vendas", and the specialty is written to the account.
- `src/app/api/admin/provision/route.ts` — both fields are validated as required
  before anything is created; a submission carrying only a specialty, as today's
  callers send, is refused for the missing funnel model.
- `src/components/admin/provisioning-form.tsx` — two controls instead of one,
  plus the conditional free-text field for "Outros".
- A migration adding the specialty columns to `accounts`, and the admin account
  page that reads them.
- `messages/pt-BR.json` and `messages/en.json` — the specialty labels and the
  funnel model labels.
- Tests: `templates.test.ts`, `provision.test.ts`, `route.test.ts`.
