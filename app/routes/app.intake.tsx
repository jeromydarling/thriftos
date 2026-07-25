import { useRef, useState } from "react";
import { Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/app.intake";
import { requireUser } from "../lib/auth";
import { all, first, run } from "../lib/db";
import { newId } from "../lib/ids";
import { envFrom } from "../lib/env";
import { tagColorForIntake, TAG_COLOR_HEX, type MarkdownRule } from "../lib/markdown";
import { findOrCreateContact } from "../lib/contacts";
import { Badge, Button, Card, Field, Input, Notice, Select, Textarea } from "../components/ui";
import { AiGuessNote } from "../components/Compass";
import type { ItemExtraction } from "../lib/ai";

export function meta() {
  return [{ title: "Log an item | ThriftOS" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);

  const [locations, rules, recent] = await Promise.all([
    all<{ id: string; name: string; is_default: number }>(
      env.DB,
      `SELECT id, name, is_default FROM locations WHERE org_id = ? ORDER BY is_default DESC, name`,
      user.orgId
    ),
    all<{ tag_color: string; week_index: number; discount_pct: number; age_days: number }>(
      env.DB,
      `SELECT tag_color, week_index, discount_pct, age_days FROM markdown_rules
        WHERE org_id = ? AND is_active = 1 ORDER BY week_index`,
      user.orgId
    ),
    all<{ id: string; title: string; price_cents: number; tag_color: string | null }>(
      env.DB,
      `SELECT id, title, price_cents, tag_color FROM items
        WHERE org_id = ? ORDER BY created_at DESC LIMIT 5`,
      user.orgId
    ),
  ]);

  return {
    locations,
    rules: rules.map((r) => ({
      tagColor: r.tag_color,
      weekIndex: r.week_index,
      discountPct: r.discount_pct,
      ageDays: r.age_days,
    })),
    recent,
    aiAvailable: Boolean(env.AI),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const form = await request.formData();

  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "An item needs a name — even just 'blue mug' is plenty." };

  const priceDollars = parseFloat(String(form.get("price") ?? "0"));
  const retailDollars = parseFloat(String(form.get("retail") ?? "0"));
  const weight = parseFloat(String(form.get("weight") ?? "0"));
  const intakeDate = new Date().toISOString().slice(0, 10);

  const rules = await all<{ tag_color: string; week_index: number; discount_pct: number; age_days: number }>(
    env.DB,
    `SELECT tag_color, week_index, discount_pct, age_days FROM markdown_rules
      WHERE org_id = ? AND is_active = 1 ORDER BY week_index`,
    user.orgId
  );
  const markdownRules: MarkdownRule[] = rules.map((r) => ({
    tagColor: r.tag_color,
    weekIndex: r.week_index,
    discountPct: r.discount_pct,
    ageDays: r.age_days,
  }));

  // Optional donor. Recording who gave it is what lets us close the loop later.
  const donorName = String(form.get("donor_name") ?? "").trim();
  const donorEmail = String(form.get("donor_email") ?? "").trim();
  let donationId: string | null = null;

  if (donorName || donorEmail) {
    const contactId = await findOrCreateContact(env.DB, {
      orgId: user.orgId,
      name: donorName || null,
      email: donorEmail || null,
      roles: ["donor"],
    });
    donationId = newId("donation");
    await run(
      env.DB,
      `INSERT INTO donations (id, org_id, contact_id, kind, received_by, item_count, est_weight_lbs, description)
       VALUES (?, ?, ?, 'goods', ?, 1, ?, ?)`,
      donationId,
      user.orgId,
      contactId,
      user.id,
      Number.isFinite(weight) ? weight : 0,
      title
    );
  }

  const priceCents = Number.isFinite(priceDollars) ? Math.round(priceDollars * 100) : 0;
  const retailCents = Number.isFinite(retailDollars) ? Math.round(retailDollars * 100) : 0;

  const itemId = newId("item");
  await run(
    env.DB,
    `INSERT INTO items
       (id, org_id, location_id, donation_id, tag_number, title, description, category, brand,
        color, size, material, era, condition, condition_notes, price_cents, original_price_cents,
        retail_estimate_cents, weight_lbs, tag_color, intake_date, status, photo_key,
        ai_json, ai_confidence, ai_accepted, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?, ?)`,
    itemId,
    user.orgId,
    String(form.get("location_id") ?? "") || null,
    donationId,
    String(form.get("tag_number") ?? "").trim() || null,
    title,
    String(form.get("description") ?? "").trim() || null,
    String(form.get("category") ?? "").trim() || null,
    String(form.get("brand") ?? "").trim() || null,
    String(form.get("color") ?? "").trim() || null,
    String(form.get("size") ?? "").trim() || null,
    String(form.get("material") ?? "").trim() || null,
    String(form.get("era") ?? "").trim() || null,
    String(form.get("condition") ?? "good"),
    String(form.get("condition_notes") ?? "").trim() || null,
    priceCents,
    priceCents,
    retailCents,
    Number.isFinite(weight) ? weight : 0,
    tagColorForIntake(intakeDate, markdownRules),
    intakeDate,
    String(form.get("photo_key") ?? "") || null,
    String(form.get("ai_json") ?? "") || null,
    parseFloat(String(form.get("ai_confidence") ?? "")) || null,
    // Did the human keep the guess untouched? Useful for judging whether the
    // model is actually helping, rather than assuming it is.
    form.get("ai_edited") === "0" ? 1 : 0,
    user.id
  );

  return redirect("/app/intake?saved=1");
}

interface Suggestion {
  photoKey: string;
  photoUrl: string;
  suggestion: ItemExtraction | null;
  confidence: { label: string; tone: string } | null;
  degraded: boolean;
  message: string | null;
}

export default function Intake({ loaderData, actionData }: Route.ComponentProps) {
  const { locations, rules, recent, aiAvailable } = loaderData;
  const [analysis, setAnalysis] = useState<Suggestion | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [edited, setEdited] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  const saved =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("saved");

  async function onPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    setEdited(false);

    try {
      const body = new FormData();
      body.append("photo", file);
      const res = await fetch("/api/intake/photo", { method: "POST", body });
      const data = (await res.json()) as Suggestion & { error?: string };
      if (!res.ok) {
        setUploadError(data.error ?? "That didn't work. You can still type the item in.");
        return;
      }
      setAnalysis(data);
    } catch {
      setUploadError("The upload didn't get through. Check your connection, or type it in.");
    } finally {
      setUploading(false);
    }
  }

  const s = analysis?.suggestion;
  const todayColor = tagColorForIntake(new Date().toISOString().slice(0, 10), rules);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-bark">Log an item</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-soft">
          Take a photo and correct what's wrong — it's faster than typing from scratch.
          Or skip the photo entirely and fill it in yourself.
        </p>
      </div>

      {saved ? <Notice tone="good">Saved. Ready for the next one.</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-4">
          <Card>
            <h2 className="font-display text-lg text-bark">Photo</h2>

            {analysis?.photoUrl ? (
              <img
                src={`${analysis.photoUrl}?w=600`}
                alt=""
                className="mt-3 aspect-square w-full rounded-xl object-cover"
              />
            ) : (
              <div className="mt-3 flex aspect-square w-full items-center justify-center rounded-xl border border-dashed border-line bg-linen/60 text-sm text-slate-soft">
                No photo yet
              </div>
            )}

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPhoto}
              className="hidden"
            />

            <Button
              type="button"
              variant="secondary"
              className="mt-3 w-full"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? "Reading the photo…" : analysis ? "Use a different photo" : "Take a photo"}
            </Button>

            {!aiAvailable ? (
              <p className="mt-3 text-xs leading-relaxed text-slate-soft">
                Photo reading isn't switched on. Photos are still saved with the item.
              </p>
            ) : null}

            {uploadError ? (
              <div className="mt-3">
                <Notice tone="warn">{uploadError}</Notice>
              </div>
            ) : null}

            {analysis?.message ? (
              <div className="mt-3">
                <Notice>{analysis.message}</Notice>
              </div>
            ) : null}

            {s && analysis?.confidence ? (
              <div className="mt-3 rounded-xl border border-line bg-linen/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs uppercase tracking-wide text-slate-soft">
                    How sure it is
                  </span>
                  <Badge
                    color={
                      analysis.confidence.tone === "high"
                        ? "#2F6F5E"
                        : analysis.confidence.tone === "medium"
                          ? "#B8860B"
                          : "#B8543F"
                    }
                  >
                    {analysis.confidence.label}
                  </Badge>
                </div>
                <div className="mt-2">
                  <AiGuessNote />
                </div>
              </div>
            ) : null}
          </Card>

          <Card>
            <h2 className="font-display text-base text-bark">Today's tag</h2>
            <div className="mt-2 flex items-center gap-2">
              <span
                className="inline-block h-6 w-6 rounded-full border border-line"
                style={{ backgroundColor: TAG_COLOR_HEX[todayColor] ?? "#ccc" }}
              />
              <span className="text-sm capitalize text-bark">{todayColor}</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-soft">
              Everything logged today gets this colour, and steps down in price as it ages.
              You set the schedule in Settings.
            </p>
          </Card>
        </div>

        <Card>
          <Form method="post" className="space-y-4" onChange={() => setEdited(true)}>
            <input type="hidden" name="photo_key" value={analysis?.photoKey ?? ""} />
            <input type="hidden" name="ai_json" value={s ? JSON.stringify(s) : ""} />
            <input type="hidden" name="ai_confidence" value={s?.confidence ?? ""} />
            <input type="hidden" name="ai_edited" value={edited ? "1" : "0"} />

            <Field label="What is it?" name="title">
              <Input
                key={`title-${s?.title ?? ""}`}
                id="title"
                name="title"
                required
                defaultValue={s?.title ?? ""}
                placeholder="Blue wool peacoat"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Price" name="price" hint="What it rings up at today.">
                <Input
                  key={`price-${s?.suggestedPriceLowCents ?? ""}`}
                  id="price"
                  name="price"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={
                    s?.suggestedPriceLowCents ? (s.suggestedPriceLowCents / 100).toFixed(2) : ""
                  }
                />
              </Field>

              <Field
                label="Comparable new price"
                name="retail"
                hint="Optional. Powers the value-delivered figure on your impact report."
              >
                <Input
                  key={`retail-${s?.retailEstimateCents ?? ""}`}
                  id="retail"
                  name="retail"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={
                    s?.retailEstimateCents ? (s.retailEstimateCents / 100).toFixed(2) : ""
                  }
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category" name="category">
                <Input key={`cat-${s?.category ?? ""}`} id="category" name="category" defaultValue={s?.category ?? ""} />
              </Field>
              <Field label="Condition" name="condition">
                <Select key={`cond-${s?.condition ?? ""}`} id="condition" name="condition" defaultValue={s?.condition ?? "good"}>
                  <option value="new">New with tags</option>
                  <option value="excellent">Excellent</option>
                  <option value="good">Good</option>
                  <option value="fair">Fair</option>
                  <option value="flawed">Has a flaw</option>
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Colour" name="color">
                <Input key={`color-${s?.color ?? ""}`} id="color" name="color" defaultValue={s?.color ?? ""} />
              </Field>
              <Field label="Size" name="size">
                <Input key={`size-${s?.size ?? ""}`} id="size" name="size" defaultValue={s?.size ?? ""} />
              </Field>
              <Field label="Brand" name="brand">
                <Input key={`brand-${s?.brand ?? ""}`} id="brand" name="brand" defaultValue={s?.brand ?? ""} />
              </Field>
            </div>

            <Field
              label="Anything wrong with it?"
              name="condition_notes"
              hint="Say so plainly. A shopper surprised by a stain doesn't come back."
            >
              <Input
                key={`flaws-${s?.conditionNotes ?? ""}`}
                id="condition_notes"
                name="condition_notes"
                defaultValue={s?.conditionNotes ?? ""}
              />
            </Field>

            <Field label="Description" name="description" hint="Shown on your public storefront.">
              <Textarea
                key={`desc-${s?.description ?? ""}`}
                id="description"
                name="description"
                rows={3}
                defaultValue={s?.description ?? ""}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Tag number" name="tag_number">
                <Input id="tag_number" name="tag_number" />
              </Field>
              <Field label="Weight (lbs)" name="weight" hint="Feeds diversion reporting.">
                <Input id="weight" name="weight" type="number" step="0.1" min="0" />
              </Field>
              <Field label="Where is it?" name="location_id">
                <Select id="location_id" name="location_id">
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <details className="rounded-xl border border-line px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-bark">
                Who donated it? (optional)
              </summary>
              <p className="mt-2 text-xs leading-relaxed text-slate-soft">
                Recording the donor lets you send a receipt later, and lets NRI tell them
                when their things found a home.
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Name" name="donor_name">
                  <Input id="donor_name" name="donor_name" />
                </Field>
                <Field label="Email" name="donor_email">
                  <Input id="donor_email" name="donor_email" type="email" />
                </Field>
              </div>
            </details>

            {actionData?.error ? <Notice tone="warn">{actionData.error}</Notice> : null}

            <div className="flex items-center gap-3 border-t border-line pt-4">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save and log another"}
              </Button>
              <p className="text-xs text-slate-soft">Nothing is saved until you press this.</p>
            </div>
          </Form>
        </Card>
      </div>

      {recent.length > 0 ? (
        <Card>
          <h2 className="font-display text-base text-bark">Just logged</h2>
          <ul className="mt-3 divide-y divide-line text-sm">
            {recent.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                <span className="flex items-center gap-2 text-bark">
                  <span
                    className="inline-block h-3 w-3 rounded-full border border-line"
                    style={{ backgroundColor: TAG_COLOR_HEX[item.tag_color ?? ""] ?? "#ddd" }}
                  />
                  {item.title}
                </span>
                <span className="text-slate-soft">
                  ${(item.price_cents / 100).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
