## Purpose

Governs what a platform operator sees and can do about the accounts Effect runs
on behalf of its clinics: the roster of accounts and the health signals that say
whether each one is actually working, the per-account surface where its
advertising configuration is edited and checked against Meta, and the record of
the conversions that account has produced.

## ADDED Requirements

### Requirement: The console lists every account with its operational state

The operator console SHALL present every provisioned account in one list. Each
entry SHALL carry, without the operator opening anything: the account's name,
its messaging connection state, its advertising configuration state, and its
conversion counts.

The list SHALL be readable by a platform operator only, under the same
allow-list that guards provisioning, and SHALL be re-checked on the server for
every read rather than trusting the browser.

An account that has produced no conversions SHALL read as having none yet, not
as an error or an empty failure state.

#### Scenario: Operator sees the roster

- **WHEN** a platform operator opens the console
- **THEN** every provisioned account appears with its connection state,
  advertising state and conversion counts

#### Scenario: Newly provisioned account reads as quiet, not broken

- **WHEN** an account exists that has never had a conversion recorded
- **THEN** its entry states that it has no conversions yet

#### Scenario: Non-operator is turned away

- **WHEN** a signed-in user whose address is not on the platform-operator
  allow-list requests the account list
- **THEN** the request is refused and no account data is disclosed

### Requirement: The connection state shown is the one the gateway last reported

The connection state the console shows for an account SHALL be the state last
reported by the messaging gateway and recorded for that account. Rendering the
console SHALL NOT probe the gateway.

When an account's number is paired, the console SHALL also show which number it
is and when the pairing happened. When it is not, the console SHALL say so
plainly — an account whose client never scanned the code is the state that
silently loses every ad click that arrives before the scan.

#### Scenario: Connected account shows its number

- **WHEN** an account's recorded connection state is connected
- **THEN** the console shows it as connected, with the paired number and the
  moment it was paired

#### Scenario: Unscanned account is visible as such

- **WHEN** an account has been provisioned and its client has never paired a
  number
- **THEN** the console shows that account as not connected

#### Scenario: The list does not depend on the gateway being reachable

- **WHEN** the messaging gateway is unreachable and an operator opens the
  console
- **THEN** the list still renders, showing each account's last recorded
  connection state

### Requirement: Each account has its own console page

Every account in the list SHALL open onto a page dedicated to that one account,
carrying its advertising configuration form, the setup state the system can
derive, and that account's recorded conversions.

That page SHALL be restricted to platform operators by the same allow-list as
the list itself.

#### Scenario: Operator opens one account

- **WHEN** an operator selects an account from the list
- **THEN** that account's page opens with its advertising configuration, its
  setup state and its conversions

#### Scenario: Non-operator cannot open an account page

- **WHEN** a signed-in user who is not a platform operator opens an account's
  console page directly
- **THEN** they are turned away and no account data is disclosed

### Requirement: Advertising credentials can be checked against Meta before they are saved

The account page SHALL offer an action that checks a dataset identifier and
access token against Meta and reports, at once, whether that token can see that
dataset.

The check SHALL use the values currently entered in the form, before they are
saved, so that a mistyped identifier is caught before it is stored. An entered
dataset identifier SHALL be required; a blank token SHALL fall back to the
account's stored token, matching the rule the edit surface already applies to a
blank token.

The check SHALL be performed on the server. The account's stored token SHALL
NOT be disclosed to the browser at any point, including in the result.

The result SHALL NOT be stored. A token generated in Meta's Events Manager dies
with the access of the person who generated it, so a recorded past success says
nothing about the present.

#### Scenario: Valid pair is confirmed

- **WHEN** an operator checks a dataset identifier together with a token that
  can see it
- **THEN** the console confirms the pair and names the dataset Meta returned

#### Scenario: Mistyped identifier is caught before saving

- **WHEN** an operator enters a dataset identifier the token cannot see and runs
  the check
- **THEN** the failure is reported and the account's stored configuration is
  unchanged

#### Scenario: Blank token checks the stored one

- **WHEN** an operator runs the check having left the token field empty on an
  account that already has a token stored
- **THEN** the check runs against the stored token and the stored token is not
  returned to the browser

#### Scenario: Nothing is recorded

- **WHEN** a check succeeds
- **THEN** no validation outcome is written to the account, and the console
  shows no claim about validation having happened at any earlier time

### Requirement: The two failures operators actually hit are named in their own words

An invalid or expired token, and a token and dataset that sit under different
business managers, SHALL each be reported in language that says what the
operator must do about it, rather than as a Meta error code.

Any other failure SHALL show Meta's own message verbatim. Hiding an unrecognized
failure behind a generic phrase leaves the operator with nothing to act on.

A check that cannot reach Meta at all, or that does not answer within a bounded
time, SHALL be reported as an unfinished check rather than as a rejection: it
says nothing about whether the credentials are good.

#### Scenario: Dead token

- **WHEN** the check fails because the token is invalid or expired
- **THEN** the console says the token is no longer valid and must be generated
  again

#### Scenario: Mismatched business manager

- **WHEN** the check fails because the token and the dataset belong to different
  business managers
- **THEN** the console says so, rather than reporting an error code

#### Scenario: Unexpected failure keeps Meta's wording

