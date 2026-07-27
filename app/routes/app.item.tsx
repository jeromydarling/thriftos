import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/app.item";
import { requireUser } from "../lib/auth";
import { envFrom } from "../lib/env";
import { all } from "../lib/db";
import {
  CONDITIONS,
  ITEM_STATUSES,
  ItemEditError,
  isHeld,
  itemById,
  moneyIsSettled,
  readItemForm,
  saveItem,
} from "../lib/item-edit";
import {
  DEFAULT_MARKDOWN_RULES,
  TAG_COLOR_HEX,
  currentDiscountPct,
  effectivePriceCents,
  nextMarkdown,
} from "../lib/markdown";
import { Badge, Button, Card, Field, Input, Notice, Select, Textarea, money } from "../components/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.item ? `${loaderData.item.title} | ThriftOS` : "Item | ThriftOS" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);

  const item = await itemById(env.DB, user.orgId, params.id ?? "");
  if (!item) throw new Response("Not found", { status: 404 });

  const [locations, rules] = await Promise.all([
    all<{ id: string; name: string }>(
      env.DB,
      `SELECT id, name FROM locations WHERE org_id = ? ORDER BY name`,
      user.orgId
    ),
    all<{ tag_color: string; week_index: number; discount_pct: number; age_days: number }>(
      env.DB,
      `SELECT tag_color, week_index, discount_pct, age_days FROM markdown_rules
        WHERE org_id = ? AND is_active = 1 ORDER BY week_index`,
      user.orgId
    ),
  ]);

  const ladder =
    rules.length > 0
      ? rules.map((r) => ({
          tagColor: r.tag_color,
          weekIndex: r.week_index,
          discountPct: r.discount_pct,
          ageDays: r.age_days,
        }))
      : DEFAULT_MARKDOWN_RULES;

  const shape = {
    priceCents: item.price_cents,
    tagColor: item.tag_color,
    intakeDate: item.intake_date,
  };

  return {
    item,
    locations,
    settled: moneyIsSettled(item),
    held: isHeld(item),
    pricing: {
      effectiveCents: effectivePriceCents(shape, ladder),
      discountPct: currentDiscountPct(shape, ladder),
      next: nextMarkdown(shape, ladder),
    },
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const form = await request.formData();

  try {
    const { changed } = await saveItem(env.DB, {
      orgId: user.orgId,
      userId: user.id,
      itemId: params.id ?? "",
      edits: readItemForm(form),
    });

    if (changed.length === 0) return { ok: "Nothing to change — it's already like that." };
    return {
      ok: `Saved. ${changed.length} ${changed.length === 1 ? "field" : "fields"} updated.`,
    };
  } catch (err) {
    if (err instanceof ItemEditError) return { error: err.message };
    return { error: "That didn't save. Nothing has been changed." };
  }
}

const STATUS_LABEL: Record<string, string> = {
  available: "On the floor",
  held: "Held — being paid for",
  sold: "Sold",
  recycled: "Recycled",
  pulled: "Pulled from the floor",
};

const STATUS_TONE: Record<string, string> = {
  available: "#2F6F5E",
  held: "#B8860B",
  sold: "#6B7280",
  recycled: "#6B7280",
  pulled: "#B8543F",
};

