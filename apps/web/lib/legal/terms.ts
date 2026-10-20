import { sameJson, type TermsSection } from "@aircon/domain";
import {
  installDaysPhrase,
  paymentCopy,
  surveyDurationCopy,
  surveyPriceCopy,
  vatCopy,
  warrantyCopy,
  type PublicSettings,
} from "../../components/site/claims.ts";

/**
 * Our terms, as text: the one source for the /terms page and for the copy
 * frozen onto every proposal at issue (ProposalRecord.termsText), which the
 * customer sees before accepting, gets by email, and finds in their contract.
 * Built from settings, so every fact (who we are, VAT, payment, install
 * length, guarantees, complaints) is the one the business has decided.
 *
 * DRAFT: under solicitor review until settings.legal.termsReviewed. When the
 * wording changes, bump settings.legal.termsVersion: a proposal already
 * issued keeps the text it went out with.
 *
 * The model cancellation instructions and form aren't repeated here: they're
 * their own frozen parts of the proposal email and the contract
 * (lib/comms/legal-text.ts).
 */
export function termsSections(s: PublicSettings): TermsSection[] {
  const c = s.company;
  const pay = paymentCopy(s);
  const vat = vatCopy(s);
  const warranty = warrantyCopy(s);
  const days = s.scheduling.cancellationDays;
  const surveyPrice = surveyPriceCopy(s);
  const surveyDuration = surveyDurationCopy(s);
  const survey = `${surveyPrice === "Free" ? "free" : surveyPrice}${surveyDuration ? ` and takes ${surveyDuration}` : ""}`;
  const tradingAs = c.tradingName && c.tradingName !== c.legalName ? ` (trading as ${c.tradingName})` : "";

  const who: string[] = [`These terms are between you and ${c.legalName}${tradingAs} ("we", "us").`];
  if (c.companyNumber) who.push(`Company number: ${c.companyNumber} (registered in England and Wales).`);
  if (c.registeredAddress) who.push(`Registered office: ${c.registeredAddress}.`);
  who.push(`Trading address: ${c.geographicAddress ?? "set out in every proposal and contract confirmation"}.`);
  who.push(`Email: ${c.email}.`);
  if (c.phone) who.push(`Phone: ${c.phone}.`);
  if (c.vatNumber) who.push(`VAT number: ${c.vatNumber}.`);

  const guarantees = [
    warranty
      ? `${warranty.headline}. ${warranty.body}`
      : "Your proposal sets out the manufacturer's warranty for your equipment and any workmanship guarantee from us, in writing, before you agree to anything.",
    ...(c.workmanshipGuarantee ? [c.workmanshipGuarantee] : []),
    "The law already requires the equipment we supply to match the contract and our work to be done with reasonable care and skill. Any guarantee is on top of these rights, not instead of them.",
    "Where a manufacturer's warranty needs registering, we register it and tell you when it's done.",
    "After your install we check in after a week, ask how it's going after a month, and remind you when a service is due. You can report a problem from your project page at any time.",
  ];

  const sections: TermsSection[] = [
    { id: "who", title: "Who we are", items: who },
    {
      id: "price",
      title: "Your online price",
      items: [
        "Your online price is worked out from your answers by our pricing engine. It's a real price for the system it describes, and every quote shows how confident we are in it.",
        "We confirm it at your home survey. It can only change for something the survey finds that your answers didn't show: for example a different number or size of rooms, a longer pipe route, or electrical work your fuse board needs. Your proposal names each change and what it does to the price.",
        `An online price is valid for ${s.quoteValidityDays} days from the day you get it. After that, your proposal confirms today's price.`,
        "Getting, saving or sharing a price doesn't commit you to anything.",
        `We don't show "was" prices. If we offer a discount, your proposal shows it as its own line, with the reason.`,
      ],
    },
    {
      id: "survey",
      title: "Your home survey",
      items: [
        `Your home survey is ${survey}. A surveyor measures your rooms, checks where the indoor and outdoor units could go and how pipes and cables would run, checks your fuse board, and looks for anything that needs care, such as possible asbestos in older homes.`,
        "There's no obligation, and we won't ask you to sign anything at the survey.",
        "Please make sure we can reach your fuse board and loft. If you need to rearrange, tell us as early as you can.",
      ],
    },
    {
      id: "contract",
      title: "Your proposal and your contract",
      items: [
        "After the survey we design your system, and a qualified engineer checks and signs off the design before we send you a price.",
        "Your proposal sets out the equipment for each room and where it goes, what's included and what isn't, the total price, how and when you pay, the install plan, the guarantees, your right to cancel, how long the proposal is open, and these terms, in the version that applies to you.",
        "We'll ask whether you're happy to get your proposal, contract and cancellation information by email. During the pilot we can only send them by email, never on paper, and only with your agreement. If you'd rather not have them by email, tell us and we'll talk it through; we won't send you a proposal until you've agreed.",
        "You accept online by typing your name and confirming that you accept and agree to pay the total. That is when the contract is made. We then email you a confirmation of your contract with these terms and the cancellation form.",
        "Once you've accepted, we can't change your proposal. Any change after that is a variation (section 6).",
      ],
    },
    {
      id: "vat",
      title: "Prices and VAT",
      items: [
        `${vat.long} The total in your proposal includes everything you will necessarily pay. If any part can't be priced in advance, your proposal says how it would be worked out, before you accept.`,
      ],
    },
    {
      id: "changes",
      title: "Changes after you accept",
      items: [
        "If you'd like something changed, or we find something during the install that couldn't be seen at the survey, we'll explain it and give you the price difference in writing. We only go ahead once you've agreed to it in writing, by name, and we send you a copy.",
        "Nothing extra is added on the day without your written agreement.",
        "If we find something unsafe to work on, such as suspected asbestos, we stop that part of the work and agree the next step with you.",
      ],
    },
    {
      id: "paying",
      title: "Paying",
      items: [
        pay.deposit,
        pay.balance,
        `${pay.methods} We send an invoice for every payment, and we never ask for card details by phone or email.`,
        ...(s.finance.offered ? [] : ["We don't offer finance."]),
      ],
    },
    {
      id: "install",
      title: "Your installation",
      items: [
        `You choose your install dates from the ones we offer. Most homes take ${installDaysPhrase(s)}. We only start inside your cancellation period if you've asked us to in writing (section 9).`,
        "Your part: access to the rooms and outside, a clear space where we're working, parking information, and your landlord's or freeholder's written permission if you need it.",
        "We check planning at the survey and never assume it isn't needed. If planning permission is needed, we tell you before you accept; applying for it is your decision, and we'll help with the technical details.",
        "The power is off for up to 30 minutes while we connect the new circuit. We tell you before it happens.",
        "Before we leave, we test and commission the system in heating and cooling, show you how to use it, and give you your documents: equipment and serial numbers, commissioning results, the electrical certificate (or when it will follow), warranty details and a care guide.",
        "We put right any damage we cause.",
      ],
    },
    {
      id: "cancel",
      title: "Your right to cancel",
      items: [
        "You can cancel without giving a reason.",
        `When we supply the equipment (most jobs): until ${days} days after the day the last item of your equipment is delivered to you.`,
        `When you supply the equipment and we only install it: within ${days} days of the day you accept.`,
        `To cancel, tell us clearly: email ${c.email}${c.phone ? `, call ${c.phone}` : ""} or write to us. You can use the model cancellation form, but you don't have to.`,
        "Starting sooner. If you want us to start before your cancellation period ends, you need to ask us in writing, for example by replying to your contract confirmation email. If you then cancel after we've started, you pay for the work done up to the time you tell us. When we supply the equipment you keep your right to cancel after installation; when you supply it, you lose the right to cancel once the work is fully done.",
        "If you cancel, we refund what you've paid (less any amount for work done at your request) within 14 days, by the same method you paid. When we supplied the equipment, we collect it and pay for doing so.",
        "The full cancellation instructions and the model cancellation form come with your proposal and your contract confirmation.",
      ],
    },
    { id: "guarantees", title: "Guarantees and aftercare", items: guarantees },
    {
      id: "complaints",
      title: "If something goes wrong",
      items: [
        c.complaintsProcess ?? `Tell us what's gone wrong by email at ${c.email}. Our full complaints process is set out in every proposal.`,
        ...(c.adr ? [c.adr] : []),
      ],
    },
    {
      id: "liability",
      title: "Our responsibility to you",
      items: [
        "Nothing in these terms limits our liability for death or personal injury caused by negligence, for fraud, or for anything else that can't be limited by law. Otherwise, our liability under a contract is limited to the price you paid us. We're not liable for losses that aren't a foreseeable result of our breaking these terms.",
      ],
    },
    {
      id: "data",
      title: "Your information",
      items: ["Our privacy notice (on our website at /privacy) explains what we collect, why, how long we keep it and your rights."],
    },
    {
      id: "general",
      title: "The legal bits",
      items: [
        "These terms are governed by the law of England and Wales, and disputes go to the courts of England and Wales. If any part of these terms is found unenforceable, the rest still applies.",
      ],
    },
  ];
  return sections.map((section) => ({ ...section, items: section.items.map((i) => i.trim()).filter(Boolean) }));
}

/** The terms as plain text, numbered as on the page: for emails and anywhere else without HTML. */
export function termsPlainText(sections: TermsSection[]): string[] {
  return sections.flatMap((section, i) => [`${i + 1}. ${section.title}`, ...section.items.map((item) => `- ${item}`)]);
}

/** Two copies of the terms say the same thing. */
export const sameTerms = (a: TermsSection[] | undefined, b: TermsSection[] | undefined) => sameJson(a ?? null, b ?? null);
