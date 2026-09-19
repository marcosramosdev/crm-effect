## Context

See proposal.md — Why.

What exists today, and what the split has to work against:

- `src/lib/provisioning/templates.ts` holds `SpecialtyKey = "dentist" |
  "physician"`, `SPECIALTY_KEYS`, and `SPECIALTY_TEMPLATES` — six stages each,
  coloured from a six-entry `STAGE_COLORS` palette, first stage `isSystem`.
- `provision.ts` resolves `specialty` against `DEFAULT_SPECIALTY = "dentist"`,
  seeds `pipelines` with `name: clinicName`, then inserts the template's stages
  and points `whatsapp_config` at the system stage. The specialty itself is
  never written anywhere — it exists only long enough to index
  `SPECIALTY_TEMPLATES`.
- `route.ts` validates the specialty against `SPECIALTY_KEYS` and passes
  `undefined` when absent.
- `provisioning-form.tsx` renders one `Select` seeded from `SPECIALTY_KEYS`,
  labelled from `messages/*.json` under `admin.specialties.<key>`.
- Account columns that clients must not see are protected by convention, not by
  privileges: every client-side read of `accounts` names its columns
  (`use-auth.tsx` selects `id, name, default_currency, timezone`), and no code
  path does `select("*")`.

## Goals / Non-Goals

**Goals:**

- One place in the code that owns the specialty vocabulary and one that owns the
  funnel models, with no index from one into the other.
- The specialty becomes stored account data for the first time, readable by
  operators only.
- The four models are eight stages each, so the colour palette has to grow.

**Non-Goals:**

- Feeding the specialty to the assistant. The column is written and read; wiring
  it into the AI context is a later change (proposal.md).
- Editing the specialty after provisioning. It is set at creation; correcting it
  is a later change.
- Migrating existing accounts' pipelines, stage names, or pipeline names.
- Making the funnel models editable data. They stay code.

## Decisions

### D1. Both new inputs stay in `templates.ts`; no new module

The file keeps its job — "the vocabulary provisioning chooses from" — and gains
a second, independent export set: `SPECIALTIES` / `SpecialtyKey` and
`FUNNEL_MODELS` / `FunnelModelKey`. `SPECIALTY_TEMPLATES` and
`DEFAULT_SPECIALTY` are deleted.

*Alternative considered:* a `specialties.ts` and a `funnels.ts`, to make the
independence structural. Rejected: two files of constants that one caller
imports together buys nothing, and the header comment already carries the rule.

### D2. Specialty keys stay English slugs, labels stay in `messages/*.json`

`odontologo` is the label; the key is `dentist`, following the existing
`admin.specialties.<key>` pattern. Sixteen keys: `social-worker`, `biologist`,
`biomedical-scientist`, `physical-education-professional`, `nurse`,
`pharmacist`, `physiotherapist`, `speech-therapist`, `physician`,
`veterinarian`, `nutritionist`, `dentist`, `psychologist`,
`occupational-therapist`, `aesthetics-cosmetology`, `other`.

`dentist` and `physician` survive as two of the fourteen, which is coincidence
rather than compatibility: they no longer select anything. Nothing stored refers
to them, so nothing is migrated.

*Alternative considered:* Portuguese keys, matching the labels one-to-one.
Rejected: the repository stores English identifiers and translates at the edge,
and a Portuguese key inside an English type name reads worse than the
translation file it duplicates.

### D3. Funnel models are `model-1` … `model-4`, and the picker shows the stages

`FunnelModelKey = "model-1" | "model-2" | "model-3" | "model-4"`, each carrying
its `TemplateStage[]`. The label is `admin.funnelModels.<key>` — "Modelo 1" —
and the option renders the model's stage names underneath it, read straight off
the model rather than from a second translated string. Stage names are already
hard-coded Portuguese in this file, so there is nothing to translate and no way
for a label to drift from the stages it describes.

*Alternative considered:* semantic names ("Procedimentos e orçamento"). Rejected
by the operator's own call: the number plus the visible stage list is what they
choose by, and a semantic name is one more thing to keep true.

### D4. The pipeline name is the literal `"Funil de vendas"`

`provision.ts` stops passing `clinicName` as the pipeline name and passes the
constant. The account is still named after the clinic; the pipeline is not.

One constant exported from `templates.ts` next to the models, so a test can
assert it rather than repeat the string.

### D5. Two columns on `accounts`, not one

A migration adds `specialty text` and `specialty_other text`. `specialty` holds
a key from D2; `specialty_other` holds the free text and is written only when
`specialty = 'other'`, normalised to `null` otherwise, so the stored row can
never claim a niche the specialty contradicts.

Both are nullable, because every account provisioned before this change has
neither — that is the "no specialty recorded" state the admin-console delta
states, and it is why no backfill is written.

No `CHECK` constraint enumerating the sixteen keys: the list is expected to move
faster than migrations, and the route already rejects an unknown key before
anything is created. A constraint would turn a future list edit into a
migration.

*Alternative considered:* one column holding either the key or the free text.
Rejected — it makes "is this a listed specialty" a lookup against the list
rather than a fact about the row.

### D6. Client-invisibility is inherited, not newly built

Nothing is granted or revoked. The two columns are simply never added to a
client-side select list, which is how `meta_dataset_id` and `meta_access_token`
are already kept out of client responses. The admin surfaces use the service
role and name the columns explicitly.

*Alternative considered:* column-level privileges or a client-facing view.
Rejected: it would protect a description of the clinic more strongly than the
advertising token next to it, and would be the only such mechanism in the
schema.

### D7. The palette grows to eight, by extending `STAGE_COLORS`

Eight stages per model against six colours means `template()` would hand
`undefined` to two stages. `STAGE_COLORS` gains two entries continuing the
existing blue-to-rose ramp, and `template()` keeps indexing it directly rather
than wrapping modulo — a wrap would silently repeat a colour if a future model
grows again, where an out-of-range index is caught by the template test that
asserts every stage has a colour.

### D8. "Perdido" is enforced by not writing code

The deals delta is a decoupling requirement, and the current board already
satisfies it: moving a card writes `stage_id`, and marking a deal lost writes
`status`, with no path between them. The work is a regression test in the deals
board tests asserting both directions, not new behaviour.

## Risks / Trade-offs

- **Every existing provisioning caller breaks, by design.** The route now
  demands `funnelModel`, so anything posting today's body fails. → The only
  callers are the admin form and the route's own tests, both updated in the same
  change; no external API exposes provisioning.

- **The specialty list will be edited more often than the schema.** With no
  `CHECK` constraint, a key removed from the list leaves rows referring to it. →
  The admin page shows the raw key when no label matches, rather than blanking
  the field; a removed key reads as itself instead of disappearing.

- **The free text is operator-typed and unvalidated.** It is shown back on the
  account page. → It is stored trimmed and rendered as text, never as markup,
  like the clinic name beside it.

- **Four models named by number age badly** if a fifth is inserted in the
  middle. → Append rather than insert; the stage list, not the number, is what
  the operator reads.

## Migration Plan

1. Ship the migration adding the two nullable columns. It is independently safe:
   nothing reads or writes them yet.
2. Ship the code. From that deploy, new accounts record a specialty and are
   seeded from a funnel model; existing accounts are untouched and report no
   specialty.

Rollback is the code, not the schema: reverting the deploy restores the old form
and route, and the two columns are left in place, unread. Accounts provisioned
with one of the fourteen new specialties keep a value the old code never looks
at, and their pipelines keep the stages they were created with.
