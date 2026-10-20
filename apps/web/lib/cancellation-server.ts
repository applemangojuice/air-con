import {
  advancePo,
  cancellationSettlement,
  createIssue,
  invoiceOutstanding,
  transitionIssue,
  type CancellationChannel,
  type Invoice,
  type Issue,
  type Project,
  type StaffMember,
} from "@aircon/domain";
import { audit } from "./audit";
import { notify } from "./comms/outbox";
import { money } from "./format";
import { equipmentToCollect, issueInvoice } from "./money-server";
import { dispatch, loadProject } from "./project-service";
import { isUuid } from "./repo/base";
import * as invoicesRepo from "./repo/invoices";
import * as issuesRepo from "./repo/issues";
import * as purchaseOrdersRepo from "./repo/purchaseOrders";

/**
 * A customer cancels their contract (CCR regs 29-38; legal review
 * required). One step records it and does everything that follows:
 *
 *  1. the project records when and how the notice reached us, and closes as
 *     cancelled (cancellation-received), which stops every delivery message;
 *  2. unpaid invoices are voided, and the pay page and card payments stop
 *     taking money;
 *  3. tasks with owners and due dates: the refund (within 14 days of the
 *     notice, reg 34) when anything was paid, and collecting the equipment
 *     when we supplied it (at our cost). A notice that arrived after the
 *     period ended (`withinPeriod` false) promises neither: one review task
 *     instead, to take advice and write to the customer;
 *  4. orders not yet placed are cancelled, and the team is told about any
 *     already with a supplier;
 *  5. the customer gets an acknowledgement by email, and the team an alert.
 *
 * Each follow-on step is best-effort once the cancellation is recorded: a
 * failure is logged and reported, never undoes the record.
 */

export interface CancellationInput {
  /** When the notice reached us: an ISO instant. */
  receivedAt: string;
  channel: CancellationChannel;
  evidenceRef: string;
}

export type CancellationResult =
  | { ok: true; project: Project; voided: string[]; tasks: Issue[]; warnings: string[] }
  | { ok: false; error: string; status: number; blockers?: unknown };

const KIT_WITH_CUSTOMER = new Set(["dispatched", "delivered", "inspected"]);

async function task(project: Project, staff: StaffMember, title: string, detail: string, dueOn: string, ownerRole: Issue["ownerRole"]): Promise<Issue> {
  const issue = createIssue({
    id: crypto.randomUUID(),
    projectId: project.id,
    number: await issuesRepo.nextNumber(project.id),
    kind: "customer-instruction",
    title,
    detail,
    severity: "high",
    blocking: false,
    customerVisible: false,
    ownerRole,
    nextAction: title,
    raisedBy: { kind: "staff", id: staff.id, name: staff.name },
    raisedAt: new Date().toISOString(),
  });
  return issuesRepo.insert({ ...issue, dueOn });
}