export default function ItemDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { item, locations, settled, held, pricing } = loaderData;
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const photo =
    item.photo_enhanced_at && item.photo_enhanced_key ? item.photo_enhanced_key : item.photo_key;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          to="/app/inventory"
          className="inline-block py-1 text-sm text-moss underline underline-offset-2"
        >
          ← Back to inventory
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-display text-3xl text-bark">{item.title}</h1>
          <Badge color={STATUS_TONE[item.status] ?? "#6B7280"}>
            {STATUS_LABEL[item.status] ?? item.status}
          </Badge>
        </div>
      </div>

      {actionData && "ok" in actionData && actionData.ok ? (
        <Notice tone="good">{actionData.ok}</Notice>
      ) : null}
      {actionData && "error" in actionData && actionData.error ? (
        <Notice tone="warn">{actionData.error}</Notice>
      ) : null}

      {settled ? (
        <Notice>
          This one is sold. You can still correct how it's described — the price and the status
          are fixed, because they're what the customer paid and what your figures already say.
        </Notice>
      ) : null}
      {held && !settled ? (
        <Notice tone="warn">
          Somebody is part-way through paying for this. It clears itself within half an hour if
          they don't finish.
        </Notice>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-start gap-5">
          {photo ? (
            <img
              src={`/api/media/${photo}?w=320`}
              alt={item.title}
              width={160}
              height={160}
              className="h-40 w-40 shrink-0 rounded-xl border border-line object-cover"
            />
          ) : (
            <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-xl border border-dashed border-line text-center text-xs text-slate-soft">
              No photograph
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <p className="text-slate-soft">
              Rings up at{" "}
              <strong className="text-bark">{money(pricing.effectiveCents)}</strong>
              {pricing.discountPct > 0 ? (
                <>
                  {" "}
                  — {pricing.discountPct}% off the {money(item.price_cents)} on its tag
                </>
              ) : null}
            </p>
            {pricing.next && !settled ? (
              <p className="text-slate-soft">
                Drops to {pricing.next.toPct}% off in {pricing.next.inDays} days.
              </p>
            ) : null}
            <p className="text-slate-soft">
              Taken in {new Date(`${item.intake_date}T00:00:00Z`).toLocaleDateString()}
              {item.tag_number ? ` · tag ${item.tag_number}` : ""}
            </p>
            {item.sold_at ? (
              <p className="text-slate-soft">
                Sold {new Date(`${item.sold_at}Z`).toLocaleDateString()} for{" "}
                {money(item.sold_price_cents ?? 0)}.
              </p>
            ) : null}
            {item.photo_key ? (
              <p className="pt-1">
                <Link
                  to="/app/photos"
                  className="inline-block py-1 text-moss underline underline-offset-2"
                >
                  Tidy up the photograph
                </Link>
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <Form method="post">
        <Card>
          <h2 className="font-display text-lg text-bark">What it is</h2>
          <div className="mt-4 space-y-4">
            <Field label="Name" name="title">
              <Input id="title" name="title" defaultValue={item.title} required />
            </Field>

            <Field
              label="Description"
              name="description"
              hint="What a shopper should know. Wear included — it saves a return."
            >
              <Textarea
                id="description"
                name="description"
                rows={3}
                defaultValue={item.description ?? ""}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category" name="category">
                <Input id="category" name="category" defaultValue={item.category ?? ""} />
              </Field>
              <Field label="Brand" name="brand">
                <Input id="brand" name="brand" defaultValue={item.brand ?? ""} />
              </Field>
              <Field label="Colour" name="color">
                <Input id="color" name="color" defaultValue={item.color ?? ""} />
              </Field>
              <Field label="Size" name="size">
                <Input id="size" name="size" defaultValue={item.size ?? ""} />
              </Field>
              <Field label="Material" name="material">
                <Input id="material" name="material" defaultValue={item.material ?? ""} />
              </Field>
              <Field label="Condition" name="condition">
                <Select id="condition" name="condition" defaultValue={item.condition}>
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field
              label="Anything worth flagging"
              name="condition_notes"
              hint="A mark, a missing button, a repair. Shown on the listing."
            >
              <Input
                id="condition_notes"
                name="condition_notes"
                defaultValue={item.condition_notes ?? ""}
              />
            </Field>
          </div>
        </Card>

        <Card className="mt-6">
          <h2 className="font-display text-lg text-bark">Price and tag</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Price"
              name="price"
              hint={settled ? "Fixed — this is what the customer paid." : "What's on the tag, before any markdown."}
            >
              <Input
                id="price"
                name="price"
                inputMode="decimal"
                defaultValue={(item.price_cents / 100).toFixed(2)}
                disabled={settled}
              />
            </Field>
            <Field label="Worth new, roughly" name="retail" hint="Feeds your value-delivered figure.">
              <Input
                id="retail"
                name="retail"
                inputMode="decimal"
                defaultValue={(item.retail_estimate_cents / 100).toFixed(2)}
              />
            </Field>
            <Field label="Tag colour" name="tag_color" hint="Decides when it marks down.">
              <Select id="tag_color" name="tag_color" defaultValue={item.tag_color ?? ""}>
                <option value="">No tag</option>
                {Object.keys(TAG_COLOR_HEX).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tag number" name="tag_number">
              <Input id="tag_number" name="tag_number" defaultValue={item.tag_number ?? ""} />
            </Field>
            <Field label="Weight (lbs)" name="weight_lbs" hint="Prices postage and feeds diversion.">
              <Input
                id="weight_lbs"
                name="weight_lbs"
                inputMode="decimal"
                defaultValue={String(item.weight_lbs)}
              />
            </Field>
            <Field label="Where it lives" name="location_id">
              <Select id="location_id" name="location_id" defaultValue={item.location_id ?? ""}>
                <option value="">Not recorded</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {/* Price is disabled when sold, and a disabled input sends nothing —
              which would read as "changed to 0" and be refused. Sent here so
              the rest of the form can still be saved on a sold item. */}
          {settled ? (
            <input type="hidden" name="price" value={(item.price_cents / 100).toFixed(2)} />
          ) : null}
        </Card>

        <Card className="mt-6">
          <h2 className="font-display text-lg text-bark">Status</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-soft">
            Pulled means it's off the floor but still yours — being repaired, washed, or held
            back for a sale. Recycled means it left without being sold, and it counts toward
            what you diverted rather than what you sold.
          </p>
          <div className="mt-4 max-w-xs">
            <Field label="Where it stands" name="status">
              <Select
                id="status"
                name="status"
                defaultValue={item.status}
                disabled={settled || held}
              >
                {ITEM_STATUSES.filter((s) => s !== "held" || item.status === "held").map((s) => (
                  <option key={s} value={s} disabled={s === "sold" && item.status !== "sold"}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {settled || held ? (
            <input type="hidden" name="status" value={item.status} />
          ) : null}
        </Card>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
          <Link
            to="/app/inventory"
            className="touch-target inline-flex items-center rounded-xl border border-line px-5 py-3 font-medium text-bark hover:bg-linen"
          >
            Cancel
          </Link>
        </div>
      </Form>
    </div>
  );
}
