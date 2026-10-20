# Approvals still needed: legal, tax and engineering

Every sign-off a professional (or you) still has to give before or during
the pilots: what it is, why it matters, who gives it, and where the app
records it. The app organises these; it never replaces them. Statutory items
on a job's compliance checklist can't be overridden.

Sources: [../research/uk-consumer-legal.md](../research/uk-consumer-legal.md),
[../research/commissioning-standards.md](../research/commissioning-standards.md),
[../research/README.md](../research/README.md) (the 22 open questions) and
[../pilot-build-plan.md](../pilot-build-plan.md) §6 and §10. The research had
almost no live web access: treat every legal and technical summary as a
working note for the professional to confirm, not advice.

## Before the first survey

| # | What | Why | Who | In the app |
| --- | --- | --- | --- | --- |
| 1 | **Insurance**: public liability, contractors' all-risk, and employer's liability if you employ anyone | Drilling into people's homes; employer's liability is a legal requirement for employers | Insurance broker | **Settings → Company**: insurer, policy, expiry |
| 2 | **Data protection fee** to the ICO | Most businesses holding customer data must pay it (check whether you're exempt at ico.org.uk) | You | Not tracked |
| 3 | **Company and complaints details** for the pre-contract information | Consumer Contracts Regulations Schedule 2: every customer must get them before agreeing | You | **Settings → Company** (proposals can't issue without them) |
| 4 | **Asbestos awareness** for whoever surveys or drills older homes | Pre-2000 homes; suspected asbestos is stop-work | Training provider | **Staff** → qualification "Asbestos awareness"; survey asks about it |

## Before the first proposal

| # | What | Why | Who | In the app |
| --- | --- | --- | --- | --- |
| 5 | **Terms and conditions** | They're the contract; draft `pilot-draft-2` hasn't been reviewed (it no longer caps our liability at the price paid: solicitor question 14; and a change over £42 has its own right to cancel) | Solicitor | **Settings → Legal** → "A solicitor has reviewed the terms" (amber on `/ops/launch` until ticked); set **Terms version** to `pilot-draft-2` if you saved settings before this change |
| 6 | **Cancellation wording and model form** | The model text in the app was reconstructed, not copied from the official PDF. Getting it wrong extends the cancellation period to 12 months | Solicitor | **Settings → Legal** → "…reviewed the cancellation wording" |
| 7a | **Variations agreed in the home**: is a priced change raised by the crew on site and agreed on the family's phone a new off-premises contract with its own 14 days? Is one that includes parts a sales contract (period from delivery)? | Until answered, the app treats a change over £42 as one: the cancellation information and form go with it, and the work waits for the family's written request or the end of the 14 days. If it is one and the information is missing, the period extends by up to 12 months and the family pays nothing for work done inside it (regs 31, 36(6)) | Solicitor | Solicitor question 13 in `docs/research/uk-consumer-legal.md`; the project's **Issues** → the change → **Record their written request** |
| 7 | **Which contract type** the pilot journey is (survey in the home, acceptance online: "off-premises" or "distance") and whether supply-and-install is a **sales contract** (cancellation runs from delivery of the goods, as the app assumes) | Decides when the 14 days start and end | Solicitor | Shown on each booking: "Legal review required" |
| 8 | **Early start**: is a request made on our web page and confirmed by our email enough, or must it come from the customer's own email (as the app currently requires)? And how a cancellation after installation is handled (collection, refund less a fair charge) | Starting inside the cancellation period without a proper request risks doing the work for nothing | Solicitor; the collection policy is your decision | Booking page: early-start evidence |
| 9 | **Pilot price wording**: no "was £X" for a new business; "Pilot price £Y" | Unfair commercial practices rules (DMCC Act 2024) | Solicitor | Proposals show "Pilot price" and the discount off the real list price |
| 10 | **Complaints and ADR wording** since 6 April 2026, and whether to join an ADR scheme | DMCC changes to what a complaint outcome must say | Solicitor | **Settings → Company** → Complaints process, Dispute resolution (ADR) |
| 11 | **VAT position**: register or not; whether air-to-air heat pumps qualify for 0% (energy-saving materials) before 1 April 2027 and 5% after; jobs that straddle that date; the £90,000 threshold | The app defaults to "not registered: no VAT line". Wrong VAT is your cost | Accountant (consider an HMRC clearance) | **Settings → Tax and VAT** → "Accountant has confirmed this" |
| 12 | **Each design** signed off | Capacity, outdoor unit, pipe runs and electrics checked by a qualified person before a price is fixed. For R32 over 1.84 kg in one system, every room it serves must meet the minimum floor area in the model's installation manual (the app checks the IEC 60335-2-40 formula; the manual's table decides and can be stricter) | Technical lead (F-gas) | Design → **Approve and sign**; the check "Room size for the R32 charge" |
| 13 | **Planning (permitted development)** for each outdoor unit: noise at the neighbour's assessment position under MCS 020(a) (the 42 dB(A) limit includes an assumed 40 dB(A) background, so the heat pump's own level must be 37.0 dB(A) or less: confirm against the current issue), size, position, listed or conservation area, Article 4; not used only for cooling | Whether air-to-air units fall under the heat-pump rules (Class G) is an inference, not stated in law. Most outdoor units have no sound-power figure in the catalogue yet. The design's noise check is an estimate with no barrier credit; the full MCS 020(a) calculation is the technical lead's | Technical lead; a planning consultant or the council for anything marked CHECK | Design checks; compliance items "Permitted development", "Noise at the nearest neighbour" |
| 14 | **Multi-split combinations** checked against the manufacturer's official table | The researched rules were partly derived, not official | Technical lead, from the manufacturer | **Catalogue → Compatibility rules** → mark verified |
| 15 | **No finance offers** unless an FCA-authorised lender or broker is in place | Showing finance examples is a regulated financial promotion | Solicitor, if you want finance | **Settings → Finance** stays off |