- **WHEN** the check fails for any other reason
- **THEN** the console shows the message Meta returned, unaltered

#### Scenario: Meta does not answer

- **WHEN** the check cannot reach Meta or exceeds its time limit
- **THEN** the console reports that the check did not complete, and does not
  present the credentials as rejected

### Requirement: Conversion counts cover every delivery state

The console SHALL count an account's conversions by delivery state, covering
every state a conversion can hold, not only the states that exist before
conversions are ever delivered.

States with no conversions in them SHALL be omitted, except that the count of
conversions waiting to be delivered and the count that could not be reported for
want of a dataset SHALL always be shown, including when both are zero. A
delivery failure SHALL therefore become visible in the console the first time
one occurs, without any further change to the console.

#### Scenario: Waiting and unreportable are always shown

- **WHEN** an operator views an account with no conversions in any state
- **THEN** the waiting count and the unreportable count are both shown as zero

#### Scenario: A failure surfaces on its own

- **WHEN** an account's first conversion ends in a delivery failure
- **THEN** the console shows a count of failed conversions for that account

### Requirement: An account's recent conversions are inspectable

The account page SHALL list that account's most recent conversions, bounded to a
fixed recent window rather than the full history, and SHALL let the operator
narrow the list to one delivery state.

Each entry SHALL show the contact's name, the delivery state, when the
conversion was recorded, how many delivery attempts have been made, and the last
delivery error if there is one. A long error SHALL be shortened for display.

A contact with no name SHALL be shown as an unnamed contact. The contact's
phone number SHALL NOT be shown, and neither SHALL the ad click identifier:
neither changes any decision the operator can make, and for a clinic both are
personal data about a patient.

Entries SHALL NOT link into the client's own pipeline. An operator holds no
membership in the account, so such a link leads nowhere.

#### Scenario: Operator reads an account's conversions

- **WHEN** an operator opens an account that has recorded conversions
- **THEN** the most recent ones are listed with contact name, delivery state,
  recording time, attempts and last error

#### Scenario: Narrowing to one state

- **WHEN** an operator narrows the list to a single delivery state
- **THEN** only conversions in that state remain listed

#### Scenario: Unnamed contact

- **WHEN** a listed conversion belongs to a contact with no name
- **THEN** the entry identifies it as an unnamed contact and shows no phone
  number

#### Scenario: Personal data stays out of the list

- **WHEN** an operator views any conversion entry
- **THEN** it contains neither the contact's phone number nor the ad click
  identifier

### Requirement: The account page separates what the system knows from what it cannot

The account page SHALL present, as derived state, every setup condition the
system can determine for itself: whether the number is connected, whether the
dataset identifier and token are both present, whether a test event code is
set, whether any contact has arrived from an ad, and whether any conversion has
been recorded.

The setup conditions the system cannot determine — that the dataset is shared
with the client's ad account, that the campaign is live with its performance
goal matching the configured event name, and that the credentials were delivered
to the client — SHALL appear as stated reminders, never as state the console
claims to know.

The console SHALL NOT offer to record an operator's assertion that a condition
it cannot verify has been met.

#### Scenario: Derived conditions are shown as state

- **WHEN** an operator opens an account whose number is connected and whose
  dataset and token are both set
- **THEN** both conditions are shown as satisfied without the operator asserting
  anything

#### Scenario: Unverifiable conditions are shown as reminders

- **WHEN** an operator opens any account
- **THEN** the conditions the system cannot check are shown as reminders, with
  no control that would mark them done

### Requirement: The console names the conversion mark as what records a conversion

Wherever the console describes how to confirm that an account reports
conversions, it SHALL name the operator's mark on the deal's card as the action
that records one.

It SHALL NOT tell the reader to qualify a deal: qualification is the clinic's
sales outcome and records nothing.

#### Scenario: Setup procedure names the mark

- **WHEN** an operator reads the setup procedure on an account page
- **THEN** its validation step instructs marking a lead's card, not qualifying
  the deal

### Requirement: Provisioning accepts the advertising fields that have no risk of being forgotten

The provisioning form SHALL accept, alongside the dataset identifier and access
token, the Page identifier and the conversion event name, so that an account can
be provisioned fully configured. Both SHALL remain optional, and the event name
SHALL be validated exactly as the edit surface validates it, rejecting the same
values.

The provisioning form SHALL NOT offer the test event code. A test event code is
meant to be cleared once validation is done, and an account left in test mode
reports nothing while appearing fully configured; it belongs only where an
operator is actively validating.

#### Scenario: Account provisioned fully configured

- **WHEN** an operator provisions an account supplying dataset identifier,
  token, Page identifier and event name
- **THEN** the account is created with all four in place and no follow-up edit
  is needed

#### Scenario: Fields remain optional

- **WHEN** an operator provisions an account leaving the Page identifier and the
  event name empty
- **THEN** provisioning succeeds and the account carries the default event name

#### Scenario: Same event name is rejected in both places

- **WHEN** an operator submits an event name that the edit surface would reject
- **THEN** provisioning refuses it too, and no account is created

#### Scenario: No test event code at provisioning

- **WHEN** an operator views the provisioning form
- **THEN** it offers no test event code field
