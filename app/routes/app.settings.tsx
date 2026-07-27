import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/app.settings";
import { requireRole, requireUser } from "../lib/auth";
import { all, first, run } from "../lib/db";
import { newId } from "../lib/ids";
import { SUGGESTED_BANDS, bandsFor } from "../lib/shipping";
import { feedReadiness } from "../lib/feed";
import { DEFAULT_SETTINGS, parseOrgSettings, serialiseOrgSettings } from "../lib/settings";
import { envFrom, integrationStatus } from "../lib/env";
import { TAG_COLOR_HEX } from "../lib/markdown";
import { TRUST_BOUNDARIES } from "../lib/nri/voice";
import { formatBps, getPlan, PLANS } from "../lib/pricing";
import { feeCapVolumeCents, maxMonthlyCostCents } from "../lib/savings";
import { Badge, Button, Card, Field, Input, Notice, Textarea, money } from "../components/ui";
import { ConnectPanel } from "../components/ConnectPanel";
import { canAcceptPayments, getAccount, statusExplanation } from "../lib/stripe/connect";
import { isTestMode, stripeReadiness } from "../lib/stripe/client";
import { ToastFrom } from "../components/toast";
import { failed, ok } from "../lib/toast";

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
  const bands = await bandsFor(env.DB, user.orgId);
  const feed = await feedReadiness(env.DB, user.orgId);

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
    bands: bands.length > 0 ? bands : SUGGESTED_BANDS.map((b, i) => ({ ...b, id: `suggested-${i}` })),
    hasBands: bands.length > 0,
    feed,
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
    return ok("Saved. Your shop's details are used on receipts and your public page.");
  }

  if (intent === "online") {
    const existing = parseOrgSettings(
      (await first<{ settings_json: string }>(
        env.DB,
        `SELECT settings_json FROM orgs WHERE id = ?`,
        user.orgId
      ))?.settings_json
    );

    await run(
      env.DB,
      `UPDATE orgs SET settings_json = ?, updated_at = datetime('now') WHERE id = ?`,
      serialiseOrgSettings({
        ...existing,
        onlineSelling: form.get("onlineSelling") === "on",
        pickupEnabled: form.get("pickupEnabled") === "on",
        pickupInstructions: String(form.get("pickupInstructions") ?? ""),
      }),
      user.orgId
    );
    return ok("Saved. Online selling follows these now.");
  }

  if (intent === "bands") {
    // Rewritten wholesale rather than diffed. Postage bands are a short list a
    // shop edits as a set, and a partial update is how one ends up with an old
    // band nobody meant to keep.
    //
    // Which also means a row deleted here is deleted for good, so the set as
    // it stands is read first and handed back as the undo. It's the same form
    // posted again with the old values — no special path to get wrong.
    const before = await all<{ label: string; max_grams: number; price_cents: number }>(
      env.DB,
      `SELECT label, max_grams, price_cents FROM shipping_bands
        WHERE org_id = ? ORDER BY sort_order, id`,
      user.orgId
    );

    const labels = form.getAll("bandLabel").map(String);
    const grams = form.getAll("bandGrams").map((g) => Math.round(Number(g)));
    const prices = form.getAll("bandPrice").map((p) => Math.round(Number(p) * 100));

    const bands = labels
      .map((label, i) => ({ label: label.trim(), grams: grams[i], price: prices[i] }))
      .filter((b) => b.label && Number.isFinite(b.grams) && b.grams > 0 && Number.isFinite(b.price) && b.price >= 0);

    await run(env.DB, `DELETE FROM shipping_bands WHERE org_id = ?`, user.orgId);
    for (const [i, band] of bands.entries()) {
      await run(
        env.DB,
        `INSERT INTO shipping_bands (id, org_id, label, max_grams, price_cents, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        newId("shippingBand"),
        user.orgId,
        band.label,
        band.grams,
        band.price,
        i
      );
    }
    return ok(
      bands.length === 1 ? "Saved. One postage band." : `Saved. ${bands.length} postage bands.`,
      before.length > 0
        ? {
            undo: {
              fields: {
                intent: "bands",
                bandLabel: before.map((b) => b.label),
                bandGrams: before.map((b) => String(b.max_grams)),
                bandPrice: before.map((b) => (b.price_cents / 100).toFixed(2)),
              },
            },
          }
        : {}
    );
  }

  if (intent === "website") {
    // Same read-modify-write as the register form, for the same reason: this
    // form doesn't show the tax rate and must not blank it.
    const existing = parseOrgSettings(
      (await first<{ settings_json: string }>(
        env.DB,
        `SELECT settings_json FROM orgs WHERE id = ?`,
        user.orgId
      ))?.settings_json
    );

    await run(
      env.DB,
      `UPDATE orgs SET settings_json = ?, updated_at = datetime('now') WHERE id = ?`,
      serialiseOrgSettings({
        ...existing,
        openingHours: String(form.get("opening_hours") ?? ""),
        donationHours: String(form.get("donation_hours") ?? ""),
        accepted: String(form.get("accepted") ?? ""),
        notAccepted: String(form.get("not_accepted") ?? ""),
      }),
      user.orgId
    );
    return ok("Saved. Your public page shows these straight away.");
  }

  if (intent === "register") {
    const taxPct = parseFloat(String(form.get("tax_rate") ?? "0"));
    // Serialised through the shared shape, so the key names here, in the
    // register, and in the server-side pricer are the same by construction.
    // Read what's there before writing, so this form can't erase the fields
    // it doesn't show. The typechecker caught this: adding the website fields
    // to OrgSettings made every partial writer a compile error, which is
    // precisely the protection a free-form blob doesn't give you.
    const existing = parseOrgSettings(
      (await first<{ settings_json: string }>(
        env.DB,
        `SELECT settings_json FROM orgs WHERE id = ?`,
        user.orgId
      ))?.settings_json
    );

    const settings = serialiseOrgSettings({
      ...existing,
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
    return ok("Saved. The register uses these from the next sale.");
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
    return ok("Saved. Prices on the floor follow the new ladder.");
  }

  return failed("We didn't recognise that action.");
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const { org, rules, settings, bands, hasBands, feed, integrations, role, salesThisMonth, aiUsed, connect, testMode } =
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

      <ToastFrom data={actionData} />

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
        <h2 className="font-display text-lg text-bark">Selling online</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-soft">
          Off until you turn it on. Everything on your website stays visible either way — this
          decides whether there's a buy button. You'll also need Stripe connected below; without
          it the button stays hidden rather than leading somewhere that can't take money.
        </p>
        <Form method="post" className="mt-4 space-y-4">
          <input type="hidden" name="intent" value="online" />
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              name="onlineSelling"
              defaultChecked={settings.onlineSelling}
              disabled={!canEdit}
              className="mt-1 h-4 w-4"
            />
            <span className="text-sm text-bark">
              Sell online
              <span className="block text-xs text-slate-soft">
                Shoppers can buy from your own pages. Stock is the same stock — anything sold at
                the counter disappears from the website on its own.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              name="pickupEnabled"
              defaultChecked={settings.pickupEnabled}
              disabled={!canEdit}
              className="mt-1 h-4 w-4"
            />
            <span className="text-sm text-bark">
              Let people pay online and collect in the shop
              <span className="block text-xs text-slate-soft">
                No packing, no postage, nothing to go astray in the post. They get a short code to
                quote at the counter.
              </span>
            </span>
          </label>

          <Field
            label="What to tell someone collecting"
            name="pickupInstructions"
            hint="Where to come and when. Shown after they pay and on their receipt."
          >
            <Textarea
              id="pickupInstructions"
              name="pickupInstructions"
              rows={3}
              defaultValue={settings.pickupInstructions}
              placeholder={"Ask at the counter — we're open Tuesday to Saturday.\nPlease come within two weeks."}
              disabled={!canEdit}
            />
          </Field>

          {canEdit ? <Button type="submit" disabled={busy}>Save</Button> : null}
        </Form>

        {/* An empty feed with no explanation is the failure this whole codebase
            keeps running into. The count and the reason sit together. */}
        {settings.onlineSelling ? (
          <div className="mt-5 rounded-xl border border-line bg-linen/50 p-4 text-sm">
            <p className="text-bark">
              <strong>{feed.listed}</strong>{" "}
              {feed.listed === 1 ? "item is" : "items are"} in your product feed, which is what
              Google Shopping and similar read to send shoppers to your own pages.
            </p>
            {feed.note ? <p className="mt-1 text-slate-soft">{feed.note}</p> : null}
            <p className="mt-2">
              <a
                href={`/${org?.slug ?? ""}/feed.xml`}
                className="text-moss underline underline-offset-2"
                target="_blank"
                rel="noreferrer"
              >
                See the feed
              </a>
            </p>
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 className="font-display text-lg text-bark">Postage</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-soft">
          Priced by weight — the same weight you record at intake for your diversion figures, so
          there's nothing extra to type. An order goes in the cheapest band it fits.
          {hasBands ? null : " These are a starting point; edit them to what you actually pay."}
        </p>
        <Form method="post" className="mt-4 space-y-3">
          <input type="hidden" name="intent" value="bands" />
          {bands.map((band, i) => (
            <div key={band.id ?? i} className="grid gap-2 sm:grid-cols-[1fr_7rem_7rem]">
              <Input
                name="bandLabel"
                defaultValue={band.label}
                aria-label="What this band is"
                disabled={!canEdit}
              />
              <Input
                name="bandGrams"
                type="number"
                min="1"
                defaultValue={band.max_grams}
                aria-label="Up to this many grams"
                disabled={!canEdit}
              />
              <Input
                name="bandPrice"
                type="number"
                step="0.01"
                min="0"
                defaultValue={(band.price_cents / 100).toFixed(2)}
                aria-label="Price"
                disabled={!canEdit}
              />
            </div>
          ))}
          <p className="text-xs text-slate-soft">
            Label · up to how many grams · what you charge. Clear a label to drop that band. An
            order heavier than every band can't be posted — the shopper is told, and offered
            collection instead.
          </p>
          {canEdit ? (
            <Button type="submit" disabled={busy}>
              {hasBands ? "Save postage" : "Use these"}
            </Button>
          ) : null}
        </Form>
      </Card>

      <Card>
        <h2 className="font-display text-lg text-bark">What your website says</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-soft">
          These four go straight onto your public page and onto the printable
          signs in the Studio. Leave one blank and it simply doesn't appear —
          an empty heading or wrong hours in a window are worse than nothing.
        </p>
        <Form method="post" className="mt-4 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="intent" value="website" />
          <Field
            label="When you're open"
            name="opening_hours"
            hint="One line each. Write it how you'd say it — 'Closed bank holidays' is fine."
          >
            <Textarea
              id="opening_hours"
              name="opening_hours"
              rows={4}
              defaultValue={settings.openingHours}
              placeholder={"Tuesday to Saturday, 10 – 5\nSunday, 12 – 4\nClosed Mondays"}
              disabled={!canEdit}
            />
          </Field>
          <Field
            label="When donations can be dropped off"
            name="donation_hours"
            hint="Only if it differs from your opening hours."
          >
            <Textarea
              id="donation_hours"
              name="donation_hours"
              rows={4}
              defaultValue={settings.donationHours}
              placeholder={"Tuesday to Friday, until 4\nPlease don't leave bags outside"}
              disabled={!canEdit}
            />
          </Field>
          <Field label="What you can take" name="accepted" hint="One per line.">
            <Textarea
              id="accepted"
              name="accepted"
              rows={5}
              defaultValue={settings.accepted}
              placeholder={"Clean clothing and shoes\nBooks and records\nKitchenware"}
              disabled={!canEdit}
            />
          </Field>
          <Field
            label="What you can't"
            name="not_accepted"
            hint="Saves your volunteers the same conversation every day."
          >
            <Textarea
              id="not_accepted"
              name="not_accepted"
              rows={5}
              defaultValue={settings.notAccepted}
              placeholder={"Mattresses\nLarge appliances\nAnything damaged or damp"}
              disabled={!canEdit}
            />
          </Field>
          {canEdit ? (
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                Save website details
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