## Before the first install

| # | What | Why | Who | In the app |
| --- | --- | --- | --- | --- |
| 16 | **Company F-gas certificate** (REFCOM or another approved body) | A business installing refrigerant equipment must hold one, as well as its engineers. If Dang It's Hot Ltd doesn't, the work has to be done under a company that does: that decides who contracts with the family and whose certificate is in the handover pack | Certification body | **Settings → Company** → F-gas certificate; checklist item "Company F-gas certificate current" (statutory, blocks booking) |
| 17 | **F-gas Category I** for every engineer who handles refrigerant | Legal requirement | Each engineer's certification body | **Staff** → qualification, evidence, ticked as checked. Refrigerant steps and commissioning stay locked without it |
| 18 | **Part P**: the electrician is registered with a competent person scheme (for example NICEIC or NAPIT) | A new circuit in a home is notifiable building work. Without a scheme member, a building notice must go to the council before work starts | The electrician's scheme | **Staff** → "Part P competent person scheme". No booking can be confirmed without it |
| 19 | **Building Regulations for the heat pump itself**: which competent person scheme covers the installation, or a building notice before work starts | The installation is likely notifiable in its own right; the compliance certificate must reach the family within 30 days, operating information within 5 days, and building control must be notified within 30 days | Building control or your scheme | Checklist; handover pack |
| 20 | **Manufacturer accreditation and warranty terms in writing** for each brand you fit (Panasonic PRO Club, Daikin Certified Installer and Stand By Me, Mitsubishi Accredited Installer) | Extended warranties usually need an accredited installer and registration within a deadline (Daikin: 90 days). No warranty years are shown anywhere until you set them | Manufacturer or distributor | **Settings → Warranty**; each item's warranty in the **Catalogue** |
| 21 | **Commissioning targets** from each model's installation manual: nitrogen test pressure (the manual's, never above the nameplate PS), the pressure hold time and any allowed fall, vacuum target (if stricter than 500 micron), the decay hold time and rise limit, flare torque per pipe size, condensate fall | None was verified in the research. The pressure and vacuum tests are judged from their readings meanwhile against the company's defaults (no fall beyond the gauge's resolution after temperature correction; 500 micron), but the hold times and the rise limit have no default, and commissioning can't be signed until every target is set or confirmed | Technical lead | Field app → **Commission** tab → **Set target** |
| 22 | **RAMS and working at height** for each job (towers, ladders; PASMA or IPAF where needed) | Health and safety duties | Technical lead / you | Checklist items "Risk assessment and method statement", "Working at height plan"; crew acknowledge RAMS in the job pack |
| 23 | **Asbestos survey** where it's suspected | Never drill suspected asbestos | Licensed asbestos surveyor | Raised as a safety issue; checklist item "Asbestos check where we drill" |
| 24 | **Authority to contract**: the person signing owns the home, or has the owner's (landlord's) permission | A tenant can't agree to holes in someone else's wall | You, at the survey | Survey: "Owner, or authority to go ahead, confirmed"; checklist item |
| 25 | **Early-start request in writing** for any install inside the cancellation period | Consumer Contracts Regulations reg 36 | The family (their reply email) | Booking page: early-start evidence; dates inside the period are refused without it |

## After each install

| # | What | Why | Who | In the app |
| --- | --- | --- | --- | --- |
| 26 | **Commissioning certificate** | Readings in heating and cooling, signed by an F-gas engineer | Technical lead | **Sign as …** on the Commission tab |
| 27 | **F-gas label** filled in on the unit (factory, added and total charge) | Legal labelling | The F-gas engineer | Runsheet evidence |
| 28 | **Electrical installation certificate** (BS 7671) and the scheme's Building Regulations notification | Must reach the family within 30 days of completion | Electrician and their scheme | **Handover** box → **Electrical certificate received**; weekly team alert while overdue |
| 29 | **Manufacturer warranty registration** | Within the manufacturer's deadline (the app's default reminder: 30 days) | You | **Handover** box → **Warranty registered** |

## Ongoing

| What | Who | In the app |
| --- | --- | --- |
| Certificates and insurance renewed before they expire | You | **Staff** warns 60 days ahead; an expired certificate stops counting the next day |
| Review platform chosen; review requests to everyone, no incentives, never only to happy customers | You (solicitor for any incentivised case study wording) | **Settings → Company** → Review page link |
| UK text sender name rules and the SenderID registry | You, with Twilio | Settings → Messages |
| A paid service plan, if you ever offer one (subscription rules) | Solicitor | Not built: offers are never auto-charged |
