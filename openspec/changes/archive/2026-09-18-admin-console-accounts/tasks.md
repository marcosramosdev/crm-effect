## 1. Shared building blocks

- [x] 1.1 Extract `EVENT_NAME_RE` and its rejection message out of `src/app/api/admin/accounts/[id]/meta/route.ts` into a shared module (design.md D10) exporting a pure `validateMetaEventName(value: unknown)`; make the PATCH route import it with no behaviour change and verify `src/app/api/admin/accounts/[id]/meta/route.test.ts` still passes untouched
- [x] 1.2 Create `src/lib/meta/graph.ts` with the Graph version in one exported constant and a `metaGraphGet()` wrapper that builds `https://graph.facebook.com/<version>/<encoded path>`, sends the token as a bearer credential and wraps the call in `AbortSignal.timeout(10_000)` (design.md D4/D5); verify the host is a literal and the only interpolated part is an encoded path segment
- [x] 1.3 Add the pure classifier beside it mapping a Meta error body onto the four outcomes of the spec — dead token (`code 190`), business-manager mismatch (`code 100` with subcode 33 or `#803` in the message), any other Meta error (pass `error.message` through), and a call that never completed (network error or timeout, which is NOT a rejection); verify with a unit test over one recorded body per branch plus a thrown `AbortError`
- [x] 1.4 Verify the classifier never returns an empty message: a Meta body with no `error.message` must still produce something the operator can read

## 2. Validate route

- [x] 2.1 Add `POST /api/admin/accounts/[id]/meta/validate` re-checking `isPlatformAdmin` in the route itself — `src/middleware.ts:110` covers `/admin`, not `/api/admin` — and verify a non-operator session is rejected with no outbound call made
- [x] 2.2 Take `metaDatasetId` and optional `metaAccessToken` from the body, rejecting a blank dataset identifier; verify a request with no dataset identifier is refused before any network call
- [x] 2.3 Fall back to the account's stored token when the submitted one is blank, decrypting it in the route (design.md D4); verify the same "blank leaves it alone" rule as the PATCH route, and that the stored token appears nowhere in the response body
- [x] 2.4 Call `GET /<version>/<datasetId>?fields=id,name,owner_business` through `metaGraphGet()`, returning the dataset name on success and the classified outcome on failure; verify with a stubbed fetch covering success, `190`, `100`/`#803`, an unmapped error and a timeout
- [x] 2.5 Verify nothing is written to `accounts` on any path through this route — success included (design.md D6)

## 3. The account list at `/admin`

- [x] 3.1 Extend the server query in `src/app/admin/page.tsx` to join `whatsapp_config` on `account_id` for `connection_state`, `paired_phone` and `paired_at` (design.md D2); verify an account whose client never scanned reads as not connected rather than as missing data
- [x] 3.2 Replace the two-status counter query with one that reads every status and counts by account (design.md D3), carrying the ponytail comment that names the row-count ceiling; verify with seeded rows that a `canceled` and a `failed` row are both counted
- [x] 3.3 Render the counters by the spec's rule — waiting and unreportable always, every other state only when non-zero; verify an account with zero events shows both as zero and shows no other state, and that seeding one `failed` row makes a failed count appear with no code change
- [x] 3.4 Split `src/components/admin/meta-accounts-panel.tsx`: the row keeps `classifyAccountMetaStatus` and its test and becomes a list row linking to the account page; the edit form moves out to its own component for section 4. Verify `src/components/admin/meta-accounts-panel.test.ts` still covers the classifier after the move
- [x] 3.5 Verify the list still renders when `whatsapp_config` has no row for an account at all (a provision that failed midway) instead of dropping the account from the list

## 4. The account page

