import { Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/app.volunteers";
import { requireUser } from "../lib/auth";
import { all, first, run } from "../lib/db";
import { newId } from "../lib/ids";
import { envFrom } from "../lib/env";
import { findOrCreateContact } from "../lib/contacts";
import { VOLUNTEER_HOUR_VALUE_SOURCE, volunteerHoursValueCents } from "../lib/impact";
import { Badge, Button, Card, EmptyState, Field, Input, Notice, Select, money } from "../components/ui";

export function meta() {
  return [{ title: "Volunteers | ThriftOS" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);

  const [upcoming, recent, totals, volunteers] = await Promise.all([
    all<{ id: string; name: string | null; role_label: string; starts_at: string; ends_at: string; status: string }>(
      env.DB,
      `SELECT s.id, c.name, s.role_label, s.starts_at, s.ends_at, s.status
         FROM shifts s LEFT JOIN contacts c ON c.id = s.contact_id
        WHERE s.org_id = ? AND s.starts_at >= datetime('now')
        ORDER BY s.starts_at LIMIT 25`,
      user.orgId
    ),
    all<{ id: string; name: string | null; role_label: string; starts_at: string; hours_logged: number; status: string }>(
      env.DB,
      `SELECT s.id, c.name, s.role_label, s.starts_at, s.hours_logged, s.status
         FROM shifts s LEFT JOIN contacts c ON c.id = s.contact_id
        WHERE s.org_id = ? AND s.starts_at < datetime('now')
        ORDER BY s.starts_at DESC LIMIT 25`,
      user.orgId
    ),
    first<{ hours_month: number; hours_year: number; people: number }>(
      env.DB,
      `SELECT
         COALESCE((SELECT SUM(hours_logged) FROM shifts
                    WHERE org_id = ?1 AND status = 'completed'
                      AND starts_at >= date('now','start of month')), 0) AS hours_month,
         COALESCE((SELECT SUM(hours_logged) FROM shifts
                    WHERE org_id = ?1 AND status = 'completed'
                      AND starts_at >= date('now','start of year')), 0) AS hours_year,
         (SELECT COUNT(DISTINCT contact_id) FROM shifts
           WHERE org_id = ?1 AND status = 'completed'
             AND starts_at >= date('now','start of year')) AS people`,
      user.orgId
    ),
    all<{ id: string; name: string }>(
      env.DB,
      `SELECT id, name FROM contacts
        WHERE org_id = ? AND (',' || roles || ',') LIKE '%,volunteer,%'
        ORDER BY name LIMIT 200`,
      user.orgId
    ),
  ]);

  return {
    upcoming,
    recent,
    volunteers,
    hoursMonth: Number(totals?.hours_month ?? 0),
    hoursYear: Number(totals?.hours_year ?? 0),
    people: Number(totals?.people ?? 0),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "schedule");

  if (intent === "complete") {
    const hours = parseFloat(String(form.get("hours") ?? "0"));
    await run(
      env.DB,
      `UPDATE shifts SET status = 'completed', hours_logged = ?, updated_at = datetime('now')
        WHERE id = ? AND org_id = ?`,
      Number.isFinite(hours) && hours > 0 ? hours : 0,
      String(form.get("shift_id") ?? ""),
      user.orgId
    );
    return redirect("/app/volunteers?logged=1");
  }

  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const date = String(form.get("date") ?? "");
  const start = String(form.get("start") ?? "09:00");
  const hours = parseFloat(String(form.get("length") ?? "4"));

  if (!name || !date) return { error: "We need a name and a date — the rest can wait." };

  const contactId = await findOrCreateContact(env.DB, {
    orgId: user.orgId,
    name,
    email: email || null,
    roles: ["volunteer"],
  });

  const startsAt = new Date(`${date}T${start}:00Z`);
  if (Number.isNaN(startsAt.getTime())) return { error: "That date didn't quite parse." };
  const endsAt = new Date(startsAt.getTime() + (Number.isFinite(hours) ? hours : 4) * 3_600_000);

  await run(
    env.DB,
    `INSERT INTO shifts (id, org_id, contact_id, role_label, starts_at, ends_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'scheduled')`,
    newId("shift"),
    user.orgId,
    contactId,
    String(form.get("role_label") ?? "floor"),
    startsAt.toISOString(),
    endsAt.toISOString()
  );

  return redirect("/app/volunteers?scheduled=1");
}

export default function Volunteers({ loaderData, actionData }: Route.ComponentProps) {
  const { upcoming, recent, hoursMonth, hoursYear, people } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-bark">Volunteers</h1>
        <p className="mt-1 text-sm text-slate-soft">
          Who's coming in, and the hours that make the shop possible.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-xs uppercase tracking-wider text-slate-soft">Hours this month</p>
          <p className="mt-2 font-display text-3xl text-moss">{Math.round(hoursMonth)}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wider text-slate-soft">Hours this year</p>
          <p className="mt-2 font-display text-3xl text-moss">{Math.round(hoursYear)}</p>
          <p className="mt-1 text-xs text-slate-soft">
            ≈ {money(volunteerHoursValueCents(hoursYear))} by {VOLUNTEER_HOUR_VALUE_SOURCE}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wider text-slate-soft">People this year</p>
          <p className="mt-2 font-display text-3xl text-bark">{people}</p>
        </Card>
      </div>

      {actionData?.error ? <Notice tone="warn">{actionData.error}</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card className="h-fit">
          <h2 className="font-display text-lg text-bark">Add a shift</h2>
          <Form method="post" className="mt-4 space-y-4">
            <input type="hidden" name="intent" value="schedule" />

            <Field label="Who" name="name">
              <Input id="name" name="name" required />
            </Field>
            <Field label="Email" name="email" hint="Optional.">
              <Input id="email" name="email" type="email" />
            </Field>
            <Field label="Date" name="date">
              <Input id="date" name="date" type="date" required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts" name="start">
                <Input id="start" name="start" type="time" defaultValue="09:00" />
              </Field>
              <Field label="Hours" name="length">
                <Input id="length" name="length" type="number" step="0.5" min="0.5" defaultValue="4" />
              </Field>
            </div>
            <Field label="Doing what" name="role_label">
              <Select id="role_label" name="role_label" defaultValue="floor">
                <option value="floor">Floor</option>
                <option value="sorting">Sorting</option>
                <option value="register">Register</option>
                <option value="pickup">Pickup</option>
                <option value="donations">Donation intake</option>
              </Select>
            </Field>

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Adding…" : "Add the shift"}
            </Button>
          </Form>
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="font-display text-lg text-bark">Coming up</h2>
            {upcoming.length === 0 ? (
              <p className="mt-3 text-sm text-slate-soft">Nothing on the schedule yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line text-sm">
                {upcoming.map((shift) => (
                  <li key={shift.id} className="flex items-center justify-between gap-3 py-3">
                    <span>
                      <span className="block text-bark">{shift.name ?? "Unassigned"}</span>
                      <span className="block text-xs text-slate-soft">
                        {new Date(shift.starts_at).toLocaleString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                    <Badge color="#2B6CB0">{shift.role_label}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="font-display text-lg text-bark">Recent shifts</h2>
            {recent.length === 0 ? (
              <EmptyState title="No hours logged yet" body="Once shifts happen, log the hours here — they're what grant reports are built from." />
            ) : (
              <ul className="mt-3 divide-y divide-line text-sm">
                {recent.map((shift) => (
                  <li key={shift.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span>
                      <span className="block text-bark">{shift.name ?? "Unassigned"}</span>
                      <span className="block text-xs text-slate-soft">
                        {new Date(shift.starts_at).toLocaleDateString()} · {shift.role_label}
                      </span>
                    </span>
                    {shift.status === "completed" ? (
                      <Badge color="#2F6F5E">{shift.hours_logged} hrs</Badge>
                    ) : (
                      <Form method="post" className="flex items-center gap-2">
                        <input type="hidden" name="intent" value="complete" />
                        <input type="hidden" name="shift_id" value={shift.id} />
                        <input
                          name="hours"
                          type="number"
                          step="0.5"
                          min="0"
                          defaultValue="4"
                          className="w-20 rounded-lg border border-line px-2 py-1.5 text-sm"
                          aria-label="Hours worked"
                        />
                        <button
                          type="submit"
                          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-bark hover:bg-linen"
                        >
                          Log
                        </button>
                      </Form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
