# UK consumer and trading law: content inputs for domestic install contracts (England)

> **NEEDS SOLICITOR REVIEW. This is not legal advice.** It is research input for the software,
> prepared 18 October 2026 for the Dang, It's Hot pilot installs. Anything the app shows customers
> (terms, cancellation wording, consent wording, finance wording) stays marked "needs legal review"
> until a solicitor signs it off. VAT points need an accountant.

Machine-readable copy of the cancellation text:
[`data/cancellation-text.json`](data/cancellation-text.json).

## Read this first: what this research could and could not reach

- **Web search:** this workflow's shared search budget (200 calls) had already run out when this
  task started. The first search returned "budget used up".
- **WebFetch:** every host failed DNS: legislation.gov.uk, eur-lex.europa.eu, ico.org.uk and
  businesscompanion.info. The shell proxy also refused gov.uk, assets.publishing.service.gov.uk,
  ico.org.uk, the FCA Handbook and the Planning Portal. **No regulator guidance (gov.uk, HMRC, ICO,
  CMA, FCA) was opened directly.**
- **What did work:** GitHub. The legislation itself was read from
  [`legalize-dev/legalize-uk`](https://github.com/legalize-dev/legalize-uk). It describes itself as
  "Legislation from the United Kingdom in Markdown… Source: legislation.gov.uk, OGL v3.0", and it holds
  the revised (consolidated) text with legislation.gov.uk's own amendment footnotes. Each file has a
  `last_updated` date, listed under Sources. Quotes below come from that mirror and give the
  canonical legislation.gov.uk URL. Treat them as official text one step removed. Before go-live,
  re-check the canonical page for amendments made after the snapshot date.
- **Known gaps in the mirror:**
  1. Consumer Contracts Regulations 2013 **Schedule 3** (the model instructions and model form) is
     published only as images, and the mirror drops them. The text in the JSON file is a
     reconstruction (see §1.10).
  2. The consolidated GPDO text in the mirror still shows the **old** Class G condition G.3(a). The
     amending order SI 2025/560 was read directly and takes precedence (see §7).
  3. Building Regulations 2010 Schedule 1 (the Part L and Part P requirement wording) and the
     current England version of column 2 of Schedule 3 (which schemes may self-certify) are missing.
- Secondary findings come from search-engine extracts that the orchestrator gathered earlier today
  (`web_main` research log). Each one is cited by the URL of the page that was extracted. Nobody
  opened those pages.
- **An adversarial fact-check was run on 18 Oct 2026.** It found and fixed two errors that matter
  for the app:
  1. concealed-incentive reviews are not a criminal offence;
  2. the 2015 ADR Regulations were revoked on 6 April 2026 and replaced by DMCC s308.

  Items it changed are marked "Confidence: provisional" with a "fact-check:" note. See
  [Fact-check log](#fact-check-log-adversarial-pass-18-oct-2026).

### Evidence grades used below

| Grade | Meaning |
|---|---|
| **L** | Legislation text, read verbatim from the legislation.gov.uk mirror (revised version). |
| **L-recon** | Legislation text that could not be read and was rebuilt. Cross-checked, but **verify against the official PDF**. |
| **S** | Secondary source (trade blog, accountant, council), read through a search-engine extract. |
| **G-unread** | Regulator guidance known to exist (CMA, ICO, HMRC, FCA) but **not retrieved**. Anything attributed to it is from memory and must be checked. It never supplies a number here. |

---

## What the app must do (checklist)

Each item cites the section below that justifies it. "Solicitor", "Accountant" and "Building
control" mark items a professional must confirm before the first live contract.

### A. Contract type and channel (set on every proposal)

- [ ] **Record the contract type:** `supply-and-install` (we supply the units: a **sales
      contract** under CCR reg 5, because it "has both goods and services as its object"),
      `install-only` (the customer supplies the kit: a **service contract**), or
      `service-visit`. The cancellation clock and the early-start wording depend on it. §1.2.
      *Solicitor*
- [ ] **Treat every pilot contract as off-premises for compliance purposes.** The survey happens
      in the home and acceptance follows online. Off-premises is the stricter regime and the one
      with the criminal offence, and meeting it also meets the distance-contract rules. §1.1.
      *Solicitor to confirm the classification*
- [ ] Before issuing the documents, **capture and timestamp the customer's agreement to receive
      contract documents by email.** Without it the information must be on paper (reg 10(2)).
      §1.4

### B. Before the customer is bound (proposal issue)

- [ ] **Send the full Schedule 2 information, the filled-in model cancellation instructions
      (Part A) and the model cancellation form (Part B) as a PDF attached to an email, before
      acceptance.** The proposal web page can carry them too. The emailed PDF is the durable
      medium (reg 5, 10). §1.3, §1.4, §1.8
- [ ] **Block proposal issue** if any required Schedule 2 field is empty: trading name,
      geographical address, phone, email, total price inclusive of taxes, payment/delivery/
      performance arrangements and dates, complaints policy, cancellation conditions, the
      reasonable-costs-if-early-start notice, the goods-conformity reminder, guarantees and
      after-sales service, deposits, and ADR where it applies. §1.3 has the full list with app
      sources.
- [ ] **Show the total price inclusive of all unavoidable charges.** That includes any mandatory
      survey fee, electrical upgrade or access equipment. If a part cannot be calculated in
      advance, say how it will be calculated, as prominently as the price (DMCC s230(2)(b)–(c),
      (4)–(5); CCR Sch 2(f)–(g)). §3
- [ ] **No pre-ticked add-ons.** Every optional paid extra (extended workmanship cover, service
      plan, condensate pump upgrade) needs an active opt-in before the customer is bound (reg 40).
      §1.9
- [ ] **Label the accept button** "order with obligation to pay" or something equally
      unambiguous. Immediately above the button, show the main characteristics, total price,
      extra charges, duration and minimum obligations. Make the customer explicitly
      acknowledge the obligation to pay (reg 14). Otherwise **the customer is not bound**
      (reg 14(5)). "I accept and agree to pay £X" is probably unambiguous. §1.4 *Solicitor*

### C. Acceptance, confirmation, early start

- [ ] **Store an immutable acceptance record:** proposal version, document hash, the
      Schedule 2/3 text versions shown, the timestamp, the name typed, the email-delivery consent
      and the IP/UA. The trader carries the burden of proof on reg 10–16 compliance (reg 17). §1.9
- [ ] **Send the confirmation or a copy of the signed contract** on a durable medium within a
      reasonable time, and in any case **before installation starts and no later than delivery of
      the kit** (reg 12(4)). Readiness gate: `confirmationSentAt` must be set before
      `ready-to-install`. §1.4
- [ ] **Early-start request** (reg 36(1)): the customer must make an **express request**, and
      for off-premises contracts make it **on a durable medium**. A tick box on our web page
      alone is weak evidence that *the customer* made the request on a durable medium. Capture
      it as an **email from the customer** (a prefilled mailto or a reply to the confirmation
      email), store the inbound message, or use a signed paper/PDF form. Record
      `{requestedAt, channel, evidenceRef, wordingVersion}`. §1.7 *Solicitor*
- [ ] **For `supply-and-install`, collect the early-start request on effectively every job.** The
      cancellation period for a sales contract only ends 14 days after the customer takes
      physical possession of the (last) goods (reg 30(3)–(4)). Installing on delivery day is
      therefore always "inside the cancellation period". Without the request the trader must not
      begin the service (reg 36(1)). If the customer cancels, they pay nothing for the
      installation (reg 36(6)(b)). §1.5, §1.7
- [ ] **Show the loss-of-right acknowledgement only on `install-only` or `service-visit`
      contracts.** Reg 36(2) removes the right to cancel only for a *service contract* fully
      performed after the request. A supply-and-install (sales) contract keeps the right after
      installation, so telling the customer otherwise would be misleading. §1.7 *Solicitor*
- [ ] **Compute `cancellationEndsOn` per contract type.**
  - `install-only` / `service-visit`: end of the 14th day after the contract date (reg 30(2)).
  - `supply-and-install`: `null` until the customer (or someone they nominate, not the carrier)
    takes physical possession of the **last** item. Then it is the end of the 14th day after
    that day (reg 30(3)–(4)). Record `goodsInCustomerPossessionAt` per delivery.
  - If the reg 10/13 cancellation information was not given: the period ends 14 days after the
    information is later given (if within 12 months), otherwise 12 months after the normal end
    (reg 31).
  - The current design (`acceptance date + 14 days` for everything) is wrong for
    supply-and-install contracts. §1.5

### D. Cancellation flow (portal, email and phone)

- [ ] Accept cancellation by **any clear statement** (email, letter, phone note, portal). Do not
      insist on the form (reg 32(3)). The deadline is met if the customer **sends** the
      communication before the period ends (reg 32(5)).
- [ ] If the portal offers an online cancel form, **send an acknowledgement on a durable medium
      without delay** (reg 32(4)(b)) and use the extra sentence from Schedule 3 note [3].
- [ ] Compute the refund **due-by date**:
  - Trader collects the goods: 14 days after being told of the cancellation (reg 34(6)).
  - Trader does not collect: 14 days after the goods come back or proof of return arrives,
    whichever is earlier (reg 34(5)).
  - Refund by the same payment method, with no fee (reg 34(7)–(8)).
- [ ] **Proportionate charge calculator** (only if a valid early-start request exists *and*
      Schedule 2(l) and (n) information was given; otherwise £0 per reg 36(6)): the value of the
      service supplied up to the moment of cancellation, in proportion to the full contract,
      based on the agreed total price (or market value if that price is excessive) (reg
      36(4)–(5)).
- [ ] **Goods deduction:** only for diminished value caused by the *customer's* handling beyond
      what is needed to establish the goods' nature, characteristics and functioning. It is
      allowed only if the cancellation information was given (reg 34(9)–(12)). Installation by
      us is not the customer's handling. §1.6 *Solicitor*
- [ ] Decide and configure **who collects removed units and who pays** (Schedule 3 notes [4] and
      [5]). Recommended default: "We will collect the goods" and "We will bear the cost of
      returning the goods", because units fixed to a wall "cannot normally be returned by post".
      §1.10 *Business decision plus Solicitor*
- [ ] Cancelling the main contract **automatically ends ancillary contracts**, such as a linked
      finance agreement or service plan. The trader must tell the other trader (reg 38). §1.6

### E. Pricing and marketing claims

- [ ] **Reference prices** ("was £X", strike-through, "save 30%"): show one only if the higher
      price is genuine. Ordinarily that means the trader really sold, or seriously offered, at
      that price for a meaningful period, recently. A brand-new trader with no sales history at
      list price should **not** show "was £X". Use "Pilot price £Y" with no comparison, or a
      future-price claim only if the trader will genuinely charge the stated price afterwards
      and records the switch date. Store the evidence (price history) for any comparison shown.
      §3 *Solicitor; CMA guidance not retrieved*
- [ ] **Pilot discounts given in return for reviews, photos or case studies must be disclosed**
      on every review or testimonial they produce. Publishing an incentivised review that
      conceals the incentive is a banned practice (DMCC Sch 20 para 13), enforceable by the CMA
      and Trading Standards. It is **not** a criminal offence: s237(8)(b) excludes para 13 from
      the s237(7) offence. Do not publish only the positive reviews (same paragraph). §3
      **Confidence: provisional.** *fact-check (18 Oct 2026): the earlier text said "and a
      criminal offence". Refuted by DMCC s237(8)(a)–(c), which exclude Sch 20 paras 12, 13 and 30
      from the offence (re-read in the legalize-uk mirror, ukpga-2024-13.md, last_updated
      2026-04-06; canonical https://www.legislation.gov.uk/ukpga/2024/13/section/237). §3 already
      said this correctly.*
- [ ] **No false urgency** ("offer ends tonight") unless it is true (Sch 20 para 7). §3
- [ ] Show "**free**" only if the customer pays nothing beyond unavoidable response costs (Sch 20
      para 23). §3
- [ ] Show a scheme badge, trust mark, "approved"/"accredited" claim, or
      manufacturer-installer status only if it is held and current. Drive it from settings with
      an expiry date (Sch 20 paras 1–4). §3
- [ ] Respect "leave/don't come back" requests at the door (Sch 20 para 27). Avoid persistent,
      unwanted contact (para 28). §3

### F. Finance

- [ ] **Keep finance promotions off** (monthly price, APR, representative example, "spread the
      cost") until settings record that the trader is FCA-authorised for credit broking, is an
      appointed representative of an authorised firm, or has a promotion approved by an
      authorised person with s55NA approver permission. Store the firm reference numbers and the
      approval reference for each promotion. Breach is a criminal offence (FSMA s21, s25). §5
      *Solicitor / lender*
- [ ] If finance is ever offered: cancelling the install contract ends the linked credit
      agreement (CCR reg 38 ancillary contracts). Notify the lender. §1.6

### G. Messages and consent

- [ ] **Keep two separate flags:** operational/service messages (contract basis) and marketing
      (consent or soft opt-in). Consent is per channel: email, SMS, phone. §4
- [ ] **Operational templates must carry no promotional content.** A survey reminder or install
      update that also advertises a service plan becomes direct marketing. §4 *ICO guidance not
      retrieved*
- [ ] **Soft opt-in** (email/SMS marketing without consent) only when all four hold:
  - the contact details were obtained during a sale or negotiations for a sale;
  - the marketing is for our own similar products and services;
  - a simple, free opt-out was offered when the details were collected (an *unticked* opt-out
    box or equivalent);
  - an opt-out is in every message (PECR reg 22(3)).

  Record `softOptInBasis` (source event and date) and `optOutOfferedAtCollection: true` with the
  wording version.
- [ ] **Consent record** (UK GDPR Art 7(1): the controller must be able to *demonstrate*
      consent): who, when, which channel(s), the exact wording and version shown, how it was given
      (an unticked box they ticked), where it was given (page or form id), and withdrawal time and
      method. Withdrawal must be as easy as giving consent (Art 7(3)). §4
- [ ] **Every marketing email/SMS:** identify the sender; give a valid opt-out address; for SMS,
      a free (or standard-rate) STOP route (PECR reg 22(3)(c), 23). Process an opt-out
      immediately and keep a suppression list (UK GDPR Art 21(3)). §4
- [ ] **Marketing calls:** present the caller line identity (CLI) (PECR reg 21(A1)). Screen
      numbers against the TPS before any unsolicited marketing call (reg 21(1)(b)). §4

### H. Building regulations and handover documents

- [ ] Staff and subcontractor records: **competent-person scheme registration** for:
  1. the electrical work (new circuit = notifiable, Building Regs reg 12(6A)); and
  2. the heat pump / air-conditioning installation itself (Schedule 3 type "air conditioning
     or ventilation system in a dwelling" and "system to produce… heat or cooling by
     microgeneration").

  If nobody on the job holds the relevant registration, **block** `booking` with "building
  notice needed" (a building notice to the council or a third-party certifier before work
  starts). §6 *Building control to confirm*
- [ ] **Handover pack checklist (blocks `closed`):**
  1. the competent-person **compliance certificate**, to the occupier **within 30 days** of
     completion (reg 20(3)(a)), with the statutory "evidence (but not conclusive evidence)"
     wording (reg 20(5)–(6));
  2. the electrical installation certificate (BS 7671);
  3. **information on operating and maintaining the system efficiently, within 5 days** of
     completion (reg 40(2));
  4. confirmation that the scheme or installer gave the **commissioning notice** to building
     control within 30 days (reg 44(3)–(4));
  5. the manufacturer manual, warranty terms and the registration deadline;
  6. commissioning results.

  Track each with a due date. §6

### I. Planning

- [ ] **Never output "no planning needed".** Output "permitted development checks passed:
      technical lead to confirm" or "planning route needed". §7
- [ ] **PD checks (England, Class G of Part 14, in force from 29 May 2025):**
  - [ ] the property is a dwellinghouse or a block of flats. A flat in a mixed-use building is
        **not** covered.
  - [ ] unit count: max 1 (non-detached house or block of flats) or 2 (detached house);
  - [ ] outdoor compressor unit volume, housing included: ≤ 1.5 m³ (house) or ≤ 0.6 m³ (block of
        flats);
  - [ ] not on a pitched roof; not within 1 m of a flat roof's edge;
  - [ ] not listed and not a scheduled monument;
  - [ ] conservation area or World Heritage Site: not on a wall/roof fronting a highway, and not
        nearer to a bounding highway than the house;
  - [ ] elsewhere: not on a highway-facing wall above ground-floor storey level;
  - [ ] no wind turbine on the property;
  - [ ] **MCS 020(a) noise calculation passes** (no "equivalent standard" since 29 May 2026);
  - [ ] Article 4 direction checked;
  - [ ] **system not used solely for cooling** (G.3(aa)).
- [ ] Record these conditions and give them to the customer: sited to minimise effect on
      appearance and amenity; **removed when no longer needed**; not used solely for cooling.
      Show heating mode at handover. §7

### J. VAT

- [ ] Settings: `vatRegistered`. If false, there is **no VAT line**, the price is the price, and
      the quote does not say "inc. VAT". Input VAT on kit is a cost. §8
- [ ] If registered, the tax code per proposal depends on the supply date (tax point):
  - **0%** for qualifying supply-and-install of an energy-saving material (an air source heat
    pump) in residential accommodation, for supplies made **before 1 April 2027**;
  - **5%** from **1 April 2027**;
  - 20% for supply-only, repairs and servicing, and cooling-only or portable units.

  Flag proposals whose install or payment dates straddle 1 April 2027. §8 *Accountant*
- [ ] Track rolling 12-month taxable turnover (zero-rated sales count) against the **£90,000**
      registration threshold. Also check the next-30-days forward look. §8

---

## 1. Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013 (SI 2013/3134)

Canonical: https://www.legislation.gov.uk/uksi/2013/3134. Grade **L** unless marked.

### 1.1 Which regime: on-premises, off-premises or distance?

Reg 5 (grade L):

> "*distance contract*" means a contract concluded between a trader and a consumer under an
> organised distance sales or service-provision scheme without the simultaneous physical presence
> of the trader and the consumer, with the exclusive use of one or more means of distance
> communication up to and including the time at which the contract is concluded;

> "*off-premises contract*" means a contract between a trader and a consumer which is any of
> these— a contract concluded in the simultaneous physical presence of the trader and the
> consumer, in a place which is not the business premises of the trader; a contract for which an
> offer was made by the consumer in the simultaneous physical presence of the trader and the
> consumer, in a place which is not the business premises of the trader; a contract concluded on
> the business premises of the trader or through any means of distance communication immediately
> after the consumer was personally and individually addressed in a place which is not the
> business premises of the trader in the simultaneous physical presence of the trader and the
> consumer; …

How this maps onto our journey (our reading, *Solicitor*):

- **Accepted in the home during the survey**, or online straight after the surveyor leaves: an
  off-premises contract.
- **Accepted online days later**: arguably a distance contract. But the home visit means the
  contract was not made with "exclusive use" of distance communication up to conclusion, so
  classification is uncertain.
- **Recommendation:** build to the off-premises standard every time. It is the stricter regime:
  information on paper or, with the customer's agreement, another durable medium; an early-start
  request on a durable medium; and a reg 19 criminal offence for missing cancellation
  information. Meeting it also satisfies the distance-contract rules (reg 13, 14, 16).
- Parts 2 and 3 do not apply to off-premises contracts where the payment "is not more than £42"
  (reg 7(4), 27(3)). That is irrelevant to installs, but relevant to a cheap paid survey.

### 1.2 Is supply-and-install a "sales contract" or a "service contract"? (important)

Reg 5 (grade L):

> "*sales contract*" means a contract under which a trader transfers or agrees to transfer the
> ownership of goods to a consumer and the consumer pays or agrees to pay the price, **including
> any contract that has both goods and services as its object**;

> "*service contract*" means a contract, other than a sales contract, under which a trader
> supplies or agrees to supply a service to a consumer and the consumer pays or agrees to pay the
> price.

> "*goods*" means any tangible moveable items …

On the plain wording, where **we supply the units and install them**, the contract is a **sales
contract**, not a service contract. Consequences:

1. The cancellation period runs from **physical possession of the goods**, not from the contract
   date (reg 30(3)–(4)). See §1.5.
2. Reg 36(2) (loss of the right to cancel once the service is fully performed) applies only to a
   "service contract". So **the customer can still cancel a supply-and-install contract after
   installation**, within 14 days of taking possession of the goods.
3. What the trader can recover on such a cancellation:
   - the proportionate value of the **installation service** supplied (reg 36(4)), *if* a valid
     early-start request was made and the Schedule 2(l) and (n) information was given;
   - diminished value of the goods caused by the **customer's** handling (reg 34(9));
   - the trader likely bears the cost of removing and collecting the units (see §1.6).
4. Exclusions that probably do **not** save the trader:
   - goods "made to the consumer's specifications or … clearly personalised" (reg 28(1)(b)):
     standard catalogue units are not;
   - goods that "become mixed inseparably (according to their nature) with other items after
     delivery" (reg 28(3)(c)): split units can be removed.

   That is our reading. *Solicitor to confirm.*
5. `install-only` work (the customer bought the kit elsewhere) is a **service contract**. The
   clock runs from the contract date, and the right can be lost after full performance if the
   reg 36(2) acknowledgement was obtained.

### 1.3 Pre-contract information: Schedule 2 (distance and off-premises), verbatim, with app mapping

Reg 10(1) (off-premises): "Before the consumer is bound by an off-premises contract, the trader—
(a) must give the consumer the information listed in Schedule 2 in a clear and comprehensible
manner, and (b) if a right to cancel exists, must give the consumer a cancellation form as set out
in part B of Schedule 3." Reg 13(1) is the same for distance contracts, except it reads "give or
make available".

| Para | Schedule 2 text (grade L, verbatim) | App source / note |
|---|---|---|
| (a) | the main characteristics of the goods or services, to the extent appropriate to the medium of communication and to the goods or services; | Proposal option: units, rooms, capacities, outdoor siting, pipe route, install days. Also becomes a contract term (CRA s11(4), s50(3)). |
| (b) | the identity of the trader (such as the trader's trading name); | Settings: legal name and trading name. |
| (c) | the geographical address at which the trader is established and, where available, the trader's telephone number, fax number and e-mail address, to enable the consumer to contact the trader quickly and communicate efficiently; | Settings: address, phone, email (no PO box). |
| (d) | where the trader is acting on behalf of another trader, the geographical address and identity of that other trader; | Usually n/a. If a subcontractor contracts as principal, show it. |
| (e) | if different from the address provided in accordance with paragraph (c), the geographical address of the place of business of the trader, and, where the trader acts on behalf of another trader, the geographical address of the place of business of that other trader, where the consumer can address any complaints; | Settings: complaints address if different. |
| (f) | the total price of the goods or services inclusive of taxes, or where the nature of the goods or services is such that the price cannot reasonably be calculated in advance, the manner in which the price is to be calculated, | Proposal total (VAT per §8). |
| (g) | where applicable, all additional delivery charges and any other costs or, where those charges cannot reasonably be calculated in advance, the fact that such additional charges may be payable; | Extras, conditional items (e.g. "if the consumer unit needs replacing: £X"). Reg 10(4): if not given, the consumer does not bear them. |
| (h) | in the case of a contract of indeterminate duration or a contract containing a subscription, the total costs per billing period or (where such contracts are charged at a fixed rate) the total monthly costs; | Only for service plans. |
| (i) | the cost of using the means of distance communication for the conclusion of the contract where that cost is calculated other than at the basic rate; | n/a (web/email). |
| (j) | the arrangements for payment, delivery, performance, and the time by which the trader undertakes to deliver the goods or to perform the services; | Deposit or balance schedule; install window or dates. |
| (k) | where applicable, the trader's complaint handling policy; | Settings: complaints policy link and text. |
| (l) | where a right to cancel exists, the conditions, time limit and procedures for exercising that right in accordance with regulations 27 to 38; | Filled-in Schedule 3 Part A (deemed compliance, reg 10(3)). **Missing (l) = criminal offence (reg 19) and the 12-month extension (reg 31).** |
| (m) | where applicable, that the consumer will have to bear the cost of returning the goods in case of cancellation and, for distance contracts, if the goods, by their nature, cannot normally be returned by post, the cost of returning the goods; | From Schedule 3 note [5](b) setting. If omitted, the trader bears the cost (reg 35(5)(b)). |
| (n) | that, if the consumer exercises the right to cancel after having made a request in accordance with regulation 36(1), the consumer is to be liable to pay the trader reasonable costs in accordance with regulation 36(4); | Schedule 3 note [6] sentence. If omitted, the trader recovers nothing for early-start work (reg 36(6)(a)). |
| (o) | where under regulation 28, 36 or 37 there is no right to cancel or the right to cancel may be lost, the information that the consumer will not benefit from a right to cancel, or the circumstances under which the consumer loses the right to cancel; | Install-only/service: loss after full performance (reg 36(2)). Supply-and-install: probably nothing to state (§1.2). |
| (p) | in the case of a sales contract, a reminder that the trader is under a legal duty to supply goods that are in conformity with the contract; | Fixed sentence on supply-and-install. |
| (q) | where applicable, the existence and the conditions of after-sale customer assistance, after-sales services and commercial guarantees; | Manufacturer warranty, workmanship guarantee and service offer, all from settings and catalogue. |
| (r) | the existence of relevant codes of conduct, as defined in regulation 5(3)(b) of the Consumer Protection from Unfair Trading Regulations 2008, and how copies of them can be obtained, where applicable; | Any consumer code joined (e.g. a trade association code). The 2008 Regulations were revoked on 6 Apr 2025 (DMCC s251), but the mirror still shows this cross-reference. |
| (s) | the duration of the contract, where applicable, or, if the contract is of indeterminate duration or is to be extended automatically, the conditions for terminating the contract; | Service plans only. |
| (t) | where applicable, the minimum duration of the consumer's obligations under the contract; | Service plans only. |
| (u) | where applicable, the existence and the conditions of deposits or other financial guarantees to be paid or provided by the consumer at the request of the trader; | Deposit % and when it is due. |
| (v) | where applicable, the functionality, including applicable technical protection measures, of digital content; | Control app (if supplied). |
| (w) | where applicable, any relevant compatibility of digital content with hardware and software that the trader is aware of or can reasonably be expected to have been aware of; | Wi-Fi/app compatibility. |
| (x) | where applicable, the possibility of having recourse to an out-of-court complaint and redress mechanism, to which the trader is subject, and the methods for having access to it. | ADR scheme, if any (see §1.9: DMCC s308 since 6 Apr 2026; the 2015 ADR Regulations are revoked). |

Also note **Schedule 1** (on-premises), for completeness: a shorter list, (a)–(k).

### 1.4 How the information must be given

- **Off-premises (reg 10(2), L):** "The information and any cancellation form must be given on
  paper or, if the consumer agrees, on another durable medium and must be legible." So capture
  the customer's agreement to email delivery.
- **Model instructions deem compliance (reg 10(3), L):** information under paras (l), (m) and (n)
  "may be provided by means of the model instructions on cancellation set out in part A of
  Schedule 3; and a trader who has supplied those instructions to the consumer, correctly filled
  in, is to be treated as having complied".
- **Copy or confirmation (reg 12, L):** the trader "must give the consumer— (a) a copy of the
  signed contract, or (b) confirmation of the contract", "on paper or, if the consumer agrees, on
  another durable medium", "within a reasonable time after the conclusion of the contract, but in
  any event— (a) not later than the time of the delivery of any goods supplied under the contract,
  and (b) before performance begins of any service supplied under the contract." It must include
  all the Schedule 2 information unless that was already given on a durable medium.
- **Distance contracts made online (reg 14, L):**
  - (2) the information in paras (a), (f), (g), (h), (s) and (t) must be shown "in a clear and
    prominent manner, and directly before the consumer places the order";
  - (3) "the consumer, when placing the order, explicitly acknowledges that the order implies an
    obligation to pay";
  - (4) the button is "labelled in an easily legible manner only with the words 'order with
    obligation to pay' or a corresponding unambiguous formulation";
  - (5) "If the trader has not complied with paragraphs (3) and (4), the consumer is not bound by
    the contract or order."
- **Distance confirmation (reg 16, L):** the confirmation must be on a durable medium, "not later
  than the time of delivery of any goods … and before performance begins of any service".

### 1.5 The cancellation period (reg 29–31, L)

- Reg 29(1): "The consumer may cancel a distance or off-premises contract at any time in the
  cancellation period without giving any reason, and without incurring any liability except under
  these provisions": reg 34(3) (enhanced delivery), 34(9) (diminished value), 35(5) (return
  costs) and 36(4) (early-start services).
- Reg 29(2): "The cancellation period begins when the contract is entered into and ends in
  accordance with regulation 30 or 31."
- Reg 30(2): service contract, the period "ends at the end of 14 days after the day on which the
  contract is entered into."
- Reg 30(3): sales contract, the period "ends at the end of 14 days after the day on which the
  goods come into the physical possession of— (a) the consumer, or (b) a person, other than the
  carrier, identified by the consumer to take possession of them."
- Reg 30(4): multiple goods "ordered by the consumer in one order but some are delivered on
  different days": 14 days after "the last of the goods" arrive. Indoor and outdoor units
  delivered separately fall under this.
- Reg 31 (failure to give the para (l) information):
  - (2) if the information is given within 12 months, the period "ends at the end of 14 days after
    the consumer receives the information";
  - (3) "Otherwise the cancellation period ends at the end of 12 months after the day on which it
    would have ended under regulation 30."

Day counting: the "end of 14 days after the day" means the day of the contract (or delivery)
is day 0. A contract made on 1 October ends at 23:59 on 15 October. *Solicitor to confirm the
app's date arithmetic.*

### 1.6 Exercising the right and what happens next (reg 32–35, 38, L)

- Reg 32(3): the consumer may "(a) use a form following the model cancellation form in part B of
  Schedule 3, or (b) make any other clear statement setting out the decision to cancel the
  contract."
- Reg 32(4): if the trader offers a website form, then "(b) if the consumer does [use it], the
  trader must communicate to the consumer an acknowledgement of receipt of the cancellation on a
  durable medium without delay."
- Reg 32(5): the consumer cancels in time "if the communication is sent before the end of the
  period". Reg 32(6): in a dispute, the consumer must prove timely cancellation.
- Reg 33(1)(a): "the cancellation ends the obligations of the parties to perform the contract".
- Reg 34: refund of "all payments, other than payments for delivery" (delivery refunded up to the
  cheapest standard option).
  - "without undue delay" (34(4)). If the trader has not offered to collect, within 14 days of
    getting the goods back or proof of return (34(5)); otherwise within 14 days of being told
    (34(6)).
  - Same means of payment (34(7)); no fee (34(8)).
  - Deduction for diminished value "as a result of handling of the goods by the consumer beyond
    what is necessary to establish the nature, characteristics and functioning of the goods"
    (34(9)). Not available if the para (l) information was not given (34(11)).
- Reg 35(1): the trader must collect if "(a) the trader has offered to collect them, or (b) in
  the case of an off-premises contract, the goods were delivered to the consumer's home when the
  contract was entered into and could not, by their nature, normally be returned by post."
  - Otherwise the consumer sends them back within 14 days (35(4)), at their own direct cost
    unless the trader agreed to pay or failed to give the para (m) information (35(5)).
  - The consumer bears no collection cost unless the trader offered to collect and the consumer
    agreed to pay (35(8)).
- Reg 38: on cancellation "any ancillary contracts are automatically terminated, without any costs
  for the consumer". The trader "must inform any other trader with whom the consumer has an
  ancillary contract". That includes credit agreements (38(4)).

### 1.7 Starting work inside the cancellation period (reg 36, L, verbatim)

> (1) The trader must not begin the supply of a service before the end of the cancellation period
> provided for in regulation 30(1) unless the consumer— (a) has made an express request, and (b)
> in the case of an off-premises contract, has made the request on a durable medium.
>
> (2) In the case of a service other than supply of water, gas, electricity or district heating,
> the consumer ceases to have the right to cancel a service contract under regulation 29(1) if
> the service has been fully performed, and performance of the service began— (a) after a
> request by the consumer in accordance with paragraph (1), and (b) with the acknowledgement that
> the consumer would lose that right once the contract had been fully performed by the trader.
>
> (3) Paragraphs (4) to (6) apply where a contract is cancelled under regulation 29(1) and a
> service has been supplied in the cancellation period.
>
> (4) Where the service is supplied in response to a request in accordance with paragraph (1),
> the consumer must (subject to paragraph (6)) pay to the trader an amount— (a) for the supply
> of the service for the period for which it is supplied, ending with the time when the trader is
> informed of the consumer's decision to cancel the contract, in accordance with regulation
> 32(2), and (b) which is in proportion to what has been supplied, in comparison with the full
> coverage of the contract.
>
> (5) The amount is to be calculated— (a) on the basis of the total price agreed in the contract,
> or (b) if the total price is excessive, on the basis of the market value of the service that
> has been supplied, calculated by comparing prices for equivalent services supplied by other
> traders.
>
> (6) The consumer bears no cost for supply of the service, in full or in part, in the
> cancellation period, if— (a) the trader has failed to provide the consumer with the
> information on the right to cancel required by paragraph (l) of Schedule 2, or the information
> on payment of that cost required by paragraph (n) of that Schedule, in accordance with Part 2,
> or (b) the service is not supplied in response to a request in accordance with paragraph (1).

What this means for the app:

- (1)(a) "**express** request": this must be the customer's own positive act, never a default
  or pre-ticked box (compare reg 40(2) on pre-ticked boxes).
- (1)(b) "**has made** the request on a durable medium": the *consumer* makes it. A tick box on
  our web page and our own confirmation email may not satisfy this. The safest evidence is an
  email *from* the customer, or a signed paper/PDF request. *Solicitor.*
- (2) the loss-of-right acknowledgement matters only for **service contracts**. Do not show it on
  supply-and-install (§1.2).
- (4)–(5): the proportionate amount is pro rata to "the full coverage of the contract" at the
  agreed price. The app should store a pre-agreed split of the price by job stage, so that a
  mid-install cancellation can be valued transparently. *Solicitor: the split itself is not
  binding on the consumer if excessive (36(5)(b)).*

### 1.8 Durable medium: is email OK?

Reg 5 (L): "'*durable medium*' means **paper or email**, or any other medium that— allows
information to be addressed personally to the recipient, enables the recipient to store the
information in a way accessible for future reference for a period that is long enough for the
purposes of the information, and allows the unchanged reproduction of the information stored".

- **Email is expressly a durable medium.** Put the documents *in* the email or attach them as a
  PDF.
- A link to a web page that we can change is not obviously "unchanged reproduction". *(We recall
  CJEU case law to that effect, C-49/11 Content Services, but did not retrieve it.)* So do not
  rely on a portal link alone.
- SMS: not named. Treat as not suitable for the contract documents.

### 1.9 Consequences of getting it wrong, and other duties

| Failure | Consequence | Source (L) |
|---|---|---|
| Para (l) cancellation information not given | Period extended up to 12 months (reg 31). No deduction for diminished value (34(11)). Nothing payable for early-start services (36(6)(a)). | reg 31, 34(11), 36(6) |
| Para (m) return-cost information not given | Trader bears the direct cost of return (35(5)(b), (6)). | reg 35 |
| Para (n) costs-on-early-start information not given | Consumer pays nothing for services supplied in the period (36(6)(a)). | reg 36 |
| Paras (g), (h), (m) not given | "the consumer is not to bear the charges or costs referred to in those paragraphs" (10(4)). | reg 10(4) |
| Off-premises contract without the (l), (m) or (n) information | **Criminal offence**: "A trader is guilty of an offence if the trader enters into an off-premises contract to which regulation 10 applies but fails to give the consumer the information listed in paragraph (l), (m) or (n) of Schedule 2 in accordance with that regulation." Penalty: "a fine not exceeding level 5 on the standard scale" (19(2)). In England and Wales a £5,000-or-more summary maximum became an **unlimited fine** (LASPO 2012 s85; Sentencing Act 2020 refers to the 12 March 2015 commencement). A due diligence defence is available (reg 20). Liability extends to the person at fault, and to officers of a company (reg 21, 22). | reg 19–22; https://www.legislation.gov.uk/ukpga/2012/10/section/85 |
| Any reg 10–16 dispute | "it is for the trader to show that the provision was complied with" (17(1)). Hence the immutable acceptance and document log. | reg 17 |
| Any Part 2 duty | Each contract is "treated as including a term that the trader has complied with" regs 9–14 and 16 (reg 18), so a breach is also a breach of contract. | reg 18 |
| Online button or acknowledgement missing (distance) | Consumer not bound (14(5)). | reg 14 |
| Pre-ticked paid extra | No payment is due for it without express consent; consent is not inferred from a default option; any amount received is refundable (reg 40(1), (2), (4)). | reg 40 |
| Phone helpline above basic rate | The trader refunds the excess (reg 41). | reg 41 |

**ADR information when answering a complaint** (DMCC Act 2024 s308, L). **Confidence:
provisional.**

> (3) The trader must, when communicating the outcome of the trader's consideration of the
> complaint to the consumer, also inform the consumer about any ADR or other arrangement that is
> available if the consumer is dissatisfied with the outcome.

- "ADR or other arrangement" (s308(4)) means a scheme the trader is **obliged to take part in**
  because of legislation, the terms of the consumer contract, or other contracts the trader has
  signed, such as a trade association or competent-person scheme's dispute process.
- Enforcement is by enforcement notice under s302 (s308(5)). s308(6) keeps any other duty to give
  information.
- App rule: every complaint-outcome message carries a configured "ADR / dispute scheme" block. If
  settings record no scheme we are bound to use, the block says so and gives our complaints
  policy. Whether to join a scheme voluntarily is a business decision. *Solicitor.*
- https://www.legislation.gov.uk/ukpga/2024/13/section/308

*fact-check (18 Oct 2026): the earlier text required a "deadlock letter" under the ADR
Regulations 2015 (SI 2015/542) reg 19(2). **Refuted.** Those Regulations "are revoked" by DMCC
Sch 27 para 10. That Schedule, with Part 4 Chapter 4 (ADR for consumer contract disputes), came
into force on **6 April 2026** under the DMCC Act 2024 (Commencement No. 3 and Transitional
Provisions) Regulations 2026, SI 2026/284, reg 1(2) and 2(2)–(5)
(https://www.legislation.gov.uk/uksi/2026/284, read in the legalize-uk mirror). The mirror's
consolidated SI 2015/542 (last_updated 2025-04-06) still shows "in_force" because it was not
refreshed. The ADR (Information) Regulations 2026, SI 2026/293, place reporting duties on ADR
providers only, not on traders. Not checked: guidance on how s308 applies to a trader with no
scheme it must use (DBT/CMA guidance not retrieved).*

**Subscription contracts:** the DMCC Act 2024 inserts reg 7(4A) and 27(3A), which will take
subscription contracts out of these Regulations once DMCC Part 4 Chapter 2 starts. In the mirror
(as at 6 Apr 2026), s254 shows only "not in force at Royal Assent". If a recurring paid
**service plan** is sold, check whether the subscription regime has started. It has its own
information, reminder and cooling-off rules. (L; commencement status after 6 Apr 2026 not
checked.) *fact-check (18 Oct 2026): the reg 7(4A) and 27(3A) insertions are confirmed in the
DMCC mirror. **Commencement could not be verified.** The DMCC Commencement No. 3 Regulations
(SI 2026/284) brought in only Part 4 Chapter 4 (ADR) and Schedules 25–27 on 6 Apr 2026, not
Chapter 2. No later DMCC commencement SI appeared among the 2026 SIs in the mirror. But the
mirror holds only 353 of them, and their numbers run to at least SI 2026/1097, so this is not
evidence that none exists. Check gov.uk before
selling any recurring service plan.*

### 1.10 Model instructions (Part A) and model form (Part B)

Full text: [`data/cancellation-text.json`](data/cancellation-text.json). Grade **L-recon**.

- Schedule 3 is published on legislation.gov.uk only as **images**. The readable mirror records
  "images_dropped: 3" and shows only the heading "SCHEDULE 3 — Information about the exercise of
  the right to cancel".
- The wording was rebuilt from the Directive 2011/83/EU Annex I structure (the UK schedule
  follows it, with "cancel" for "withdraw", "clear" for "unequivocal", and its own refund-timing
  wording). It was then cross-checked against independent UK copies on GitHub:
  - [kaam `cancellation-form.ts`](https://github.com/Raj-Vaghela/kaam/blob/main/src/lib/legal/cancellation-form.ts):
    Part B word for word;
  - [malayali_anoo return policy](https://github.com/modamaan/malayali_anoo/blob/main/app/return-policy/page.tsx):
    Part A body, including the UK-only sentences "We may make a deduction from the reimbursement
    for loss in value…" and the (a)/(b)/(c) reimbursement timing.
- Unverified details:
  1. the currency label before "[insert the amount]" in note [5](b);
  2. "his fax number" against "fax number" in Part B;
  3. punctuation.
- **Check against the official PDF before go-live:**
  https://www.legislation.gov.uk/uksi/2013/3134/pdfs/uksi_20133134_en.pdf

**Draft fill for a `supply-and-install` contract** (for the solicitor to approve). Keep the
statutory sentences unchanged so the reg 10(3) deeming applies.

> **Right to cancel**
> You have the right to cancel this contract within 14 days without giving any reason.
> The cancellation period will expire after 14 days from the day on which you acquire, or a third
> party, other than the carrier and indicated by you, acquires physical possession of the last
> good. *(note [1](c), since indoor and outdoor units may arrive on different days; use (b) if
> always delivered together)*
> To exercise the right to cancel, you must inform us (Dang, It's Hot, {geographical address},
> {phone}, {email}) of your decision to cancel this contract by a clear statement (e.g. a letter
> sent by post, fax or e-mail). You may use the attached model cancellation form, but it is not
> obligatory. You can also electronically fill in and submit the model cancellation form or any
> other clear statement on our website {portal URL}. If you use this option, we will communicate
> to you an acknowledgement of receipt of such a cancellation on a durable medium (e.g. by
> e-mail) without delay. *(note [3]; only if the portal form exists)*
> To meet the cancellation deadline, it is sufficient for you to send your communication
> concerning your exercise of the right to cancel before the cancellation period has expired.
>
> **Effects of cancellation**
> *(statutory paragraphs unchanged)*
> We will collect the goods. We will bear the cost of returning the goods. You are only liable
> for any diminished value of the goods resulting from the handling other than what is necessary
> to establish the nature, characteristics and functioning of the goods. *(note [5](a), (b) and
> (c); the collect-and-pay choice is a business decision; note [4] is omitted because we collect)*
> If you requested to begin the performance of services during the cancellation period, you shall
> pay us an amount which is in proportion to what has been provided until you have communicated
> us your cancellation from this contract, in comparison with the full coverage of the contract.
> *(note [6])*

For `install-only`, use note [1](a), "of the conclusion of the contract.", and omit [4] and [5].

---

## 2. Consumer Rights Act 2015: what the terms must reflect

Canonical: https://www.legislation.gov.uk/ukpga/2015/15. Grade **L**.

**Mixed contracts.** s1(4): each Chapter "applies even if the contract also covers something
covered by another Chapter (a mixed contract)". s1(6)(a) points to s15 (goods and installation).
So supply-and-install gets **both** the goods rights (Chapter 2) and the services rights
(Chapter 4).

**Services (Chapter 4):**

- **s49(1):** "Every contract to supply a service is to be treated as including a term that the
  trader must perform the service with reasonable care and skill."
- **s50(1):** "Every contract to supply a service is to be treated as including as a term of the
  contract anything that is said or written to the consumer, by or on behalf of the trader, about
  the trader or the service, if— (a) it is taken into account by the consumer when deciding to
  enter into the contract, or (b) it is taken into account by the consumer when making any
  decision about the service after entering into the contract."
- **s50(3)–(4):** information given under CCR reg 9, 10 or 13 "is to be treated as included as a
  term of the contract". A change "is not effective unless expressly agreed".
- **Product consequence:** the proposal page, survey notes shown to the customer, marketing
  copy and the surveyor's statements ("whisper-quiet", "3-day install", "5-year warranty") all
  become **contract terms**. Generate customer-facing claims from settings and catalogue data,
  and version them with the proposal.
- **s51:** reasonable price, only where no price is fixed. **s52:** "the trader must perform the
  service within a reasonable time" if no time is fixed.
- **Remedies (s54–56):**
  - repeat performance, "within a reasonable time and without significant inconvenience to the
    consumer", with the trader bearing "any necessary costs … (including in particular the cost
    of any labour or materials)" (s55(2));
  - otherwise a price reduction, which "may, where appropriate, be the full amount of the price"
    (s56(2)), refunded "within 14 days beginning with the day on which the trader agrees that the
    consumer is entitled to a refund" (s56(4));
  - damages and other remedies are also preserved (s54(6)–(7)).
- **s57: liability that cannot be excluded:**
  - (1) no exclusion of s49 liability;
  - (2) no exclusion of s50 liability;
  - (3) no restriction "if it would prevent the consumer in an appropriate case from recovering
    the price paid";
  - (4) no term making a remedy "subject to a restrictive or onerous condition" or allowing a
    trader to "put a person at a disadvantage as a result of pursuing such a right or remedy".

**Goods (Chapter 2) on supply-and-install:**

- s9: satisfactory quality; s10: fit for a particular purpose made known (e.g. "heat the loft
  room"); s11: as described. s11(4): the CCR Schedule 2(a) "main characteristics" information
  becomes a term. s12: other CCR pre-contract information becomes a term.
- **s15(1):** goods do not conform if "(a) installation of the goods forms part of the contract,
  (b) the goods are installed by the trader or under the trader's responsibility, and (c) the
  goods are installed incorrectly." A bad install is therefore a *goods* non-conformity too.
- **s22(3)(c):** the 30-day short-term right to reject runs from when, among other things,
  "where the contract requires the trader to install the goods … the trader has notified the
  consumer that the action has been taken". The app should send a dated **"installation
  complete" notice**.
- **s19(14):** goods that do not conform "at any time within the period of six months beginning
  with the day on which the goods were delivered … must be taken not to have conformed to it on
  that day".

**Unfair terms (Part 2):**

- s62(1): "An unfair term of a consumer contract is not binding on the consumer." s62(4): a term
  is unfair "if, contrary to the requirement of good faith, it causes a significant imbalance in
  the parties' rights and obligations under the contract to the detriment of the consumer."
- s64: the price and the main subject matter are exempt from assessment only "if it is
  transparent and prominent". s68(1): written terms "must" be transparent. s69(1): ambiguity is
  read in the consumer's favour.
- **Implications for drafting:**
  - no "deposit non-refundable" clause that cuts across the cancellation rights;
  - no blanket "we are not liable for damage to walls or decor";
  - put cancellation charges, deposit terms and variation pricing prominently in plain English;
  - keep the Schedule 2 list in the contract summary, not only in small print.

---

## 3. DMCC Act 2024: unfair commercial practices, reference pricing, reviews

Canonical: https://www.legislation.gov.uk/ukpga/2024/13. Grade **L**.

**In force:** Part 4 Chapter 1 (protection from unfair trading) came into force on **6 April
2025**, except ss232, 234 and 235, the new private rights of redress (SI 2025/272 reg 2(3),
https://www.legislation.gov.uk/uksi/2025/272). The Consumer Protection from Unfair Trading
Regulations 2008 were revoked from 6 April 2025 (DMCC s251(1)). Their Part 4A consumer redress
rights continue until regulations are made under s233 (mirror footnote to SI 2008/1277).

**The general test (s225(4)):** a practice is unfair if it is likely to make the average consumer
take a transactional decision they would not otherwise have taken because of one of these:

- a misleading action (s226);
- a misleading omission (s227);
- an aggressive practice (s228);
- a contravention of professional diligence (s229).

It is also unfair if it omits material information from an invitation to purchase (s230), or is
on the Schedule 20 blacklist.

**Misleading actions (s226), verbatim:**
- (1)(a): "the provision of false or misleading information relating to a product, a trader or
  any other matter relevant to a transactional decision";
- (1)(b): "an overall presentation which is likely to deceive the average consumer";
- (2): misleading information "includes a reference to information which, although true, is
  presented in a misleading way".

**Reference pricing ("was £X", "save 30%").**
- DMCC has no specific "was price" rule. A false or misleading reference price is caught by
  s226(1)(a)/(b) as false or misleading information about the price, and is a **criminal
  offence** under s237(1) (fine, or up to 2 years on indictment, s240).
- The CMA's guidance on the DMCC unfair trading rules (CMA207) and the earlier CTSI/BEIS pricing
  practices guidance explain what makes a reference price genuine (**G-unread**: not retrieved;
  do not rely on our paraphrase). From memory, the principles are:
  1. the higher price must be one the trader genuinely charged, recently, for a reasonable
     period, and not artificially inflated before the discount;
  2. "RRP" or competitor comparisons must be real and like-for-like;
  3. future-price claims ("price goes up to £X after the pilot") must be honoured.
- **Application to the pilot plan:** the build plan says "Pilot discount always applied to the
  engine's list price for the surveyed design". A new business has never sold at that list
  price. So presenting "£X, 30% off" risks implying a genuine prior price.
  - Safer: "Pilot price: £Y. Pilots are discounted while we build our track record."
  - Or a genuine future-price statement, with the switch date recorded and honoured.
  - Store `referencePriceBasis` and evidence for every comparison shown. *Solicitor.*

**Invitation to purchase (s230(2)), material information that must not be omitted:**
- (a) main characteristics; (b) "the total price of the product"; (c) how the price is
  calculated if it cannot be calculated in advance; (d)–(f) the trader's identity, business
  address and business email;
- (g) "any freight, delivery or postal charges, including any taxes, not included in the total
  price of the product but which the consumer may choose to incur" (or the fact that they may be
  payable); (h) "for products involving a right of withdrawal or cancellation, the existence of
  such a right"; (i) arrangements for payment, delivery, performance or complaints where they
  depart from the trader's published practice; (j) "any information which the trader is required
  under any other enactment to give to a consumer as part of an invitation to purchase".
- *fact-check (18 Oct 2026): the earlier paraphrase called (g) "optional extra charges" and left
  out (j). Corrected from the s230(2) text in the mirror (ukpga-2024-13.md, 2026-04-06). Optional
  paid extras (e.g. an extended cover plan) remain subject to CCR reg 40 (no pre-ticked boxes).
  **Confidence: provisional.***
- s230(4): "the total price of a product includes any fees, taxes, charges or other payments that
  the consumer will necessarily incur". Instant quotes and "from £" prices must include
  unavoidable extras.

**Schedule 20 (always unfair) items relevant to us, verbatim:**

| Para | Text | App rule |
|---|---|---|
| 1–3 | claiming to be a code signatory when not; claiming a code endorsement it lacks; "Displaying a trust mark, quality mark or equivalent without having obtained the necessary authorisation." | Badges only from settings, with certificate and expiry. |
| 4 | "Claiming that a trader, a trader's commercial practice, or a product has been approved, endorsed or authorised by a public or private body when— (a) the claim is false, or (b) the terms of the approval … have not been, or are not being, complied with." | "Accredited installer" or manufacturer-partner claims only if current. |
| 5 | bait advertising: inviting purchase "at a specified price" without reasonable grounds to supply at that price in reasonable quantities, undisclosed. | Instant-quote prices must be deliverable. |
| 7 | "Falsely stating that a product will only be available for a limited time, or that it will only be available on particular terms for a limited time, in order to elicit an immediate decision…" | Any pilot deadline must be real. |
| 13 | "(1) Submitting, or commissioning another person to submit or write— (a) a fake consumer review, or (b) a consumer review that conceals the fact it has been incentivised. (2) Publishing consumer reviews, or consumer review information, in a misleading way. (3) Publishing consumer reviews … without taking such reasonable and proportionate steps as are necessary" to prevent fake or concealed-incentive reviews. Misleading publication "includes … failing to publish, or removing from publication, negative consumer reviews whilst publishing positive ones". "Commissioning" "includes incentivising by any means". | Pilot discount for a review or case study: **disclose it on the review**. Publish negatives too. |
| 23 | "Describing a product as 'gratis', 'free', 'without charge' or similar if the consumer has to pay anything other than the unavoidable cost of responding…" | "Free survey" only if genuinely free. |
| 27 | "Ignoring a request from a consumer to leave or not return to the consumer's home…" | Survey and doorstep conduct. |
| 28 | "Making persistent and unwanted solicitations by any means, other than by attending at the consumer's home…" | Follow-up cadence caps. |

**Offences (s237):**
- misleading actions, misleading omissions, aggressive practices and invitation-to-purchase
  omissions are strict offences;
- the professional diligence offence needs knowledge or recklessness;
- Schedule 20 practices are offences, except paras 12, 13 and 30 (s237(8));
- a due diligence defence is available (s238).

So **fake or concealed-incentive reviews (para 13) are not a criminal offence under s237, but are
still prohibited** and enforceable by the CMA and Trading Standards.

---

## 4. UK GDPR and PECR: service messages, marketing, soft opt-in, SMS, consent records

**PECR** (SI 2003/2426, as amended including by the Data (Use and Access) Act 2025). Canonical:
https://www.legislation.gov.uk/uksi/2003/2426. Grade **L**.

- **What counts as marketing (reg 2):** "'direct marketing' means the communication (by whatever
  means) of advertising or marketing material which is directed to particular individuals". A
  purely operational message (survey confirmation, install-day reminder, kit delivered, invoice,
  safety notice) carries no advertising, so it is not direct marketing. Adding promotional
  content makes it marketing. *(The ICO's direct marketing guidance says the same; **G-unread**.)*
- **SMS is "electronic mail" (reg 2):** "'electronic mail' means any text, voice, sound or image
  message sent over a public electronic communications network which can be stored in the
  network or in the recipient's terminal equipment until it is collected by the recipient and
  **includes messages sent using a short message service**". So the reg 22 email rules apply to
  SMS in full.
- **Consent (reg 2):** "'consent' by a user or subscriber corresponds to the data subject's
  consent in the UK GDPR".
- **Reg 22(2):** no unsolicited direct marketing by electronic mail "unless the recipient of the
  electronic mail has previously notified the sender that he consents for the time being to such
  communications being sent by, or at the instigation of, the sender." This applies to
  "individual subscribers" (reg 22(1)): consumers and sole traders.
- **Soft opt-in, reg 22(3) (verbatim):**

  > A person may send or instigate the sending of electronic mail for the purposes of direct
  > marketing where— (a) that person has obtained the contact details of the recipient of that
  > electronic mail in the course of the sale or negotiations for the sale of a product or service
  > to that recipient; (b) the direct marketing is in respect of that person's similar products
  > and services only; and (c) the recipient has been given a simple means of refusing (free of
  > charge except for the costs of the transmission of the refusal) the use of his contact
  > details for the purposes of such direct marketing, at the time that the details were
  > initially collected, and, where he did not initially refuse the use of the details, at the
  > time of each subsequent communication.

  App consequences:
  - The quote funnel must show an opt-out at the point of collection. The soft opt-in covers our
    own similar products only (servicing, extra rooms, upgrades), never partners' offers.
  - Whether a quote request counts as "negotiations for the sale" is a judgement. The ICO has
    said a quote request can count (**G-unread**), so record it as `softOptInBasis: "quote"`
    plus the date.
- **Reg 23:** no marketing email or SMS where the sender's identity "has been disguised or
  concealed", or where "a valid address to which the recipient of the communication may send a
  request that such communications cease has not been provided".
- **Calls, reg 21:**
  - (A1): calls for direct marketing must present CLI;
  - (1): no unsolicited marketing calls to a line whose subscriber has objected, or to a number
    on the TPS register (reg 26);
  - (3): there is a 28-day grace period for newly registered numbers;
  - (4): a TPS subscriber can tell a specific caller they do not object.
- **Enforcement:** DUAA 2025 s115 replaces PECR Schedule 1, so the Data Protection Act 2018
  Parts 5–7 enforcement regime is applied to PECR (https://www.legislation.gov.uk/ukpga/2025/18/section/115).
  The new Schedule 1 text was not in the mirror, so the PECR maximum penalty is **not stated
  here (null)**.

**UK GDPR** (canonical https://www.legislation.gov.uk/eur/2016/679; the mirror has no copy).
- The article text below is the EU GDPR wording, read from
  [`legalize-eu`](https://raw.githubusercontent.com/legalize-dev/legalize-eu/main/eu/6e/32016R0679.md).
  The UK GDPR keeps Articles 4(11), 7 and 21(2)–(3) in this form, as far as we know. Article
  21(1) was amended by DUAA 2025 s70 to add point (ea). *Verify the UK text.*
- **Art 4(11)** consent: "any freely given, specific, informed and unambiguous indication of the
  data subject's wishes by which he or she, by a statement or by a clear affirmative action,
  signifies agreement". So use unticked boxes, one per channel, separate from accepting the
  terms.
- **Art 7(1):** "the controller shall be able to demonstrate that the data subject has consented".
  **Art 7(2):** a consent request must be "clearly distinguishable from the other matters".
  **Art 7(3):** "It shall be as easy to withdraw as to give consent." **Art 7(4):** do not make
  the contract conditional on marketing consent.
- **Art 21(2)–(3):** an absolute right to object to direct marketing. "the personal data shall no
  longer be processed for such purposes". Keep a suppression list. Do not delete the person
  entirely, or you cannot honour the objection.
- **DUAA 2025** inserts a new UK GDPR Art 6(11): "processing that is necessary for the purposes of
  direct marketing" is an example of a possible legitimate interest. This affects the *UK GDPR
  lawful basis* (e.g. for postal marketing). It does **not** remove the PECR consent or soft
  opt-in requirement for email and SMS. (L, DUAA mirror.) *fact-check (18 Oct 2026): s70
  (Art 6(11), and Art 21(1) "(ea)" via s70(5)) and s115 (new PECR Schedule 1) are confirmed in
  the mirror. Both are in force "at 5.2.2026 in so far as not already in force" under SI
  2026/82 reg 2(c) and 2(y) (mirror editorial notes, ukpga-2025-18.md, last_updated
  2026-03-31).*
- **Consent record to keep:** person id; channel; granted or withdrawn; timestamp; the exact
  wording and its version; capture method and location (form id or URL); source (quote, survey,
  portal); IP/UA if online; and, for soft opt-in, the basis and the opt-out-offered flag. The
  field list follows the ICO's consent guidance (**G-unread**) and Art 7(1).
- **Operational messages:** lawful basis is contract (Art 6(1)(b)). The customer cannot
  "unsubscribe" from contract-essential notices (cancellation confirmation, install date, safety),
  but those notices must stay free of marketing.

---

## 5. Financial promotions: can an unregulated trader show finance examples?

Grade **L** for statute. The FCA Handbook (CONC) is **G-unread**.

- **FSMA 2000 s21(1)** (https://www.legislation.gov.uk/ukpga/2000/8/section/21): "A person ('A')
  must not, in the course of business, communicate an invitation or inducement to (a) engage in
  investment activity". s21(2): "But subsection (1) does not apply if— (a) A is an authorised
  person; or (b) the content of the communication is approved for the purposes of this section by
  an authorised person." s21(2A): approval only where permitted under **s55NA** (FCA approver
  permission) or an exemption under s55NB.
- **Consumer credit counts as "investment activity".** The Financial Promotion Order 2005
  (SI 2005/1529) Schedule 1 makes these controlled activities:
  - **para 10BA** "Entering into a relevant credit agreement … as lender";
  - **para 4B** credit broking, including "(a) effecting an introduction of an individual … to a
    person who enters into as lender relevant credit agreements" and "(d) presenting or offering
    an agreement which would (if entered into) be a relevant credit agreement".

  A trader's "£48/month, representative APR 9.9%" banner invites people to enter a credit
  agreement through the trader, so it is a **financial promotion** (our reading).
  https://www.legislation.gov.uk/uksi/2005/1529/schedule/1
- **Penalty, s25(1):** contravening s21(1) is an offence, "on conviction on indictment, to
  imprisonment for a term not exceeding two years or a fine, or both". A due diligence defence is
  available (s25(2)).
- **Carrying on** credit broking (introducing customers to a lender) is itself a regulated
  activity: RAO 2001 art 36A, cross-referenced in the FPO as "article 36A of the Regulated
  Activities Order (credit broking)". It needs FCA authorisation (typically limited-permission
  credit broking) or **appointed representative** status under an authorised principal. The RAO
  text was not in the mirror. **Answer: no.** An unauthorised trader should not display finance
  examples or representative APRs unless one of these applies:
  1. it is authorised;
  2. it is an appointed representative acting within its principal's permission;
  3. the promotion's content was approved by an authorised person with s55NA permission (usually
     the lender supplies pre-approved promotions);
  4. an FPO exemption clearly applies (none obviously covers this; *Solicitor*).
- **If a lender is set up:**
  - CONC 3 sets the content of credit promotions: the representative APR, the trigger for a
    representative example, and its prominence (**G-unread**; use the lender's approved
    wording);
  - CCR reg 38 ends the credit agreement automatically on cancellation of the install contract.
- **Not credit:** staged payments for our own work (deposit, then balance on completion) with no
  interest or charges are not consumer credit promotion. The exempt-agreement rules for
  "number of repayments" sit in RAO art 60F (named in the FPO). Their conditions were not
  retrieved; *Solicitor before offering "pay in instalments"*.

---

## 6. Building Regulations 2010 (England): Part P, Part L, competent persons, homeowner documents

Canonical: https://www.legislation.gov.uk/uksi/2010/2214 (mirror last_updated 2025-12-20). Grade
**L** except where marked.

- **Is installing an air-to-air heat pump "building work"?**
  - Reg 3(1)(b): "the provision or extension of a controlled service or fitting in or in
    connection with a building".
  - Reg 2: "'controlled service or fitting' means a service or fitting in relation to which Part
    G, H, J, L or P of Schedule 1 imposes a requirement".
  - Part L covers "fixed building services", defined to include fixed systems for heating, hot
    water, air conditioning or mechanical ventilation. (The full definition was truncated in the
    mirror; the lighting limb was visible. *Verify.*)
  - Our reading: providing a new split heat pump **is building work under Part L**, and its new
    electrical supply is Part P work.
- **Electrical (Part P), reg 12(6A):** a notice is required for Part P work that "consists of— (a)
  the installation of a new circuit; (b) the replacement of a consumer unit; or (c) any addition
  or alteration to existing circuits in a special location". The exception is when it is done by
  a registered competent person (reg 12(6)(a), Schedule 3) or certified by a third-party scheme
  (Schedule 3A).
  - A dedicated outdoor-unit circuit is a new circuit, so it is **notifiable**.
  - Schedule 4 para 2 exempts only adding fittings or sockets to an existing circuit outside
    kitchens and special locations.
- **Could the heat pump itself be non-notifiable?** Schedule 4 para 1(g) exempts "providing a
  self-contained fixed building service" only where:
  - "(ii) any electrical work associated with its provision is exempt"; and
  - "(iii) testing and adjustment is not possible or would not affect its energy efficiency".

  A split system needs a new circuit and refrigerant commissioning, so our reading is that it is
  **not exempt** (*Building control to confirm*).
- **Competent-person self-certification (Schedule 3, current England list, type-of-work column
  only):**
  - "**9.** Installation of an air conditioning or ventilation system in a dwelling, which does
    not involve work on systems shared with other dwellings";
  - "**11.** Installation of fixed low or extra-low voltage electrical installations in
    dwellings";
  - "**12.** … as a necessary adjunct to or arising out of other work being carried out by the
    registered person";
  - "**17.** Installation in a building of a system to produce electricity, heat or cooling— (a)
    by microgeneration, or (b) from renewable sources".

  Which scheme operators may register people for these (column 2) was **not** in the current
  England text in the mirror. An older table in the mirror's editorial notes lists, for "air
  conditioning or ventilation system in a dwelling": Blue Flame Certification, Building
  Engineering Services Competence Assessment (BESCA), Certsure LLP and NAPIT. For
  microgeneration it lists APHC, BESCA, Certsure, HETAS, NAPIT and OFTEC. *Verify the current
  list on gov.uk "competent person schemes".*
- **If no registered competent person does the work:** a building notice or full-plans
  application must be given before work starts (reg 12). The app blocks booking until the route
  is recorded.

**Documents the homeowner must receive (L):**

| Document | Rule | Deadline |
|---|---|---|
| Copy of the competent person's certificate ("Building Regulations compliance certificate") | reg 20(3)(a): "the person carrying out the work shall, not more than 30 days after the completion of the work— (a) give to the occupier a copy of the certificate". Reg 20(3)(b): notice or certificate to the local authority. Reg 20(5)–(6): the certificate "shall be evidence (but not conclusive evidence) that the requirements specified in the certificate have been complied with, and the certificate shall contain this wording". | 30 days after completion |
| Information on fuel and power use and maintenance (Part L) | reg 40(2): "The person carrying out the work shall not later than five days after the work has been completed provide to the owner sufficient information about the building, the fixed building services and their maintenance requirements so that the building can be operated in such a manner as to use no more fuel and power than is reasonable in the circumstances." | 5 days after completion |
| Commissioning notice (to building control, not the homeowner) | reg 44(2)–(4): for Part L fixed building services where testing and adjustment would affect energy efficiency, the installer gives building control "a notice confirming that the fixed building services have been commissioned in accordance with a procedure approved by the Secretary of State". | 30 days after completion (when reg 16(4) does not apply) |
| Electrical Installation Certificate | BS 7671 (not statute). A council leaflet says building control can accept a certificate from a registered electrician "where the electrician tests the work and issues a design, installation and test certificate under BS7671" (**S**, search extract; the result set held leaflets from Bolton, Carlisle, Lancaster, Knowsley, Milton Keynes and Chichester, and the extract did not say which one, e.g. https://www.lancaster.gov.uk/assets/attach/737/Guidance-Note-Electrical-Safety.pdf). See also IET: https://electrical.theiet.org/bs-7671/building-regulations/part-p-england-and-wales/ | At completion |

The Approved Document L minimum efficiency and commissioning procedures for heat pumps were **not
retrieved (null)**.

*fact-check (18 Oct 2026): reg 12(6A), 20(3)/(5)/(6) (30 days), 40(2) (five days), 44(2)–(4)
(30 days), Schedule 3 items 9, 11, 12 and 17, and Schedule 4 para 1(g) were re-read in the mirror
and match. Coming change: SI 2026/335 (Future Homes and Buildings Standards) comes into force on
**24 March 2027**. It renames Part L "Energy and greenhouse gas emissions", adds "and minimisation
of greenhouse gas emissions" to the reg 40 heading, and changes reg 44's reference from "L1(b)"
to "L1(1)(b)". It does not change the five-day or 30-day deadlines above. The 2025 amendment
(SI 2025/1017, in force 7 Oct 2025) only touched reg 44ZA (on-site electricity generation).*

---

## 7. Planning: permitted development for air source heat pumps (England)

GPDO 2015 (SI 2015/596), Schedule 2, Part 14, Class G, as amended by **SI 2025/560 (in force 29
May 2025)**. Canonical: https://www.legislation.gov.uk/uksi/2025/560 and
https://www.legislation.gov.uk/uksi/2015/596/schedule/2/part/14. Grade **L**.

**Class G as it reads after SI 2025/560** (assembled from the consolidated text plus the amending
articles; the mirror's consolidated G.3 is out of date):

> **G.** The installation, alteration or replacement of a microgeneration air source heat pump—
> (a) on a dwellinghouse or a block of flats; or (b) within the curtilage of a dwellinghouse or a
> block of flats, including on a building within that curtilage.
>
> **G.1** Development is not permitted by Class G unless the air source heat pump complies with
> the MCS Planning Standards. *(SI 2025/560 art 5(2) omitted "or equivalent standards".)*
>
> **G.2** Development is not permitted by Class G if—
> (a) in the case of the installation of an air source heat pump, the development would result in
> the presence of— (i) more than one air source heat pump on, or within the curtilage of— (aa) a
> dwellinghouse which is not a detached dwellinghouse; (bb) a block of flats; (ii) more than two
> air source heat pumps on, or within the curtilage of, a detached dwellinghouse;
> (b) … a wind turbine is installed on the same building or within the curtilage …;
> (c) … a stand-alone wind turbine is installed within the curtilage …;
> (d) the volume of the air source heat pump's outdoor compressor unit (including any housing)
> would— (i) in the case of the installation of an air source heat pump on, or within the
> curtilage of, a dwellinghouse, exceed 1.5 cubic metres; (ii) in the case of the installation of
> an air source heat pump on, or within the curtilage of, a block of flats, exceed 0.6 cubic
> metres;
> (e) *omitted by SI 2025/560 art 5(3)(c)* (this was the old rule about distance from the property
> boundary; the boundary-rule description is **S**, installer blogs);
> (f) the air source heat pump would be installed on a pitched roof;
> (g) … on a flat roof where it would be within 1 metre of the external edge of that roof;
> (h) … on a site designated as a scheduled monument;
> (i) … on a building or on land within the curtilage of the dwellinghouse or the block of flats if
> the dwellinghouse or the block of flats is a listed building;
> (j) in the case of land within a conservation area or which is a World Heritage Site the air
> source heat pump— (i) would be installed on a wall or a roof which fronts a highway; or (ii)
> would be installed so that it is nearer to any highway which bounds the curtilage than the part
> of the dwellinghouse or block of flats which is nearest to that highway; or
> (k) in the case of land, other than land within a conservation area or which is a World
> Heritage Site, the air source heat pump would be installed on a wall of a dwellinghouse or
> block of flats if— (i) that wall fronts a highway; and (ii) the air source heat pump would be
> installed on any part of that wall which is above the level of the ground floor storey.
>
> **G.3** Development is permitted by Class G subject to the following conditions—
> **(aa) the air source heat pump is not solely used for the purpose of cooling;** *(inserted by
> SI 2025/560 art 5(4)(b); old (a) "used solely for heating purposes" omitted by art 5(4)(a))*
> (b) the air source heat pump is, so far as practicable, sited so as to minimise its effect on
> the external appearance of the building;
> (c) the air source heat pump is, so far as practicable, sited so as to minimise its effect on
> the amenity of the area; and
> (d) the air source heat pump is removed as soon as reasonably practicable when no longer needed.

**Definitions and cross-references (L):**

- **"MCS Planning Standards"** (Part 14 para P, as amended by SI 2025/560 art 6): "the standards
  specified in the Microgeneration Certification Scheme for air source heat pumps (being MCS 020
  a) - Air Source Heat Pump Sound Calculation (For Permitted Development Installations))". The
  SI's footnote identifies **"Issue 1.1 dated 14th April 2025"** at
  https://mcscertified.com/wp-content/uploads/2025/04/MCS-020-a-Issue-1.1-Final.pdf.
- **Transitional rule (SI 2025/560 art 7):** development that relied on "or equivalent standards"
  could continue "until the end of 28th May 2026". **From 29 May 2026 only MCS 020(a) counts.**
  This confirms an installer-blog claim that the orchestrator flagged as unverified.
- **Noise limit:** the **42 dB(A)** figure is not in the GPDO. It sits inside MCS 020(a). The MCS
  consultation response says MCS 020 provides "a calculation methodology which is designed to
  allow installers to establish clearly whether an air source heat pump installation is compliant
  with the Permitted Development noise limit of 42 dB(A)" (**S**, search extract of
  https://mcscertified.com/wp-content/uploads/2024/11/MCS-020-Consultation-Response-Final.pdf).
  The MCS 020(a) document itself was not opened. Assessment positions and inputs are **not
  stated here**.
  - *fact-check (18 Oct 2026): **42 dB(A) is unverifiable** this session. mcscertified.com did
    not resolve, web search was exhausted, and the figure is in neither the GPDO nor SI 2025/560.
    Keep it as **S** and do not hard-code it as the pass mark until MCS 020(a) is opened. Also
    unverified: whether MCS has issued a version after Issue 1.1. The GPDO footnote names Issue
    1.1, but the definition in para P refers to "the standards specified in the Microgeneration
    Certification Scheme".*
  - *fact-check (18 Oct 2026): SI 2025/560 was re-read and the following were **confirmed**:
    in force 29 May 2025 (art 1(2)); 1 or 2 units (art 5(3)(a)); 1.5 m³ or 0.6 m³ (art 5(3)(b));
    G.2(e) omitted (art 5(3)(c)); G.3(a) omitted and (aa) inserted (art 5(4)); MCS 020 a in
    para P (art 6); "until the end of 28th May 2026" (art 7(2)); footnote "Issue 1.1 dated 14th
    April 2025". The later GPDO amendment, SI 2026/313 (in force 9 Apr 2026), does not touch
    Class G. Its only Part 14 change is an NPPF cross-reference in Class J. Energy Act 2004
    s82(8)(b), "45 kilowatts thermal", is confirmed.*
- **"microgeneration"** = Energy Act 2004 s82(6): plant that "relies wholly or mainly on" listed
  sources (including (j) other low-carbon technologies the Secretary of State specifies) and whose
  capacity "in relation to the production of heat" does not exceed **45 kilowatts thermal**
  (s82(8)(b)). https://www.legislation.gov.uk/ukpga/2004/20/section/82
- **"dwellinghouse"** (GPDO art 2) "does not include a building containing one or more flats, or a
  flat contained within such a building". **"block of flats"** = "a building which consists
  wholly of flats".
  - A flat above a shop is neither, so Class G gives **no PD**.
  - A block of flats gets PD for one unit, ≤ 0.6 m³.
  - Leaseholder or freeholder consent is a separate, private-law matter.
- **"detached dwellinghouse"**: one "which does not share a party wall with a neighbouring
  building".
- **Article 4 directions (GPDO art 4):** the local planning authority can remove Class G rights
  for an area or a specific site. The app needs an "Article 4 checked" item. Listed buildings also
  need listed building consent; G.2(i) removes PD there anyway.

**Are air-to-air units covered?**
- The GPDO does not define "air source heat pump", and Class G does not distinguish air-to-water
  from air-to-air. Two things point to reversible air-to-air units being intended to fall inside
  Class G, provided they are not used solely for cooling:
  1. SI 2025/560 replaced "used solely for heating purposes" with "not solely used for the
     purpose of cooling";
  2. the orchestrator's search extract reported that the reforms "support the rollout of air-to-air
     heat pumps that can also provide a cooling function" (**S**).
- That is an inference, not a statement in the legislation. *Solicitor/planning consultant to
  confirm.*
- A cooling-only unit gets no PD under Class G.

**What the app shows the customer:**
- the PD checklist outcome;
- the MCS 020(a) result;
- the three continuing conditions: siting, removal when no longer needed, and not solely for
  cooling.

Handover should demonstrate heating mode.

---

## 8. VAT: energy-saving materials (Notice 708/6) and registration

Statute grade **L** (VATA 1994, mirror last_updated 2024-11-04). HMRC Notice 708/6 and the VENSAV
manual are **not retrieved**; HMRC positions come from secondary extracts (**S**).

**The zero rate (VATA 1994 Sch 8 Group 23):**
- Heading: "INSTALLATION OF ENERGY-SAVING MATERIALS IN ENGLAND AND WALES AND SCOTLAND FROM 1 APRIL
  2022 TO 31 MARCH 2027, and in Northern Ireland from 1st May 2023 to 31st March 2027".
- Item 1: "Relevant supplies of services of installing energy-saving materials in— (a)
  residential accommodation, or (b) a building intended for use solely for a relevant charitable
  purpose."
- Item 2: "Relevant supplies of energy-saving materials **by a person who installs those
  materials** in— (a) residential accommodation, or (b) …".
- Note 1(1)(i): "**air source heat pumps**" is on the list of energy-saving materials.
- Note 2(1): "residential accommodation" means "(a) a building, or part of a building, that
  consists of a dwelling or a number of dwellings; …".
- Note 3: "relevant supplies" are, for England, "on or after 1st April 2022 and before 1st April
  2027".
- https://www.legislation.gov.uk/ukpga/1994/23/schedule/8/part/II/group/23

**From 1 April 2027 (VATA Sch 7A Group 2, 5%):** "Installation of energy-saving materials from 1st
April 2027". The same two items; air source heat pumps are listed; "relevant supplies" means
"supplies made on or after 1st April 2027".
https://www.legislation.gov.uk/ukpga/1994/23/schedule/7A/part/2/group/2

**Do air-to-air heat pumps qualify? (S)**
- The legislation says "air source heat pumps" and does not mention air conditioning.
- Secondary sources quote HMRC's internal manual **VENSAV3080** as saying "HMRC's understanding is
  that most air conditioning units are air source heat pumps" (acjourney.co.uk,
  https://www.acjourney.co.uk/learn/zero-vat-air-conditioning-uk).
- Secondary sources agree on the rest. A **fixed, reversible** unit that heats as well as cools
  can qualify; a **cooling-only** unit or a **portable or plug-in** unit does not. One of them
  attributes to Notice 708/6 the statement that "only air source heat pumps which are
  permanently fixed and are not portable or moveable qualify". The extract did not say which
  page said what. The result set was acjourney.co.uk, scruttonbland.co.uk, cucumbereco.co.uk,
  electromatic.uk, premierelectricalrenewables.co.uk, eaglereach-airconditioning.co.uk,
  housing.org.uk and justservicesgroup.com.
- Another extract (result set including taxjournal.com, aphc.co.uk and icax.co.uk) says
  "Whether a particular product counts as an air-source heat pump depends on the facts of the
  case", and that the legislation "does not mention air-conditioning units".
- **Other VENSAV paragraph numbers: not found (null).**

**Conditions the app should model:**
1. Installed in **residential accommodation**.
2. **Supplied and installed by the same person**. Supply-only is standard-rated. Item 2 covers
   only materials supplied "by a person who installs those materials".
3. Qualifying product: a fixed air source heat pump (reversible, not cooling-only).
4. Supply date (tax point) before 1 April 2027 for 0%, otherwise 5%.
5. Servicing, maintenance and repair are standard-rated (S).
6. Ancillary non-ESM work billed separately may be standard-rated (S; check Notice 708/6).

**If the trader is NOT VAT-registered:**
- It charges **no VAT at all**. The 0% and 5% rates only matter to registered suppliers.
- It cannot reclaim the VAT it pays on units, pipe and materials, so input VAT is a cost (the
  build plan's "unrecoverable input VAT" line).
- It must not show a VAT line or describe prices as "inc. VAT" as if VAT were charged.
- Zero-rated installs still count towards the threshold: VATA s4(2) says "A taxable supply is a
  supply of goods or services made in the United Kingdom other than an exempt supply".
- A business making only zero-rated supplies can ask HMRC to be exempted from registration (Sch 1
  para 14(1)).
- Conversely, **voluntary registration** while installs are zero-rated lets the business recover
  input VAT while charging 0%, usually a net repayment position. *Accountant to decide.*

**Registration threshold (VATA Sch 1 para 1(1), L):** a UK-established person becomes liable if
"the value of his taxable supplies in the period of one year then ending has exceeded
**£90,000**", or if there are "reasonable grounds for believing that the value of his taxable
supplies in the period of 30 days then beginning will exceed £90,000". The deregistration
threshold is £88,000 (para 1(3), para 4).
- The mirror's VATA snapshot is dated 2024-11-04. **No change to the £90,000 figure for 2026
  could be checked against gov.uk.** *Accountant to confirm the 2026–27 figure.*
- *fact-check (18 Oct 2026): the £90,000 and £88,000 figures, the Group 23 heading and its dates
  (before 1 April 2027), Note 1(1)(i) "air source heat pumps", and Sch 7A Group 2 "on or after
  1st April 2027" were re-read in the mirror and match. **Not refuted, but not verifiable for
  2026–27.** The mirror's VATA has not been refreshed since 2024-11-04. Finance Act 2026 (mirror
  last_updated 2026-10-01) has VAT clauses (leases of vehicles to disabled people, tour operators,
  s33 refunds) but none touching Sch 1, Sch 7A Group 2 or Sch 8 Group 23. The current
  £90,000 figure was set by an order, not a Finance Act: the Value Added Tax (Increase of
  Registration Limits) Order 2024, SI 2024/307, from 1 April 2024 (mirror footnote). No later
  "Increase of Registration Limits" order appeared among the mirror's 2025–26 SIs, which are
  incomplete. gov.uk was
  unreachable.*
- https://www.legislation.gov.uk/ukpga/1994/23/schedule/1

---

## Fact-check log (adversarial pass, 18 Oct 2026)

**Method and limits.**
- Web search was already exhausted, and every non-GitHub host failed (legislation.gov.uk,
  gov.uk, mcscertified.com, ico.org.uk and others).
- Claims were therefore re-checked against a fresh pull of the same legalize-uk mirror (commit
  dated 2026-10-17). That includes instruments the original pass did not consult: 2025–26 SIs
  and Finance Act 2026.
- This is a re-reading of official text, not a check against an independent publisher.

| # | Claim | Result | Evidence |
|---|---|---|---|
| 1 | Concealed-incentive review is "a criminal offence" (checklist E) | **Refuted, fixed** | DMCC s237(8)(b) excludes Sch 20 para 13 |
| 2 | Deadlock letter under ADR Regs 2015 reg 19(2) (§1.9) | **Refuted, fixed** | Revoked 6 Apr 2026: DMCC Sch 27 para 10; SI 2026/284 reg 2(5). Replaced by DMCC s308 |
| 3 | s230(2) list paraphrase ((g) "optional extra charges", (j) missing) (§3) | **Partly refuted, fixed** | s230(2)(g), (j) text |
| 4 | CCR £42 off-premises threshold, reg 7(4) and 27(3) | Confirmed | CCR mirror |
| 5 | CCR reg 19 offence, level 5; unlimited fine from 12 Mar 2015 (LASPO s85) | Confirmed | LASPO note: s85(1),(2),(4) in force 12.3.2015 (SI 2015/504) |
| 6 | Day count: contract 1 Oct, period ends at end of 15 Oct | Confirmed (arithmetic on reg 30(2) wording) | CCR reg 30(2) |
| 7 | CCR reg 12(4), 14(2)–(5), 29(1), 34(5)–(12), 35(1)/(5)/(8), 38 wording | Confirmed | CCR mirror |
| 8 | DMCC Pt 4 Ch 1 in force 6 Apr 2025 except ss232, 234, 235 | Confirmed | SI 2025/272 reg 2(3) |
| 9 | DMCC s240 penalty: two years on indictment; Sch 20 paras 1–5, 7, 13, 23, 27, 28 | Confirmed | DMCC mirror |
| 10 | GPDO Class G changes and dates (SI 2025/560); MCS 020(a) Issue 1.1 dated 14 Apr 2025 | Confirmed | SI 2025/560 arts 1, 5–7 and footnote |
| 11 | 42 dB(A) PD noise limit | **Unverifiable** | MCS site unreachable |
| 12 | Energy Act 2004 s82(8)(b): 45 kWth | Confirmed | Energy Act mirror |
| 13 | Building Regs: 30-day certificate, 5-day info, 30-day commissioning notice, Sch 3 items 9/11/12/17 | Confirmed (SI 2026/335 changes wording from 24 Mar 2027) | Building Regs mirror |
| 14 | VAT 0% before 1 Apr 2027, then 5%; £90,000 / £88,000 | Confirmed in the 2024-11-04 snapshot; **2026–27 unverifiable** | VATA mirror; Finance Act 2026 |
| 15 | PECR: SMS is "electronic mail"; 28-day TPS grace; reg 21(A1) CLI | Confirmed | PECR mirror |
| 16 | DUAA s115 replaces PECR Sch 1; s70 adds Art 6(11) and Art 21(1) "(ea)" | Confirmed; in force 5 Feb 2026 (SI 2026/82) | DUAA mirror notes |
| 17 | DMCC subscription regime not yet in force | **Unverifiable** after 6 Apr 2026 | SI 2026/284 did not commence Ch 2 |

## Open questions for the solicitor, accountant and building control

1. Classification of the pilot journey (survey in the home, then online acceptance):
   off-premises or distance? We build to the off-premises standard regardless. (§1.1)
2. Confirm that supply-and-install is a **sales contract**, with the cancellation period running
   from possession of the last goods and no loss of the right after installation. Decide how to
   handle a post-install cancellation: collect, uninstall and refund, less the proportionate
   installation charge. (§1.2, §1.5, §1.7)
3. Is the early-start request adequately made "on a durable medium" if captured on our web page
   and confirmed by our email, or must it come from the customer's own email or signature? (§1.7)
4. Approve the Schedule 3 text against the official PDF, and the filled-in variants. (§1.10)
5. Price presentation for pilot discounts: is any reference price permissible for a new trader?
   (§3)
6. Wording for incentivised pilot reviews and case studies. (§3)
7. Finance: which route (lender's appointed representative, limited permission, or none)?
   (§5)
8. VAT registration strategy and the HMRC position on air-to-air zero-rating. Consider a non-
   statutory clearance. (§8)
9. Building control: confirm the heat pump installation is notifiable, and which
   competent-person registrations cover it. (§6)
10. Whether a recurring service plan would fall under the DMCC subscription regime once it starts.
    Has DMCC Part 4 Chapter 2 been commenced since 6 Apr 2026? The fact-check could not
    confirm either way. (§1.9)
11. ADR after 6 Apr 2026: what must a complaint-outcome message say under DMCC s308 when we
    are not obliged to use any ADR scheme? Should we join one (e.g. through a trade association
    or competent-person scheme)? (§1.9, fact-check)
12. *Caveats added by the fact-check, not yet verified:*
    - the 42 dB(A) figure and the current MCS 020(a) issue (§7);
    - the 2026–27 VAT registration threshold (§8);
    - the PECR maximum penalty under the new Schedule 1: the DUAA Sch 13 text is still missing
      from the mirror (§4).

---

## Sources

**Legislation (grade L), read from the legalize-uk mirror of legislation.gov.uk (OGL v3.0).**
Each row gives the canonical URL, then the mirror file and its `last_updated` date.

| Instrument | Canonical | Mirror file (last_updated) |
|---|---|---|
| Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013, SI 2013/3134 | https://www.legislation.gov.uk/uksi/2013/3134 | https://raw.githubusercontent.com/legalize-dev/legalize-uk/main/uk/uksi-2013-3134.md (2026-01-01) |
| Consumer Rights Act 2015 | https://www.legislation.gov.uk/ukpga/2015/15 | …/uk/ukpga-2015-15.md (2026-09-28) |
| Digital Markets, Competition and Consumers Act 2024 | https://www.legislation.gov.uk/ukpga/2024/13 | …/uk/ukpga-2024-13.md (2026-04-06) |
| DMCC Act 2024 (Commencement No. 2) Regulations 2025, SI 2025/272 | https://www.legislation.gov.uk/uksi/2025/272 | …/uk/uksi-2025-272.md |
| Consumer Protection from Unfair Trading Regulations 2008 (revoked; revocation footnote) | https://www.legislation.gov.uk/uksi/2008/1277 | …/uk/uksi-2008-1277.md (2025-04-06) |
| ADR for Consumer Disputes (Competent Authorities and Information) Regulations 2015, SI 2015/542 (**revoked 6 Apr 2026**, DMCC Sch 27 para 10; mirror not refreshed) | https://www.legislation.gov.uk/uksi/2015/542 | …/uk/uksi-2015-542.md (2025-04-06) |
| DMCC Act 2024 (Commencement No. 3 and Transitional Provisions) Regulations 2026, SI 2026/284 (fact-check source) | https://www.legislation.gov.uk/uksi/2026/284 | …/uk/uksi-2026-284.md |
| DMCC Act 2024 (Alternative Dispute Resolution) (Information) Regulations 2026, SI 2026/293 (fact-check source) | https://www.legislation.gov.uk/uksi/2026/293 | …/uk/uksi-2026-293.md |
| Building Regulations etc. (Amendment) (England) Regulations 2026, SI 2026/335 (fact-check source; in force 24 Mar 2027) | https://www.legislation.gov.uk/uksi/2026/335 | …/uk/uksi-2026-335.md |
| Finance Act 2026 (fact-check source: no change to VATA Sch 8 Group 23, Sch 7A Group 2 or Sch 1 found) | https://www.legislation.gov.uk/ukpga/2026/11 | …/uk/ukpga-2026-11.md (2026-10-01) |
| Privacy and Electronic Communications (EC Directive) Regulations 2003, SI 2003/2426 | https://www.legislation.gov.uk/uksi/2003/2426 | …/uk/uksi-2003-2426.md (2026-02-05) |
| Data (Use and Access) Act 2025 | https://www.legislation.gov.uk/ukpga/2025/18 | …/uk/ukpga-2025-18.md |
| Data Protection Act 2018 | https://www.legislation.gov.uk/ukpga/2018/12 | …/uk/ukpga-2018-12.md (2026-04-07) |
| GDPR (EU text as proxy for UK GDPR Arts 4(11), 7, 21) | https://www.legislation.gov.uk/eur/2016/679 | https://raw.githubusercontent.com/legalize-dev/legalize-eu/main/eu/6e/32016R0679.md |
| Financial Services and Markets Act 2000 (s21, s25) | https://www.legislation.gov.uk/ukpga/2000/8 | …/uk/ukpga-2000-8.md (2026-09-05) |
| FSMA 2000 (Financial Promotion) Order 2005, SI 2005/1529 | https://www.legislation.gov.uk/uksi/2005/1529 | …/uk/uksi-2005-1529.md (2026-02-25) |
| Building Regulations 2010, SI 2010/2214 | https://www.legislation.gov.uk/uksi/2010/2214 | …/uk/uksi-2010-2214.md (2025-12-20) |
| GPDO (England) 2015, SI 2015/596 | https://www.legislation.gov.uk/uksi/2015/596 | …/uk/uksi-2015-596.md (2026-04-09) |
| GPDO (England) (Amendment) Order 2025, SI 2025/560 | https://www.legislation.gov.uk/uksi/2025/560 | …/uk/uksi-2025-560.md (2025-05-29) |
| Energy Act 2004 (s82 microgeneration) | https://www.legislation.gov.uk/ukpga/2004/20/section/82 | …/uk/ukpga-2004-20.md |
| Value Added Tax Act 1994 (s4, Sch 1, Sch 7A Group 2, Sch 8 Group 23) | https://www.legislation.gov.uk/ukpga/1994/23 | …/uk/ukpga-1994-23.md (2024-11-04) |
| Legal Aid, Sentencing and Punishment of Offenders Act 2012 (s85) | https://www.legislation.gov.uk/ukpga/2012/10/section/85 | …/uk/ukpga-2012-10.md |
| Directive 2011/83/EU Annex I (structure cross-check for Schedule 3) | http://data.europa.eu/eli/dir/2011/83/oj | https://raw.githubusercontent.com/legalize-dev/legalize-eu/main/eu/7e/32011L0083.md (consolidated EU text, includes post-Brexit EU amendments that do not apply in the UK) |

**Third-party copies used only to cross-check the reconstructed Schedule 3 wording:**
- https://github.com/Raj-Vaghela/kaam/blob/main/src/lib/legal/cancellation-form.ts
- https://github.com/modamaan/malayali_anoo/blob/main/app/return-policy/page.tsx

**Secondary (grade S), search-engine extracts gathered by the orchestrator on 18 Oct 2026, pages
not opened:**
- https://www.acjourney.co.uk/learn/zero-vat-air-conditioning-uk (VENSAV3080 quotation)
- https://www.scruttonbland.co.uk/news-views/vat-zero-rating-of-installations-of-energy-saving-materials-esms/
- https://premierelectricalrenewables.co.uk/blog/vat-on-air-conditioning-uk
- https://taxjournal.com/articles/vat-air-source-heat-pumps
- https://mcscertified.com/wp-content/uploads/2024/11/MCS-020-Consultation-Response-Final.pdf (42 dB(A))
- https://www.lancaster.gov.uk/assets/attach/737/Guidance-Note-Electrical-Safety.pdf (Part P certificates)
- https://electrical.theiet.org/bs-7671/building-regulations/part-p-england-and-wales/

**Not retrieved (G-unread). Check these before go-live.** URLs marked † came from search results
or legislation footnotes. Unmarked URLs were not confirmed this session; locate the page by its
title if the link fails.
- HMRC VAT Notice 708/6 †: https://www.gov.uk/guidance/vat-on-energy-saving-materials-and-heating-equipment-notice-7086
- BIS guidance on the 2013 Regulations †: https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/429300/bis-13-1368-consumer-contracts-information-cancellation-and-additional-payments-regulations-guidance.pdf
- MCS 020(a) Issue 1.1 † (from the SI 2025/560 footnote): https://mcscertified.com/wp-content/uploads/2025/04/MCS-020-a-Issue-1.1-Final.pdf
- HMRC VAT registration guidance (current threshold): https://www.gov.uk/vat-registration
- CMA guidance on unfair commercial practices under DMCC (CMA207): search gov.uk for "CMA207"
- ICO guidance on PECR electronic mail marketing and on consent: ico.org.uk, "Direct marketing and privacy and electronic communications"
- FCA Handbook CONC 3 (financial promotions and communications with customers): handbook.fca.org.uk, CONC 3
- gov.uk list of current competent person schemes: search gov.uk for "competent person scheme"
