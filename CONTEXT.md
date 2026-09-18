# CRM Effect

A CRM for clinics whose leads arrive over WhatsApp. Effect operates it on behalf
of each clinic: Effect provisions the account, holds the ad-platform
credentials, and the clinic only ever sees its own pipeline and inbox.

## Language

### Core

**Account**:
One clinic's tenant. Everything else is scoped to it.
_Avoid_: Client, tenant, workspace, organization

**Contact**:
A person the clinic talks to, identified by their WhatsApp number.
_Avoid_: Lead, customer, patient

**Deal**:
A contact's progress towards becoming a patient. Carries the status that says
whether the clinic still considers it live: `open`, `qualified` or `lost`.
_Avoid_: Opportunity, card, ticket

**Qualification**:
The transition of a Deal's status to `qualified`. A moment in time, not a place
in the pipeline — a Deal can sit in any stage when it happens. Says nothing
about Meta: it is the clinic's sales outcome, and since migration 049 it
reports nothing.
_Avoid_: Won, closed, converted

**Conversion mark**:
An operator's explicit decision, taken on the Deal's board card, that this lead
is worth reporting to Meta (`deals.meta_qualified_at`). Independent of the
Deal's status: a qualified Deal can be unmarked and a lost one marked. Setting
it records a Conversion, clearing it cancels one that has not been sent.
_Avoid_: Qualified, won, conversion flag

### Ad attribution

**CTWA ad**:
A Meta ad whose call to action opens a WhatsApp conversation with the clinic.
_Avoid_: Click-to-chat, WhatsApp ad, lead ad

**Click**:
One person's single tap on a CTWA ad, identified by the `ctwa_clid` Meta issues
for it. Meta only accepts it as an attribution key for seven days.
_Avoid_: Referral, attribution token, click id

**Creative**:
The specific ad a Click came from, identified by `sourceID` in the inbound
message. Kept for diagnosis; never sent back to Meta.
_Avoid_: Ad, source, campaign

**Dataset**:
The Meta destination that conversion events are posted to. The same underlying
object is called a Pixel when it serves a website; an account's Dataset may well
be one. Say Dataset regardless, because what this product posts are
business-messaging conversions, not page views.
_Avoid_: Pixel, event source, data source

**WABA**:
A WhatsApp Business Account: the asset Meta creates when a number is onboarded
to the official WhatsApp Business Platform. The clinics here are not onboarded,
so they have none.
_Avoid_: WhatsApp account, business account

**Conversion**:
The report sent to Meta saying a Click eventually earned a Conversion mark, so
the ad set can learn from it.
_Avoid_: Event, signal, postback

**Organic contact**:
A Contact with no Click: they reached the clinic on their own, not through a
CTWA ad. Marking one produces no Conversion, because there is no ad to credit —
which is why their cards carry no Conversion mark control at all.
_Avoid_: Direct, inbound, unattributed

**Unreported conversion**:
A Conversion mark that had a Click but could not be reported, because the
Account has no Dataset configured. Counted, never retried later — the Click is stale by
the time anyone configures it.
_Avoid_: Failed, pending, missed
