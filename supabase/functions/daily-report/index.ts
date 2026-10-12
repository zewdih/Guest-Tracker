import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// TODO: Change to "athhp@bsc.coop" once a sending domain is verified in Resend
const REPORT_EMAIL = "zewditu9@gmail.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmt(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function fmtFull(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

Deno.serve(async (req: Request) => {
  try {
    const t = today();

    // Fetch all data
    const [{ data: visits }, { data: statuses }, { data: bookings }] =
      await Promise.all([
        supabase
          .from("visits")
          .select(
            "id, arrival_date, expected_departure, nights, closed_at, guest_id, guests(full_name, phone), host:profiles!host_id(display_name)"
          )
          .is("closed_at", null)
          .is("expired_at", null)
          .order("arrival_date", { ascending: false }),
        supabase.from("guest_status").select("*"),
        supabase
          .from("bookings")
          .select("*, host:profiles!host_id(display_name)")
          .eq("status", "confirmed")
          .gte("departure_date", t)
          .order("arrival_date", { ascending: true }),
      ]);

    const activeVisits = visits || [];
    const allStatuses = statuses || [];
    const upcomingBookings = bookings || [];

    // In the house right now
    const inHouse = activeVisits.filter(
      (v: any) => v.arrival_date <= t && t <= v.expected_departure
    );

    // Status by guest
    const statusMap: Record<string, any> = {};
    allStatuses.forEach((s: any) => {
      statusMap[s.guest_id] = s;
    });

    // Past departure but still open
    const pastDeparture = activeVisits.filter(
      (v: any) => v.expected_departure < t
    );

    // Upcoming bookings (next 7 days)
    const weekOut = new Date();
    weekOut.setDate(weekOut.getDate() + 7);
    const weekOutStr = weekOut.toISOString().slice(0, 10);
    const soonBookings = upcomingBookings.filter(
      (b: any) => b.arrival_date >= t && b.arrival_date <= weekOutStr
    );

    // Build action items
    const actions: string[] = [];
    const capWarnings: string[] = [];

    inHouse.forEach((v: any) => {
      const gs = statusMap[v.guest_id];
      const name = v.guests?.full_name || "Unknown";
      const host = v.host?.display_name || "Unknown";

      if (gs) {
        if (gs.longest_single_visit > 7) {
          actions.push(
            `🚨 <strong>${name}</strong> — ${gs.longest_single_visit} consecutive nights, past 7-night limit. Mini-Guest MO with HP needed. Host: ${host}`
          );
        } else if (gs.nights_this_month >= 5) {
          actions.push(
            `⚠️ <strong>${name}</strong> — ${gs.nights_this_month} cumulative nights this month (crossed 5-night extended threshold). Workshift Manager meeting needed. Host: ${host}`
          );
        }

        // Cap warnings
        if (gs.longest_single_visit >= 12 && gs.longest_single_visit < 14) {
          capWarnings.push(
            `${name} — ${gs.longest_single_visit} of 14 consecutive day limit (${14 - gs.longest_single_visit} days remaining)`
          );
        } else if (gs.longest_single_visit >= 14) {
          capWarnings.push(
            `🛑 ${name} — at or past 14-day consecutive cap. Council approval required.`
          );
        }
        if (gs.nights_this_month >= 25 && gs.nights_this_month < 30) {
          capWarnings.push(
            `${name} — ${gs.nights_this_month} of 30 nonconsecutive day semester limit (${30 - gs.nights_this_month} days remaining)`
          );
        } else if (gs.nights_this_month >= 30) {
          capWarnings.push(
            `🛑 ${name} — at or past 30-day semester cap. Council approval required.`
          );
        }
      }
    });

    pastDeparture.forEach((v: any) => {
      const name = v.guests?.full_name || "Unknown";
      const host = v.host?.display_name || "Unknown";
      actions.push(
        `📅 <strong>${name}</strong> — past departure date (${fmt(v.expected_departure)}), visit still open. Host: ${host}. Close out or extend?`
      );
    });

    // Build status label
    function statusLabel(guestId: string, nights: number): string {
      const gs = statusMap[guestId];
      if (gs?.longest_single_visit > 7) return "🚨 overstaying";
      if (gs?.nights_this_month >= 5) return "extended";
      return "casual";
    }

    function nightsDisplay(v: any): string {
      const gs = statusMap[v.guest_id];
      if (gs && gs.nights_this_month > v.nights) {
        return `${v.nights} (${gs.nights_this_month} total)`;
      }
      return `${v.nights}`;
    }

    // Totals
    const totalGuests = new Set(activeVisits.map((v: any) => v.guest_id)).size;
    const totalNights = activeVisits.reduce(
      (sum: number, v: any) => sum + v.nights,
      0
    );
    const flagged = allStatuses.filter(
      (s: any) =>
        s.nights_this_month >= 5 || s.longest_single_visit > 7
    ).length;

    // Compose HTML email
    const html = `
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px; }
  h1 { font-size: 1.3rem; margin: 0 0 4px; }
  h2 { font-size: 1rem; margin: 20px 0 8px; color: #555; text-transform: uppercase; letter-spacing: 0.03em; }
  .subtitle { color: #888; font-size: 0.9rem; margin: 0 0 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin-bottom: 16px; }
  th { text-align: left; padding: 8px 10px; border-bottom: 2px solid #e5e5e5; color: #888; font-size: 0.78rem; text-transform: uppercase; }
  td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 700; }
  .badge-casual { background: #d1fae5; color: #065f46; }
  .badge-extended { background: #fef3c7; color: #92400e; }
  .badge-overstay { background: #fee2e2; color: #991b1b; }
  .action-item { padding: 10px 14px; margin: 6px 0; border-radius: 8px; font-size: 0.88rem; line-height: 1.5; background: #fff8f0; border-left: 3px solid #f59e0b; }
  .action-item.urgent { background: #fef2f2; border-left-color: #ef4444; }
  .cap-item { padding: 8px 14px; margin: 4px 0; border-radius: 8px; font-size: 0.85rem; background: #f5f5f5; }
  .empty { color: #999; font-style: italic; font-size: 0.88rem; }
  .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e5e5; color: #999; font-size: 0.8rem; }
</style>
</head>
<body>
  <h1>Tap In — Daily Report</h1>
  <p class="subtitle">${fmtFull()}</p>

  <h2>In the house now (${inHouse.length})</h2>
  ${
    inHouse.length === 0
      ? '<p class="empty">No guests in the house right now.</p>'
      : `<table>
    <thead><tr><th>Guest</th><th>Host</th><th>Nights</th><th>Status</th></tr></thead>
    <tbody>
      ${inHouse
        .map((v: any) => {
          const st = statusLabel(v.guest_id, v.nights);
          const badgeClass = st.includes("overstay")
            ? "badge-overstay"
            : st === "extended"
            ? "badge-extended"
            : "badge-casual";
          return `<tr>
          <td>${v.guests?.full_name || "—"}</td>
          <td>${v.host?.display_name || "—"}</td>
          <td>${nightsDisplay(v)}</td>
          <td><span class="badge ${badgeClass}">${st}</span></td>
        </tr>`;
        })
        .join("")}
    </tbody>
  </table>`
  }

  ${
    actions.length > 0
      ? `<h2>Action needed</h2>
  ${actions
    .map(
      (a) =>
        `<div class="action-item${a.includes("🚨") || a.includes("📅") ? " urgent" : ""}">${a}</div>`
    )
    .join("")}`
      : ""
  }

  ${
    capWarnings.length > 0
      ? `<h2>Approaching caps</h2>
  ${capWarnings.map((c) => `<div class="cap-item">${c}</div>`).join("")}`
      : ""
  }

  ${
    pastDeparture.length > 0
      ? ""
      : actions.filter((a) => a.includes("📅")).length === 0
      ? `<h2>Past departure, still open</h2><p class="empty">None — all visits are current.</p>`
      : ""
  }

  <h2>Upcoming bookings (next 7 days)</h2>
  ${
    soonBookings.length === 0
      ? '<p class="empty">No bookings in the next 7 days.</p>'
      : `<table>
    <thead><tr><th>Guest</th><th>Host</th><th>Dates</th><th>Nights</th></tr></thead>
    <tbody>
      ${soonBookings
        .map(
          (b: any) => `<tr>
        <td>${b.guest_name}</td>
        <td>${b.host?.display_name || b.booker_name}</td>
        <td>${fmt(b.arrival_date)} – ${fmt(b.departure_date)}</td>
        <td>${b.nights}</td>
      </tr>`
        )
        .join("")}
    </tbody>
  </table>`
  }

  <div class="footer">
    ${totalGuests} guest${totalGuests !== 1 ? "s" : ""} on record · ${totalNights} total nights · ${flagged} flagged<br>
    <a href="https://tap-in-afro-house.netlify.app/manager">Open Dashboard</a>
  </div>
</body>
</html>`;

    // Send via Resend
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Tap In <onboarding@resend.dev>",
        to: [REPORT_EMAIL],
        subject: `Tap In Daily Report — ${fmtFull()}`,
        html,
      }),
    });

    const emailResult = await emailRes.json();

    if (!emailRes.ok) {
      return new Response(JSON.stringify({ error: emailResult }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, sent_to: REPORT_EMAIL, resend: emailResult }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
