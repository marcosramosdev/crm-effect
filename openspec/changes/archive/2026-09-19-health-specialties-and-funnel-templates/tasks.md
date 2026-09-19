## 1. Schema

- [x] 1.1 Add migration `052_account_specialty.sql` adding nullable `specialty`
      and `specialty_other` text columns to `accounts` (design.md D5); verify by
      applying it to a local database and confirming both columns exist,
      default to null on every existing row, and that no policy or grant
      changed. (File created; migration applied manually by the user — not run
      by this session.)

## 2. Vocabulary

- [x] 2.1 In `src/lib/provisioning/templates.ts`, replace `SpecialtyKey` /
      `SPECIALTY_KEYS` with the sixteen keys of design.md D2 and delete
      `SPECIALTY_TEMPLATES`; verify `templates.test.ts` asserts the list is
      exactly those sixteen and that `other` is last.
- [x] 2.2 In the same file, add `FunnelModelKey`, `FUNNEL_MODELS` with the four
      eight-stage models of the provisioning spec, and the exported pipeline
      name constant `"Funil de vendas"` (design.md D3, D4); verify
      `templates.test.ts` asserts each model's stage names and order, that
      stage 0 is `Em contato` with `isSystem` true, that it is the only system
      stage, and that the last stage is `Perdido`.
- [x] 2.3 Extend `STAGE_COLORS` to eight entries (design.md D7); verify
      `templates.test.ts` asserts every stage of every model has a defined
      colour.

## 3. Provisioning

- [x] 3.1 In `src/lib/provisioning/provision.ts`, make `specialty` and
      `funnelModel` required on `ProvisionInput`, add the optional
      `specialtyOther`, and delete `DEFAULT_SPECIALTY` and the specialty
      fallback in `resolveProvisionInput`; verify `provision.test.ts` no longer
      compiles a call without the two required fields and that
      `resolveProvisionInput` no longer invents a specialty.
- [x] 3.2 Write the specialty to the account in the `update_account` step,
      normalising `specialty_other` to null unless the specialty is `other`
      (design.md D5); verify `provision.test.ts` asserts the stored pair for a
      listed specialty, for `other` with text, and that free text sent
      alongside a listed specialty is dropped.
- [x] 3.3 Seed the pipeline from `FUNNEL_MODELS[funnelModel]` and name it with
      the pipeline-name constant instead of the clinic name (design.md D4);
      verify `provision.test.ts` asserts the pipeline name is `Funil de vendas`
      for a clinic named something else, and that the eight stages are inserted
      in the model's order with the inbound default pointed at the system
      stage.

## 4. Provisioning route

- [x] 4.1 In `src/app/api/admin/provision/route.ts`, validate `specialty`
      against the sixteen keys and `funnelModel` against the four, both
      required, and require non-empty `specialtyOther` when the specialty is
      `other`; verify `route.test.ts` covers a missing specialty, a missing
      funnel model, an unrecognised value for each, and `other` with blank
      text — each rejected before any sign-in identity is created.
- [x] 4.2 Pass the validated specialty, free text and funnel model through to
      `provision()`; verify `route.test.ts` asserts a fully valid submission
      reaches `provision()` with all three.

## 5. Operator surfaces

- [x] 5.1 Add the sixteen specialty labels under `admin.specialties` and the
      four `admin.funnelModels` labels to `messages/pt-BR.json` and
      `messages/en.json`, removing the two old specialty labels; verify no key
      referenced by the form is missing from either file.
- [x] 5.2 In `src/components/admin/provisioning-form.tsx`, replace the single
      specialty control with the specialty select, the conditional free-text
      field shown only for `Outros`, and the funnel model select rendering each
      model's stage sequence under its label (design.md D3); verify by
      provisioning an account through the form and seeing the chosen model's
      stages on the new account's board. (Code done; the live-form check needs
      a running app + database — deferred to 7.2.)
- [x] 5.3 Show the recorded specialty on `src/app/admin/accounts/[id]/page.tsx`,
      rendering the free text for `other`, the raw key when no label matches,
      and a plain "none recorded" for an account provisioned before this change
      (admin-console delta, design.md D5); verify against one account of each
      of the three shapes. (Code done; live-DB check deferred to 7.2.)

## 6. "Perdido" stays decoupled

- [x] 6.1 Add a regression test asserting both directions of the deals delta —
      moving a card into and out of a `Perdido` stage leaves `status` and the
      loss reason untouched, and marking a deal lost or reopening it leaves
      `stage_id` untouched; verify the test passes against the current board
      code with no production change.

## 7. Verification

- [x] 7.1 Run the full test suite and the type check; verify both pass with no
      remaining reference to `SPECIALTY_TEMPLATES`, `DEFAULT_SPECIALTY`, or the
      `dentist` / `physician` template pair. `tsc --noEmit` is clean.
      `vitest run`: 1216/1221 pass; the 5 failures (currency.test.ts,
      dashboard/date-utils.test.ts) are pre-existing, in files this change
      never touches — locale/ICU and timezone-dependent, unrelated to
      specialties or funnels.
- [ ] 7.2 Provision one account per funnel model on a local database; verify
      each gets a pipeline named `Funil de vendas` with that model's eight
      stages, the recorded specialty, and inbound leads landing in `Em contato`,
      while an account provisioned before the change is unchanged. (Needs a
      running app + database — not run in this session; do this manually
      after applying the migration.)
