import type { Project, ProjectAction } from "@aircon/domain";
import { appUrl } from "./brand";
import { brandedEmail, escapeHtml, sendEmail, sendTeamEmail } from "./email";
import { fmtDay, fmtDayTime, gbp } from "./format";
import { getServiceClient } from "./supabase-server";

/**
 * The customer-experience glue: every meaningful project transition speaks.
 * One map from reducer action → customer email + team alert + quote-status
 * sync, called after a successful applyAndSave from BOTH write paths (the
 * public customer API and the ops server actions), so no milestone is ever
 * silent regardless of who moved it.
 *
 * Best-effort by design: the transition has already committed; email failure
 * must never roll it back or surface as a customer error.
 */
export async function notifyProjectAction(
  project: Project,
  action: ProjectAction,
): Promise<void> {
  try {
    const supabase = getServiceClient();
    if (!supabase) return;

    const { data: quoteRow } = await supabase
      .from("quote_requests")
      .select("email, customer_name")
      .eq("id", project.quoteId)
      .single();
    if (!quoteRow?.email) return;

    const email = quoteRow.email as string;
    const firstName = ((quoteRow.customer_name as string | null) ?? "").split(" ")[0] || "there";
    const link = `${appUrl()}/p/${project.id}`;
    const btn = (label: string) =>
      `<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#d55a0a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:999px">${label}</a></p>`;
    const hi = `<p style="margin:0 0 14px">Hi ${escapeHtml(firstName)},</p>`;
    const send = (subject: string, body: string) =>
      sendEmail(email, subject, brandedEmail(hi + body + btn("Open my timeline")));

    /** The paid-commitment moments also flip the quote to 'booked' for ops metrics. */
    const markBooked = () =>
      supabase
        .from("quote_requests")
        .update({ status: "booked", booked_at: new Date().toISOString() })
        .eq("id", project.quoteId)
        .neq("status", "booked");

    switch (action.type) {
      case "book-site-visit":
      case "reschedule-site-visit": {
        const when = fmtDayTime(action.scheduledFor);
        const mode = action.type === "book-site-visit" && action.mode === "video" ? "video call" : "visit";
        await Promise.all([
          send(
            `Site visit ${action.type === "book-site-visit" ? "booked" : "moved"}: ${when}`,
            `<p style="margin:0 0 14px">Your ${mode} is ${action.type === "book-site-visit" ? "booked" : "now"} for <strong>${when}</strong>. It takes about an hour, confirms every detail of your installation, and the fee comes straight off your installation price.</p>
<p style="margin:0 0 14px">Nothing to prepare — just be home. Your engineer confirms the final plan with you room by room.</p>`,
          ),
          markBooked(),
          sendTeamEmail(
            `📅 Site visit ${action.type === "book-site-visit" ? "booked" : "rescheduled"}: ${escapeHtml(project.customer.name ?? email)} · ${when}`,
            `<p>${escapeHtml(project.customer.name ?? email)} — ${when}.</p><p><a href="${appUrl()}/ops/projects/${project.id}">Open project →</a></p>`,
          ),
        ]);
        return;
      }

      case "book-installation":
      case "reschedule-installation": {
        const when = fmtDay(action.date);
        await Promise.all([
          send(
            `Installation ${action.type === "book-installation" ? "booked" : "moved"}: ${when}`,
            `<p style="margin:0 0 14px">Your installation is ${action.type === "book-installation" ? "booked" : "now"} for <strong>${when}</strong>. Most homes are done in a day — kettle on, job done.</p>
<p style="margin:0 0 14px">Your timeline has a short prep checklist (clear space under each unit's wall, access to the fuse board and outdoor spot) — five minutes the day before is plenty.</p>`,
          ),
          markBooked(),
          sendTeamEmail(
            `🔧 Install ${action.type === "book-installation" ? "booked" : "rescheduled"}: ${escapeHtml(project.customer.name ?? email)} · ${when}`,
            `<p>${escapeHtml(project.customer.name ?? email)} — install ${when}.</p><p><a href="${appUrl()}/ops/projects/${project.id}">Open project →</a> · check kit + crew on <a href="${appUrl()}/ops/schedule">the schedule</a>.</p>`,
          ),
        ]);
        return;
      }

      case "accept-final-quote":
        await sendTeamEmail(
          `✅ Final quote accepted: ${escapeHtml(project.customer.name ?? email)}`,
          `<p>${escapeHtml(project.customer.name ?? email)} accepted their final quote.</p><p><a href="${appUrl()}/ops/projects/${project.id}">Open project →</a></p>`,
        );
        return;

      case "ops-issue-final-quote":
        await send(
          `Your final fixed price is confirmed: ${gbp(action.totalGbp)}`,
          `<p style="margin:0 0 14px">We've reviewed your survey and your final installation price is confirmed: <strong>${gbp(action.totalGbp)}</strong>, VAT included, fixed.</p>
<p style="margin:0 0 14px">Accept it on your timeline and pick your site-visit slot from there.</p>`,
        );
        return;

      case "ops-mark-dispatched":
        await send(
          "Your equipment is on its way",
          `<p style="margin:0 0 14px">Your system has been dispatched with ${escapeHtml(action.courier)} (tracking: ${escapeHtml(action.trackingRef)}). Your timeline shows the expected delivery date — someone should be in to receive it.</p>`,
        );
        return;

      case "ops-assign-installer":
        await send(
          `Meet your installer: ${escapeHtml(action.installer.name)}`,
          `<p style="margin:0 0 14px"><strong>${escapeHtml(action.installer.name)}</strong> (${escapeHtml(action.installer.role)}, ${action.installer.yearsExperience} years on the tools) will be doing your installation. Their profile is on your timeline.</p>`,
        );
        return;

      case "ops-complete-installation":
        await send(
          "You're done — enjoy the cool",
          `<p style="margin:0 0 14px">Your installation is complete and commissioned. Your 5-year parts &amp; labour warranty starts today, and your handover documents live on your timeline.</p>
<p style="margin:0 0 14px">If anything doesn't feel right in the first days, reply to this email — a human reads it.</p>`,
        );
        return;

      default:
        return; // toggle-prep, approve-floor-plan, pay-site-visit, ops-complete-site-visit, ops-mark-delivered: timeline is enough
    }
  } catch (err) {
    console.error("project notify failed:", err);
  }
}

/** "Your timeline exists" — sent once, when the project is first created. */
export async function notifyProjectCreated(projectId: string, quoteId: string): Promise<void> {
  try {
    const supabase = getServiceClient();
    if (!supabase) return;
    const { data } = await supabase
      .from("quote_requests")
      .select("email, customer_name")
      .eq("id", quoteId)
      .single();
    if (!data?.email) return;
    const firstName = ((data.customer_name as string | null) ?? "").split(" ")[0] || "there";
    const link = `${appUrl()}/p/${projectId}`;
    await sendEmail(
      data.email,
      "Your installation timeline is live",
      brandedEmail(`<p style="margin:0 0 14px">Hi ${escapeHtml(firstName)},</p>
<p style="margin:0 0 14px">Your installation plan is set up. Everything from here — floor plan, final price, site visit, delivery, install day — happens on one timeline, and you book the real dates yourself:</p>
<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#d55a0a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:999px">Open my timeline</a></p>
<p style="margin:0 0 14px;font-size:13px;color:#6e7482">Bookmark it — this link is yours and doesn't expire.</p>`),
    );
  } catch (err) {
    console.error("project created notify failed:", err);
  }
}
