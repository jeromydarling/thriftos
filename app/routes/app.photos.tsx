import { useState } from "react";
import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/app.photos";
import { requireUser } from "../lib/auth";
import { envFrom } from "../lib/env";
import { all, first } from "../lib/db";
import { decideEnhancedPhoto, enhanceItemPhoto } from "../lib/enhance";
import {
  DEFAULT_GROUND,
  DEFAULT_STYLE,
  PHOTO_STYLES,
  isGround,
  isPhotoStyle,
  styleInfo,
  SEAMLESS,
  type Ground,
  type PhotoStyle,
} from "../lib/photos";
import { ENHANCE_EXPLAINER } from "../lib/photos";
import { LIMITS, rateLimit } from "../lib/ratelimit";
import { Button, Card, EmptyState, LinkButton, Notice } from "../components/ui";
import { ToastFrom } from "../components/toast";

export function meta() {
  return [{ title: "Photos | ThriftOS" }];
}

/**
 * The photo bench.
 *
 * A shop does this work in sittings, not one item at a time, so this is a
 * screen rather than a button hidden on an item page. Two piles: cut-outs
 * waiting for somebody to look at them, and photographs that haven't been
 * tidied yet.
 *
 * Nothing here is automatic. A cut-out is a guess about what an item looks
 * like, and a guess about a used item is not something to put in front of a
 * shopper — so every one of them waits for a person to say yes.
 */
const PAGE = 12;

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);

  const [waiting, todo, counts] = await Promise.all([
    all<{
      id: string;
      title: string;
      photo_key: string;
      photo_enhanced_key: string;
      photo_style: string | null;
      photo_ground: string | null;
    }>(
      env.DB,
      `SELECT id, title, photo_key, photo_enhanced_key, photo_style, photo_ground
         FROM items
        WHERE org_id = ? AND photo_enhanced_key IS NOT NULL AND photo_enhanced_at IS NULL
        ORDER BY updated_at DESC
        LIMIT ?`,
      user.orgId,
      PAGE
    ),
    all<{ id: string; title: string; photo_key: string }>(
      env.DB,
      `SELECT id, title, photo_key
         FROM items
        WHERE org_id = ? AND status = 'available'
          AND photo_key IS NOT NULL AND photo_enhanced_key IS NULL
        ORDER BY created_at DESC
        LIMIT ?`,
      user.orgId,
      PAGE
    ),
    first<{ tidied: number; untidied: number; unphotographed: number }>(
      env.DB,
      `SELECT
         SUM(CASE WHEN photo_enhanced_at IS NOT NULL THEN 1 ELSE 0 END) AS tidied,
         SUM(CASE WHEN status = 'available' AND photo_key IS NOT NULL
                       AND photo_enhanced_key IS NULL THEN 1 ELSE 0 END) AS untidied,
         SUM(CASE WHEN status = 'available' AND photo_key IS NULL THEN 1 ELSE 0 END)
           AS unphotographed
       FROM items WHERE org_id = ?`,
      user.orgId
    ),
  ]);

  return {
    waiting,
    todo,
    available: env.IMAGES !== undefined,
    counts: {
      tidied: Number(counts?.tidied ?? 0),
      untidied: Number(counts?.untidied ?? 0),
      unphotographed: Number(counts?.unphotographed ?? 0),
    },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const form = await request.formData();

  const intent = String(form.get("intent") ?? "");
  const itemId = String(form.get("itemId") ?? "");

  if (intent === "keep" || intent === "discard") {
    const result = await decideEnhancedPhoto(env, user.orgId, itemId, intent === "keep");
    if (!result.ok) return { error: result.error ?? "That didn't work." };
    return {
      ok:
        intent === "keep"
          ? "Kept. It's on the listing now."
          : "Thrown away. The original photo is still there, untouched.",
    };
  }

  if (intent === "enhance") {
    // The same ceiling the API uses, because it's the same expensive call —
    // a shop that clicks through fifty of these shouldn't discover the limit
    // only when it switches screens.
    const limit = await rateLimit(env.KV, `enhance:${user.orgId}`, LIMITS.aiIntake);
    if (!limit.allowed) return { error: "That's a lot at once. Give it a minute." };

    const style = String(form.get("style") ?? "");
    const ground = String(form.get("ground") ?? "");

    const result = await enhanceItemPhoto(env, user.orgId, itemId, {
      style: isPhotoStyle(style) ? style : undefined,
      ground: isGround(ground) ? ground : undefined,
    });
    if (!result.ok) return { error: result.error ?? "That didn't work." };
    return { ok: "Tidied up. Have a look and say whether to keep it." };
  }

  return { error: "That action isn't one we know." };
}