export async function recordCancellation(projectId: string, input: CancellationInput, staff: StaffMember): Promise<CancellationResult> {
  if (!isUuid(projectId)) return { ok: false, error: "Project not found.", status: 404 };
  const result = await dispatch(projectId, { type: "cancellation-received", ...input }, staff);
  if ("error" in result) return { ok: false, error: result.error, status: result.status, ...(result.blockers ? { blockers: result.blockers } : {}) };
  const project = result.project;
  const c = project.cancellation!;
  const warnings: string[] = [];
  const now = new Date().toISOString();

  // 2. No more money is asked for: unpaid invoices are voided, and what's left unpaid on a
  // part-paid one is credited (a credit note against it), so neither their page, the
  // console nor an overdue flag counts it as owed. What they paid stays on it, to refund.
  const voided: string[] = [];
  const credited: string[] = [];
  try {
    for (const inv of await invoicesRepo.listForProject(projectId)) {
      if (inv.kind === "credit-note" || inv.status === "void" || inv.status === "draft") continue;
      if (inv.paidPence > 0) {
        const left = invoiceOutstanding(inv, await invoicesRepo.listForProject(projectId));
        if (left <= 0) continue;
        const cn = await issueInvoice(
          projectId,
          {
            kind: "credit-note",
            amountPence: left,
            reason: "The contract was cancelled: the unpaid part isn't asked for",
            creditsInvoiceId: inv.id,
            creditPurpose: "reduction",
            requestId: `cancel-credit:${inv.id}:${c.receivedAt}`,
          },
          staff,
        );
        if (cn.ok) credited.push(`${inv.number} (${money(left)}, credit note ${cn.value.number})`);
        else warnings.push(`${inv.number} still shows ${money(left)} unpaid: credit it on the money page (${cn.error}).`);
        continue;
      }
      // When it stopped being owed, so the accountant's "owed at the end date" is right for earlier dates (accounts.ts).
      await invoicesRepo.update({ ...inv, status: "void", voidedAt: now, voidReason: "The contract was cancelled" });
      voided.push(inv.number);
    }
  } catch (err) {
    console.error(`[cancellation] voiding invoices on ${projectId} failed:`, err);
    warnings.push("Some unpaid invoices couldn't be voided: void them on the money page.");
  }

  // 3. The refund and the collection, as tasks with owners and deadlines.
  const paid = Math.max(0, project.money.paidPence);
  const supplied = project.proposal.contractType !== "install-only";
  const collect = supplied && (KIT_WITH_CUSTOMER.has(project.kit.status) || project.install.status !== "not-started");
  const tasks: Issue[] = [];
  try {
    if (!c.withinPeriod) {
      // After the period there's no statutory refund or collection to promise: someone decides
      // (with advice) what the contract says now, and writes to the customer.
      tasks.push(
        await task(
          project,
          staff,
          "Late cancellation: take advice, then write to the customer",
          `The customer cancelled (${c.channel}, received ${c.receivedAt.slice(0, 10)}; on file: ${c.evidenceRef}) after the cancellation period had ended, so the 14-day refund doesn't apply as it stands. Nothing has been promised: they were told we'd be in touch. Take advice on what the contract allows${paid > 0 ? ` (they've paid ${money(paid)})` : ""}${collect ? " and on the equipment we supplied" : ""}, then write to them and record any refund on the money page.`,
          c.refundDueBy,
          "admin",
        ),
      );
    } else if (paid > 0) {
      tasks.push(
        await task(
          project,
          staff,
          `Refund ${money(paid)} by ${c.refundDueBy}`,
          `The customer cancelled (${c.channel}, received ${c.receivedAt.slice(0, 10)}; on file: ${c.evidenceRef}). Refund what they've paid, by the same method, within 14 days of the notice. Any deduction for work done at their request is explained in writing first. Record the refund on the money page.`,
          c.refundDueBy,
          "admin",
        ),
      );
    }
    if (collect && c.withinPeriod) {
      tasks.push(
        await task(
          project,
          staff,
          "Collect the equipment we supplied (at our cost)",
          "Agree a time with the customer and collect the equipment we supplied. We pay for collecting it.",
          c.refundDueBy,
          "ops",
        ),
      );
    }
  } catch (err) {
    console.error(`[cancellation] raising tasks on ${projectId} failed:`, err);
    warnings.push("The refund or collection task couldn't be raised: add it by hand.");
  }

  // 4. Orders: unplaced ones are cancelled; placed ones need a call to the supplier.
  const placed: string[] = [];
  try {
    for (const po of await purchaseOrdersRepo.listForProject(projectId)) {
      if (po.status === "required" || po.status === "approved") {
        const r = advancePo(po, "cancelled", staff.name, now, undefined, "The customer cancelled the contract.");
        if (r.ok) await purchaseOrdersRepo.update(r.po);
      } else if (po.status === "ordered" || po.status === "confirmed" || po.status === "dispatched") {
        placed.push(po.supplier);
      }
    }
  } catch (err) {
    console.error(`[cancellation] stopping orders on ${projectId} failed:`, err);
    warnings.push("Open purchase orders couldn't all be checked: look at the kit page.");
  }

  // 5. The customer's acknowledgement, and the team.
  try {
    await notify("cancellation-confirmed", {
      projectId,
      data: {
        receivedAt: c.receivedAt,
        channel: c.channel,
        refundDueBy: c.refundDueBy,
        paidPence: paid,
        collectEquipment: collect,
        withinPeriod: c.withinPeriod,
        workStartedEarly: Boolean(project.proposal.earlyStart) && project.install.status !== "not-started",
      },
      discriminator: c.receivedAt,
    });
  } catch (err) {
    console.error(`[cancellation] the acknowledgement on ${projectId} failed:`, err);
    warnings.push("The acknowledgement email couldn't be sent: check Messages.");
  }
  try {
    await notify("team-alert", {
      projectId,
      data: {
        title: `Cancelled: ${project.customer.name || "a customer"}`,
        lines: [
          `Received ${c.receivedAt.slice(0, 10)} by ${c.channel} (${c.evidenceRef}).${c.withinPeriod ? "" : " It arrived after the cancellation period ended: take advice before refunding."}`,
          ...(!c.withinPeriod
            ? [`The customer was told we'd be in touch: no refund or collection was promised.${paid > 0 ? ` They've paid ${money(paid)}.` : ""}`]
            : [paid > 0 ? `Refund ${money(paid)} by ${c.refundDueBy}.` : "Nothing was paid, so there's nothing to refund."]),
          ...(voided.length ? [`Voided: ${voided.join(", ")}.`] : []),
          ...(credited.length ? [`Unpaid part credited: ${credited.join("; ")}.`] : []),
          ...(collect && c.withinPeriod ? ["Collect the equipment we supplied, at our cost."] : []),
          ...(placed.length ? [`Orders already placed with ${[...new Set(placed)].join(", ")}: call the supplier to cancel or return them.`] : []),
        ],
        urgent: true,
      },
      discriminator: `cancelled:${c.receivedAt}`,
    });
  } catch (err) {
    console.error(`[cancellation] the team alert on ${projectId} failed:`, err);
  }

  await audit({
    actor: staff,
    action: "project.cancellation",
    entity: "project",
    entityId: projectId,
    detail: { receivedAt: c.receivedAt, channel: c.channel, evidenceRef: c.evidenceRef, refundDueBy: c.refundDueBy, voided, credited, tasks: tasks.map((t) => t.id) },
  });
  const reloaded = (await loadProject(projectId)) ?? project;
  return { ok: true, project: reloaded, voided, tasks, warnings };
}

/* ------------------------------------------------------------------ */
/* The charge for work done before the cancellation (CCR reg 36(4))    */
/* ------------------------------------------------------------------ */

export interface CancellationChargeInput {
  /** VAT included. */
  amountPence: number;
  /** How it was worked out: printed on the invoice and in the email. */
  basis: string;
  /** The form's one-off id: a double click or a retry records it once and finishes what's left. */
  requestId: string;
}

export type CancellationChargeResult =
  | {
      ok: true;
      project: Project;
      invoice?: Invoice;
      credits: Invoice[];
      settlement: NonNullable<ReturnType<typeof cancellationSettlement>>;
      warnings: string[];
    }
  | { ok: false; error: string; status: number };

const live = (i: Invoice) => i.status !== "void" && i.status !== "draft";

/**
 * Record what the family pays for the work done before they cancelled
 * (after an evidenced early start, inside the period: the reducer applies
 * `cancellationChargeProblem`), then put the money right, each step safe to
 * repeat with the same `requestId`:
 *
 *  1. the project records the charge (its timeline tells the family);
 *  2. what they paid on the cancelled contract's invoices becomes credit on
 *     their account (a reduction credit note for the part of each invoice not
 *     already credited), so the contract earns nothing;
 *  3. the charge is invoiced (`cancellation-charge`), and that credit is used
 *     against it first: what's left over is the refund, what's short is
 *     theirs to pay (cancellationSettlement, the same numbers everywhere);
 *  4. the refund task raised at the cancellation is replaced by one with the
 *     new figure (or a task to collect what's owed);
 *  5. the family's email (finishIssue: `cancellation-confirmed` with the
 *     charge) and the team's alert.
 *
 * Goods are never part of it: the charge is for the work (reg 36(4)); the
 * equipment follows reg 34 (we collect it) and nothing is deducted for it.
 */
export async function recordCancellationCharge(projectId: string, input: CancellationChargeInput, staff: StaffMember): Promise<CancellationChargeResult> {
  if (!isUuid(projectId)) return { ok: false, error: "Project not found.", status: 404 };
  const recorded = await dispatch(
    projectId,
    { type: "cancellation-charge-recorded", amountPence: input.amountPence, basis: input.basis, requestId: input.requestId },
    staff,
  );
  if ("error" in recorded) return { ok: false, error: recorded.error, status: recorded.status };
  const project = recorded.project;
  const charge = project.cancellation?.charge;
  if (!charge || charge.requestId !== input.requestId) return { ok: false, error: "Another charge is already recorded on this project.", status: 409 };
  const warnings: string[] = [];

  // 2. What they paid becomes credit on their account, against the charge.
  const credits: Invoice[] = [];
  try {
    const all = await invoicesRepo.listForProject(projectId);
    for (const inv of all) {
      if (!live(inv) || inv.kind === "credit-note" || inv.kind === "cancellation-charge" || inv.paidPence <= 0) continue;
      const credited = all.filter((c) => live(c) && c.kind === "credit-note" && c.creditsInvoiceId === inv.id).reduce((sum, c) => sum + c.totalPence, 0);
      const left = inv.totalPence + credited;
      if (left <= 0) continue;
      const cn = await issueInvoice(
        projectId,
        {
          kind: "credit-note",
          amountPence: left,
          reason: "The contract was cancelled: what you paid on this invoice is held against the charge for the work done, and anything over it refunded",
          creditsInvoiceId: inv.id,
          creditPurpose: "reduction",
          releasePaid: true,
          requestId: `charge-credit:${inv.id}:${input.requestId}`,
        },
        staff,
      );
      if (cn.ok) credits.push(cn.value);
      else warnings.push(`${inv.number} wasn't credited (${cn.error}): credit what was paid on it, so it counts against the charge.`);
    }
  } catch (err) {
    console.error(`[cancellation] crediting the contract invoices on ${projectId} failed:`, err);
    warnings.push("The contract's invoices couldn't all be credited: record the charge again to finish.");
  }

  // 3. The charge's invoice (its email is finishIssue's: the charge, the basis, the refund or what's left).
  let invoice: Invoice | undefined;
  const issued = await issueInvoice(projectId, { kind: "cancellation-charge", requestId: `charge:${input.requestId}` }, staff);
  if (issued.ok) {
    invoice = issued.value;
    if (issued.warning) warnings.push(issued.warning);
  } else {
    warnings.push(`The charge is recorded but its invoice wasn't issued (${issued.error}): record it again to finish.`);
  }

  const latest = (await loadProject(projectId)) ?? project;
  const settlement = cancellationSettlement(latest)!;
  const c = latest.cancellation!;

  // 4. The refund task now has a different figure (or there's money to collect instead).
  try {
    const open = (await issuesRepo.listForProject(projectId, { openOnly: true })).filter(
      (i) => i.kind === "customer-instruction" && /^Refund £/.test(i.title) && !i.title.includes("(after the charge"),
    );
    for (const old of open) {
      await issuesRepo.update(
        transitionIssue(old, "closed", staff.name, `Replaced: the charge for the work done (${money(settlement.chargePence)}) changes what's refunded.`, new Date().toISOString()),
      );
    }
    const mine = (await issuesRepo.listForProject(projectId, { openOnly: true })).some((i) => i.title.includes("(after the charge"));
    if (!mine && settlement.refundDuePence > 0) {
      await task(
        latest,
        staff,
        `Refund ${money(settlement.refundDuePence)} by ${c.refundDueBy} (after the charge for the work done)`,
        `They paid ${money(settlement.paidPence)}; the charge for the work done before they cancelled is ${money(settlement.chargePence)} (invoice ${invoice?.number ?? "to issue"}). Refund the rest, ${money(settlement.refundDuePence)}, by the same method, within 14 days of the notice. Record it on the money page against what they paid (or the credit note).`,
        c.refundDueBy,
        "admin",
      );
    } else if (!mine && settlement.owedPence > 0) {
      await task(
        latest,
        staff,
        `Collect ${money(settlement.owedPence)} for the work done (after the charge for the work done)`,
        `The charge for the work done before they cancelled is ${money(settlement.chargePence)}; they'd paid ${money(settlement.paidPence)}. ${money(settlement.owedPence)} is on invoice ${invoice?.number ?? "to issue"}, payable from their project page. Nothing to refund.`,
        invoice?.dueOn ?? c.refundDueBy,
        "admin",
      );
    }
  } catch (err) {
    console.error(`[cancellation] updating the refund task on ${projectId} failed:`, err);
    warnings.push("The refund task couldn't be updated: change its figure by hand.");
  }

  // 5. The team.
  try {
    await notify("team-alert", {
      projectId,
      data: {
        title: `Charge for work done recorded: ${latest.customer.name || "a customer"}`,
        lines: [
          `Charge: ${money(settlement.chargePence)} (${charge.basis}).`,
          `Paid: ${money(settlement.paidPence)}. ${
            settlement.refundDuePence > 0
              ? `Refund ${money(settlement.refundDuePence)} by ${c.refundDueBy}, the same way they paid.`
              : settlement.owedPence > 0
                ? `They owe ${money(settlement.owedPence)}: it's on their pay page.`
                : "Nothing to refund or collect."
          }`,
          ...(equipmentToCollect(latest) ? ["The equipment isn't part of the charge: collect it, at our cost."] : []),
          ...warnings,
        ],
      },
      discriminator: `charge:${input.requestId}`,
    });
  } catch (err) {
    console.error(`[cancellation] the charge alert on ${projectId} failed:`, err);
  }
  await audit({
    actor: staff,
    action: "project.cancellation-charge",
    entity: "project",
    entityId: projectId,
    detail: { ...settlement, amountPence: charge.amountPence, invoice: invoice?.number, credits: credits.map((i) => i.number) },
  });
  return { ok: true, project: latest, ...(invoice ? { invoice } : {}), credits, settlement, warnings };
}
