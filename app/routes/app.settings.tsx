import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/app.settings";
import { requireRole, requireUser } from "../lib/auth";
import { all, first, run } from "../lib/db";
import { DEFAULT_SETTINGS, parseOrgSettings, serialiseOrgSettings } from "../lib/settings";
import { envFrom, integrationStatus } from "../lib/env";
import { TAG_COLOR_HEX } from "../lib/markdown";
import { TRUST_BOUNDARIES } from "../lib/nri/voice";
import { formatBps, getPlan, PLANS } from "../lib/pricing";
import { feeCapVolumeCents, maxMonthlyCostCents } from "../lib/savings";
import { Badge, Button, Card, Field, Input, Notice, money } from "../components/ui";
import { ConnectPanel } from "../components/ConnectPanel";
import { canAcceptPayments, getAccount, statusExplanation } from "../lib/stripe/connect";
import { isTestMode, stripeReadiness } from "../lib/stripe/client";

export function meta() {
  return [{ title: "Settings | ThriftOS" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);

  const [org, rules, salesThisMonth, aiUsage] = await Promise.all([
    first<{
      name: string;
      legal_name: string | null;
      ein: string | null;
      street: string | null;
      city: string | null;
      state: string | null;
      postal_code: string | null;
      phone: string | null;
      email: string | null;
      plan: string;
      slug: string;
      settings_json: string;
      federation_group_id: string | null;
    }>(
      env.DB,
      `SELECT name, legal_name, ein, street, city, state, postal_code, phone, email,
              plan, slug, settings_json, federation_group_id
         FROM orgs WHERE id = ?`,
      user.orgId
    ),
    all<{ tag_color: string; week_index: number; discount_pct: number; age_days: number }>(
      env.DB,
      `SELECT tag_color, week_index, discount_pct, age_days FROM markdown_rules
        WHERE org_id = ? AND is_active = 1 ORDER BY week_index`,
      user.orgId
    ),
    first<{ n: number }>(
      env.DB,
      `SELECT COUNT(*) AS n FROM transactions
        WHERE org_id = ? AND voided_at IS NULL AND created_at >= date('now','start of month')`,
      user.orgId
    ),
    first<{ n: number }>(
      env.DB,
      `SELECT COUNT(*) AS n FROM nri_ai_log
        WHERE org_id = ? AND purpose = 'item_vision' AND ok = 1
          AND created_at >= date('now','start of month')`,
      user.orgId
    ),
  ]);

  const settings = parseOrgSettings(org?.settings_json);

  // Rendered server-side so the panel is truthful on first paint rather than
  // flashing "not connected" while a fetch resolves.
  const connectRecord = await getAccount(env.DB, user.orgId);
  const readiness = stripeReadiness(env);
  const connectStatus = connectRecord?.status ?? "not_started";

  return {
    connect: {
      configured: readiness.configured,
      missingSecrets: readiness.missing,
      status: connectStatus,
      explanation: statusExplanation(connectStatus),
      canAcceptPayments: canAcceptPayments(connectRecord),
      account: connectRecord
        ? {
            stripeAccountId: connectRecord.stripeAccountId,
            chargesEnabled: connectRecord.chargesEnabled,
            payoutsEnabled: connectRecord.payoutsEnabled,
            detailsSubmitted: connectRecord.detailsSubmitted,
            disabledReason: connectRecord.disabledReason,
            currentlyDue: connectRecord.currentlyDue,
            eventuallyDue: connectRecord.eventuallyDue,
            lastSyncedAt: connectRecord.lastSyncedAt,
          }
        : null,
    },
    testMode: isTestMode(env.STRIPE_SECRET_KEY),
    org,
    rules,
    settings,
    integrations: integrationStatus(env),
    role: user.role,
    salesThisMonth: Number(salesThisMonth?.n ?? 0),
    aiUsed: Number(aiUsage?.n ?? 0),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const user = await requireRole(request, env.DB, "admin");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "org") {
    await run(
      env.DB,
      `UPDATE orgs SET name = ?, legal_name = ?, ein = ?, street = ?, city = ?, state = ?,
                       postal_code = ?, phone = ?, email = ?, updated_at = datetime('now')
        WHERE id = ?`,
      String(form.get("name") ?? "").trim(),
      String(form.get("legal_name") ?? "").trim() || null,
      String(form.get("ein") ?? "").trim() || null,
      String(form.get("street") ?? "").trim() || null,
      String(form.get("city") ?? "").trim() || null,
      String(form.get("state") ?? "").trim() || null,
      String(form.get("postal_code") ?? "").trim() || null,
      String(form.get("phone") ?? "").trim() || null,
      String(form.get("email") ?? "").trim() || null,
      user.orgId
    );
    return redirect("/app/settings?saved=org");
  }

  if (intent === "register") {
    const taxPct = parseFloat(String(form.get("tax_rate") ?? "0"));
    // Serialised through the shared shape, so the key names here, in the
    // register, and in the server-side pricer are the same by construction.
    const settings = serialiseOrgSettings({
      // Stored as basis points — a percentage kept as a float rounds wrong.
      taxRateBps: Number.isFinite(taxPct) ? Math.round(taxPct * 100) : 0,
      roundUpEnabled: form.get("round_up") === "on",
      roundUpCause: String(form.get("round_up_cause") ?? "").trim() || DEFAULT_SETTINGS.roundUpCause,
    });
    await run(
      env.DB,
      `UPDATE orgs SET settings_json = ?, updated_at = datetime('now') WHERE id = ?`,
      settings,
      user.orgId
    );
    return redirect("/app/settings?saved=register");
  }

  if (intent === "markdown") {
    for (const color of Object.keys(TAG_COLOR_HEX)) {
      const pct = form.get(`pct_${color}`);
      const days = form.get(`days_${color}`);
      if (pct === null && days === null) continue;
      await run(
        env.DB,
        `UPDATE markdown_rules SET discount_pct = ?, age_days = ? WHERE org_id = ? AND tag_color = ?`,
        Math.min(100, Math.max(0, parseInt(String(pct ?? "0"), 10) || 0)),
        Math.max(0, parseInt(String(days ?? "0"), 10) || 0),
        user.orgId,
        color
      );
    }
    return redirect("/app/settings?saved=markdown");
  }

  return { error: "We didn't recognise that action." };
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { org, rules, settings, integrations, role, salesThisMonth, aiUsed, connect, testMode } =
    loaderData;
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const canEdit = role === "owner" || role === "admin";
  const plan = getPlan(org?.plan ?? "volunteer");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-bark">Settings</h1>
        <p className="mt-1 text-sm text-slate-soft">
          Your shop's decisions stay your shop's. Nothing here is set for you.
        </p>
      </div>

      {!canEdit ? (
        <Notice>
          You can look around, but changing these needs an owner or admin. That's not a
          judgement — it just keeps the register's rules stable while you're on the floor.
        </Notice>
      ) : null}

      <Card>
        <h2 className="font-display text-lg text-bark">Your shop</h2>
        <p className="mt-1 text-xs text-slate-soft">
          The EIN and legal name appear on donation receipts, so donors can use them.
        </p>
        <Form method="post" className="mt-4 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="intent" value="org" />
          <Field label="Shop name" name="name">
            <Input id="name" name="name" defaultValue={org?.name ?? ""} disabled={!canEdit} />
          </Field>
          <Field label="Legal name" name="legal_name">
            <Input id="legal_name" name="legal_name" defaultValue={org?.legal_name ?? ""} disabled={!canEdit} />
          </Field>
          <Field label="EIN" name="ein" hint="Federal tax ID, for receipts.">
            <Input id="ein" name="ein" defaultValue={org?.ein ?? ""} disabled={!canEdit} placeholder="12-3456789" />
          </Field>
          <Field label="Phone" name="phone">
            <Input id="phone" name="phone" defaultValue={org?.phone ?? ""} disabled={!canEdit} />
          </Field>
          <Field label="Street" name="street">
            <Input id="street" name="street" defaultValue={org?.street ?? ""} disabled={!canEdit} />
          </Field>
          <Field label="City" name="city">
            <Input id="city" name="city" defaultValue={org?.city ?? ""} disabled={!canEdit} />
          </Field>
          <Field label="State" name="state">
            <Input id="state" name="state" defaultValue={org?.state ?? ""} disabled={!canEdit} />
          </Field>
          <Field label="Postal code" name="postal_code">
            <Input id="postal_code" name="postal_code" defaultValue={org?.postal_code ?? ""} disabled={!canEdit} />
          </Field>
          {canEdit ? (
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                Save shop details
              </Button>
            </div>
          ) : null}
        </Form>
      </Card>

      <Card>
        <h2 className="font-display text-lg text-bark">The register</h2>
        <Form method="post" className="mt-4 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="intent" value="register" />
          <Field label="Sales tax rate (%)" name="tax_rate" hint="0 if you're exempt.">
            <Input
              id="tax_rate"
              name="tax_rate"
              type="number"
              step="0.01"
              min="0"
              max="20"
              defaultValue={(settings.taxRateBps / 100).toFixed(2)}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Round-up goes to" name="round_up_cause">
            <Input
              id="round_up_cause"
              name="round_up_cause"
              defaultValue={settings.roundUpCause}
              disabled={!canEdit}
            />
          </Field>
          <label className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              name="round_up"
              defaultChecked={settings.roundUpEnabled}
              disabled={!canEdit}
              className="h-4 w-4"
            />
            <span className="text-sm text-bark">
              Offer round-up-for-donation at checkout (the cashier can always turn it off)
            </span>
          </label>
          {canEdit ? (
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                Save register settings
              </Button>
            </div>
          ) : null}
        </Form>
      </Card>

      <Card>
        <h2 className="font-display text-lg text-bark">Colour-tag rotation</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-soft">
          Items get a colour on the day they hit the floor, then step down in price as they
          age. Your rotation, your discounts — change any of it.
        </p>
        <Form method="post" className="mt-4 space-y-3">
          <input type="hidden" name="intent" value="markdown" />
          {rules.map((rule) => (
            <div key={rule.tag_color} className="flex flex-wrap items-center gap-3">
              <span className="flex w-28 items-center gap-2">
                <span
                  className="inline-block h-4 w-4 rounded-full border border-line"
                  style={{ backgroundColor: TAG_COLOR_HEX[rule.tag_color] ?? "#ddd" }}
                />
                <span className="text-sm capitalize text-bark">{rule.tag_color}</span>
              </span>
              <label className="flex items-center gap-2 text-sm text-slate-soft">
                after
                <input
                  name={`days_${rule.tag_color}`}
                  type="number"
                  min="0"
                  defaultValue={rule.age_days}
                  disabled={!canEdit}
                  className="w-20 rounded-lg border border-line px-2 py-1.5"
                />
                days
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-soft">
                take off
                <input
                  name={`pct_${rule.tag_color}`}
                  type="number"
                  min="0"
                  max="100"
                  defaultValue={rule.discount_pct}
                  disabled={!canEdit}
                  className="w-20 rounded-lg border border-line px-2 py-1.5"
                />
                %
              </label>
            </div>
          ))}
          {canEdit ? (
            <Button type="submit" disabled={busy}>
              Save the rotation
            </Button>
          ) : null}
        </Form>
      </Card>

      <div id="payments" className="scroll-mt-8">
        <ConnectPanel initial={connect} testMode={testMode} />
      </div>

      <Card>
        <h2 className="font-display text-lg text-bark">Your data</h2>
        <p className="mt-2 leading-relaxed text-slate-soft">
          Everything you've put in here is yours, and you can take all of it whenever you like —
          including if a payment to us has failed. Nothing about leaving requires asking us first.
        </p>
        <Link
          to="/app/export"
          className="mt-3 inline-block text-moss underline underline-offset-2"
        >
          Export your data
        </Link>
      </Card>

      <Card>
        <h2 className="font-display text-lg text-bark">Your plan</h2>
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <span className="font-display text-2xl text-bark">{plan.name}</span>
          <span className="text-sm text-slate-soft">{money(plan.monthlyCents)}/month</span>
          <span className="rounded-full bg-linen px-2.5 py-1 text-xs text-bark">
            {formatBps(plan.platformFeeBps)} platform fee on card sales
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-soft">
          {salesThisMonth} card {salesThisMonth === 1 ? "sale" : "sales"} this month. Cash sales
          carry no processing or platform fee at all — only the subscription applies.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-soft">
          Your platform fee is capped at {money(plan.maxPlatformFeeCents ?? 0)} a month — it
          stops growing once card sales pass{" "}
          {money(feeCapVolumeCents(plan.id) ?? 0)}. The most you can pay ThriftOS in any month
          is {money(maxMonthlyCostCents(plan.id))}, whatever you take.
        </p>
        <p className="mt-2 text-xs text-slate-soft">
          {aiUsed} photo reads used this month.
        </p>
      </Card>

      <Card>
        <h2 className="font-display text-lg text-bark">What's switched on</h2>
        <ul className="mt-3 space-y-3">
          {integrations.map((item) => (
            <li key={item.key} className="border-b border-line pb-3 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-bark">{item.label}</span>
                {item.live ? (
                  <Badge color="#2F6F5E">Live</Badge>
                ) : (
                  <Badge color="#B8860B">Not yet</Badge>
                )}
              </div>
              {!item.live ? (
                <>
                  <p className="mt-1 text-xs leading-relaxed text-slate-soft">{item.fallback}</p>
                  <code className="mt-1.5 block rounded-lg bg-linen px-3 py-1.5 text-xs text-bark">
                    {item.activate}
                  </code>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="font-display text-lg text-bark">What NRI will never do</h2>
        <ul className="mt-3 space-y-3">
          {TRUST_BOUNDARIES.map((boundary) => (
            <li key={boundary.statement}>
              <p className="text-sm font-medium text-bark">{boundary.statement}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-soft">{boundary.detail}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