- [x] 4.1 Add `src/app/admin/accounts/[id]/page.tsx` as a server component reading through the service-role client, with an explicit select list that fetches neither the access token ciphertext nor any phone number (design.md D8); verify a 404-style response for an id that is not an account
- [x] 4.2 Verify the page is unreachable for a non-operator: `src/middleware.ts` already guards the `/admin` prefix, so this is a check that the new path really sits under it
- [x] 4.3 Mount the advertising configuration form moved in 3.4, unchanged in behaviour, and verify saving from the new page still hits `PATCH /api/admin/accounts/[id]/meta` and still treats a blank token as "leave unchanged"
- [x] 4.4 Add the validate action next to the credentials, sending the values currently in the form rather than the saved ones, and render the four outcomes distinctly — confirmed with the dataset name, dead token, business-manager mismatch, and a check that did not complete; verify the credentials are not saved as a side effect of validating
- [x] 4.5 Add a pure `deriveAccountSetup()` beside `classifyAccountMetaStatus` returning the five derived conditions (connected, dataset and token both present, test code set, any contact with a click, any conversion recorded) and render them as state; verify with a unit test per condition
- [x] 4.6 Render the three conditions the system cannot know as static reminder text with no control that would mark them done (design.md D11); verify no interactive element exists next to them
- [x] 4.7 Add the conversions table: the 50 most recent rows for the account by `created_at desc`, joined to `contacts(name)`, showing contact name, status, `event_time`, `attempts` and a truncated `last_error`; verify the query's select list contains neither `ctwa_clid` nor `contacts.phone`
- [x] 4.8 Show a contact with `name = NULL` as an unnamed contact, with no fallback to the phone number; verify with a seeded nameless contact
- [x] 4.9 Add the status filter as a client-side filter over the rows already loaded (design.md D7); verify filtering does not re-query and does not change which 50 rows are in play
- [x] 4.10 Verify an account with zero conversions shows the "none yet" state rather than an empty table with headers

## 5. Provisioning form

- [x] 5.1 Add `metaPageId` and `metaEventName` to `ProvisionInput` and to the `accounts` update in `src/lib/provisioning/provision.ts:151`, both optional and both omitted from the patch when absent; verify provisioning still succeeds with none of the advertising fields, with some, and with all four
- [x] 5.2 Validate the submitted event name through the shared module from 1.1 so provisioning rejects exactly what the edit surface rejects; verify a rejected event name creates no account and no auth user
- [x] 5.3 Add both fields to `src/components/admin/provisioning-form.tsx` with `Lead` pre-filled as the event name, and verify the form still submits with them left empty
- [x] 5.4 Verify the provisioning form offers no test event code field, and that nothing in section 5 writes `meta_test_event_code`

## 6. Wording

- [x] 6.1 Add every new string to `messages/pt-BR.json` and `messages/en.json` under `AdminConsole`, keeping the existing `metaConfig` keys where the form still uses them; verify both files parse and the console renders in both locales
- [x] 6.2 Rewrite item 5 of `AdminConsole.metaConfig.setupChecklist` in both catalogs so the validation step says to mark the lead's card, not to qualify a lead (`CONTEXT.md`, Conversion mark); verify the word for qualification appears nowhere in the console's setup text
- [x] 6.3 Name the connection states in the operator's terms rather than the gateway's (`connected` / `connecting` / `disconnected` / `hibernated`), and verify each of the four renders with a translated label in both catalogs

## 7. Verification

- [x] 7.1 Run `npm run test`, `npm run lint`, `npm run typecheck` and `npm run build`; verify all green, noting any pre-existing failure that this change does not touch. Typecheck, lint (0 errors, 66 warnings — all pre-existing) and build are green; `npm run test` is 1107 passed / 5 failed, and the same 5 fail on a stashed clean tree: locale failures in `src/lib/currency.test.ts` and `src/lib/dashboard/date-utils.test.ts`, untouched by this change
- [ ] 7.2 In the running app as a listed operator, open `/admin` with at least two accounts — one connected, one never scanned — and verify both states and both counter sets read correctly
- [ ] 7.3 Open an account page and run validate with a deliberately mistyped dataset identifier; verify the failure is reported, the form still holds what was typed, and the stored configuration is unchanged
- [ ] 7.4 Run validate again with a correct dataset identifier and the token field left blank on an account that already has a token; verify it validates against the stored token
- [ ] 7.5 Mark a deal from a clinic's board, then reload that account's page; verify the conversion appears in the table with its state, and that the waiting counter moved
- [ ] 7.6 Sign in as a clinic user and open `/admin` and `/admin/accounts/<id>` directly; verify both are refused with no account data disclosed
- [x] 7.7 Verify `openspec validate admin-console-accounts --strict` passes