export default function Photos({ loaderData, actionData }: Route.ComponentProps) {
  const { waiting, todo, counts, available } = loaderData;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const pending = nav.formData?.get("itemId");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl text-bark">Photos</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-soft">
          Cut the item out of whatever it was photographed against and put it on a clean, even
          background, so a page of listings looks like a shop rather than a car boot sale.
        </p>
      </header>

      <ToastFrom data={actionData} />

      {!available ? (
        <Notice tone="warn">
          Photo tidy-up isn't switched on for this shop yet. Everything else on this page still
          works — your original photographs are on your listings as they always were.
        </Notice>
      ) : null}

      <Card>
        <h2 className="font-display text-lg text-bark">What this does, and what it doesn't</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-soft">
          {ENHANCE_EXPLAINER.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>

      {/* The review pile comes first: work already done that a person is
          holding up. Leaving it below the to-do list is how it never gets done. */}
      <section>
        <h2 className="font-display text-xl text-bark">
          Waiting on you {waiting.length > 0 ? `· ${waiting.length}` : ""}
        </h2>
        {waiting.length === 0 ? (
          <p className="mt-2 text-sm text-slate-soft">
            Nothing to look at. Tidy one up below and it'll appear here.
          </p>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {waiting.map((item) => (
              <Card key={item.id}>
                <p className="font-medium text-bark">{item.title}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <figure>
                    <img
                      src={`/api/media/${item.photo_key}?w=400`}
                      alt={`${item.title}, as photographed`}
                      width={400}
                      height={400}
                      loading="lazy"
                      className="aspect-square w-full rounded-xl border border-line object-cover"
                    />
                    <figcaption className="mt-1 text-xs text-slate-soft">As photographed</figcaption>
                  </figure>
                  <figure>
                    <img
                      src={`/api/media/${item.photo_enhanced_key}?w=400`}
                      alt={`${item.title}, tidied up`}
                      width={400}
                      height={400}
                      loading="lazy"
                      className="aspect-square w-full rounded-xl border border-line object-contain"
                    />
                    <figcaption className="mt-1 text-xs text-slate-soft">
                      {styleInfo((item.photo_style ?? DEFAULT_STYLE) as PhotoStyle).label}
                      {item.photo_ground === "dark" ? " · dark" : ""}
                    </figcaption>
                  </figure>
                </div>
                <Form method="post" className="mt-3 flex flex-wrap gap-2">
                  <input type="hidden" name="itemId" value={item.id} />
                  <Button type="submit" name="intent" value="keep" disabled={busy}>
                    Use this one
                  </Button>
                  <Button
                    type="submit"
                    name="intent"
                    value="discard"
                    variant="secondary"
                    disabled={busy}
                  >
                    No — keep the original
                  </Button>
                </Form>

                {/* Try another one without going back to the other list. The
                    style that suits a cream mug is not the one that suits a
                    navy coat, and finding that out takes two clicks. */}
                <Form method="post" className="mt-3 border-t border-line pt-3">
                  <input type="hidden" name="itemId" value={item.id} />
                  <StylePicker
                    id={item.id}
                    style={(item.photo_style ?? DEFAULT_STYLE) as PhotoStyle}
                    ground={item.photo_ground === "dark" ? "dark" : "light"}
                    disabled={busy || !available}
                    label="Try a different look"
                  />
                </Form>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-line pt-6">
        <h2 className="font-display text-xl text-bark">
          Not tidied yet {counts.untidied > 0 ? `· ${counts.untidied}` : ""}
        </h2>

        {todo.length === 0 ? (
          <EmptyState
            title={
              counts.unphotographed > 0
                ? `${counts.unphotographed} ${counts.unphotographed === 1 ? "item has" : "items have"} no photograph`
                : "Everything's been through"
            }
            body={
              counts.unphotographed > 0
                ? "There's nothing to tidy until there's a photograph. Log an item with its photo and it'll turn up here."
                : "Every photographed item on the floor has been tidied up or looked at."
            }
            action={<LinkButton to="/app/intake">Log an item</LinkButton>}
          />
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {todo.map((item) => (
              <Form method="post" key={item.id} className="rounded-2xl border border-line bg-white p-3">
                <input type="hidden" name="itemId" value={item.id} />
                <img
                  src={`/api/media/${item.photo_key}?w=320`}
                  alt={item.title}
                  width={320}
                  height={320}
                  loading="lazy"
                  className="aspect-square w-full rounded-xl border border-line object-cover"
                />
                <p className="mt-2 line-clamp-2 text-sm text-bark">{item.title}</p>
                <StylePicker
                  id={item.id}
                  style={DEFAULT_STYLE}
                  ground={DEFAULT_GROUND}
                  disabled={busy || !available}
                  label={busy && pending === item.id ? "Tidying…" : "Tidy this up"}
                />
              </Form>
            ))}
          </div>
        )}

        {counts.untidied > todo.length ? (
          <p className="mt-3 text-sm text-slate-soft">
            Showing {todo.length} of {counts.untidied}. Work through these and the next lot appears.
          </p>
        ) : null}
      </section>

      {counts.tidied > 0 ? (
        <p className="border-t border-line pt-4 text-sm text-slate-soft">
          {counts.tidied} {counts.tidied === 1 ? "listing is" : "listings are"} using a tidied-up
          photograph. Every one still links to the original, so a shopper can see exactly what you
          photographed.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Style and ground, as two rows of radio buttons and a button.
 *
 * Radios rather than a dropdown because there are five choices in total and a
 * volunteer should be able to see them all without opening anything. Native
 * inputs rather than a custom control because this has to work on a tablet
 * with a cracked screen, and a `<label>` wrapping a radio is the most reliable
 * tap target there is.
 *
 * The ground row disappears for the softened style, which has no ground —
 * offering a colour that does nothing is a promise the picture won't keep.
 */
function StylePicker({
  id,
  style,
  ground,
  disabled,
  label,
}: {
  id: string;
  style: PhotoStyle;
  ground: Ground;
  disabled: boolean;
  label: string;
}) {
  const [chosen, setChosen] = useState<PhotoStyle>(style);
  const info = styleInfo(chosen);

  return (
    <div>
      <fieldset className="mt-2">
        <legend className="sr-only">How to tidy it up</legend>
        <div className="flex flex-wrap gap-1">
          {PHOTO_STYLES.map((s) => (
            <label
              key={s.id}
              className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs ${
                chosen === s.id
                  ? "border-moss bg-moss/10 font-medium text-moss"
                  : "border-line text-slate-soft hover:bg-linen"
              }`}
            >
              <input
                type="radio"
                name="style"
                value={s.id}
                defaultChecked={style === s.id}
                onChange={() => setChosen(s.id)}
                className="sr-only"
              />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>

      <p className="mt-1.5 text-xs leading-relaxed text-slate-soft">{info.blurb}</p>

      {info.usesGround ? (
        <fieldset className="mt-2">
          <legend className="sr-only">Background</legend>
          <div className="flex flex-wrap gap-1">
            {(["light", "dark"] as Ground[]).map((g) => (
              <label
                key={g}
                className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${
                  "border-line text-slate-soft hover:bg-linen"
                }`}
              >
                <input
                  type="radio"
                  name="ground"
                  value={g}
                  defaultChecked={ground === g}
                  className="h-3.5 w-3.5"
                />
                <span
                  className="inline-block h-3 w-3 rounded-full border border-line"
                  style={{ backgroundColor: SEAMLESS[g] }}
                />
                {g === "light" ? "Light" : "Dark"}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        // The softened style keeps the real background, so there is nothing to
        // choose. Sent anyway, so the stored choice doesn't go stale.
        <input type="hidden" name="ground" value={ground} />
      )}

      <Button
        type="submit"
        name="intent"
        value="enhance"
        variant="secondary"
        className="mt-2 w-full"
        disabled={disabled}
      >
        {label}
      </Button>
    </div>
  );
}
