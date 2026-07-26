import { useCallback, useEffect, useState } from "react";
import type { Route } from "./+types/app.register";
import { requireUser } from "../lib/auth";
import { first, parseSettings } from "../lib/db";
import { envFrom } from "../lib/env";
import { Badge, Button, Card, Input, Notice, money } from "../components/ui";
import { TAG_COLOR_HEX } from "../lib/markdown";
import { enqueue, flush, newOfflineId, queued, type QueuedLine } from "../lib/offline";
import { canAcceptPayments, getAccount } from "../lib/stripe/connect";
import { orgReaders } from "../lib/stripe/terminal";

export function meta() {
  return [{ title: "Register | ThriftOS" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);

  const org = await first<{ settings_json: string; name: string }>(
    env.DB,
    `SELECT settings_json, name FROM orgs WHERE id = ?`,
    user.orgId
  );
  const settings = parseSettings(org?.settings_json);

  // Readers are shown only if the shop can actually take a card. An account
  // still in onboarding would give a cashier a button that always fails.
  const account = await getAccount(env.DB, user.orgId);
  const cardReady = Boolean(env.STRIPE_SECRET_KEY) && Boolean(account && canAcceptPayments(account));

  return {
    orgName: org?.name ?? "",
    taxRateBps: Number(settings.taxRateBps ?? 0),
    roundUpEnabled: settings.roundUpEnabled !== false,
    roundUpCause: String(settings.roundUpCause ?? "our community programs"),
    stripeLive: Boolean(env.STRIPE_SECRET_KEY),
    cardReady,
    readers: cardReady ? await orgReaders(env.DB, user.orgId) : [],
  };
}

type TerminalPhase = "idle" | "starting" | "waiting" | "succeeded" | "failed";

interface LookupItem {
  id: string;
  title: string;
  tagNumber: string | null;
  category: string | null;
  tagColor: string | null;
  listPriceCents: number;
  priceCents: number;
  retailEstimateCents: number;
}

interface CartLine extends QueuedLine {
  key: string;
  tagColor?: string | null;
  listPriceCents?: number;
}

export default function Register({ loaderData }: Route.ComponentProps) {
  const { taxRateBps, roundUpEnabled, roundUpCause, stripeLive, cardReady, readers } = loaderData;

  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LookupItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [roundUp, setRoundUp] = useState(roundUpEnabled);
  const [taxExempt, setTaxExempt] = useState(false);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [needsAttention, setNeedsAttention] = useState<{
    rejected: { offlineId: string; reason: string }[];
    unfulfilled: number;
  }>({ rejected: [], unfulfilled: 0 });

  const [readerId, setReaderId] = useState(readers[0]?.id ?? "");
  const [phase, setPhase] = useState<TerminalPhase>("idle");
  const [terminalTx, setTerminalTx] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);

  // Connection state drives the banner, not the behaviour: the register works
  // the same either way.
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const refreshPending = useCallback(async () => {
    setPending((await queued()).length);
  }, []);

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  // Flush whenever we're online, and on a slow tick in case an event was missed.
  useEffect(() => {
    if (!online) return;
    let cancelled = false;

    const run = async () => {
      const result = await flush();
      if (cancelled) return;
      if (result.synced > 0) {
        setFlash(`${result.synced} queued ${result.synced === 1 ? "sale" : "sales"} synced.`);
      }
      // Anything the server couldn't complete needs a person, not a retry.
      if (result.rejected.length > 0 || result.unfulfilled > 0) {
        setNeedsAttention({ rejected: result.rejected, unfulfilled: result.unfulfilled });
      }
      await refreshPending();
    };

    void run();
    const timer = setInterval(run, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [online, refreshPending]);

  async function search(term: string) {
    setQuery(term);
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/pos/lookup?q=${encodeURIComponent(term)}`);
      if (res.ok) {
        const data = (await res.json()) as { items: LookupItem[] };
        setResults(data.items ?? []);
      }
    } catch {
      // Offline: lookup is unavailable, but manual entry below still works.
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function addItem(item: LookupItem) {
    setCart((c) => [
      ...c,
      {
        key: `${item.id}-${Date.now()}`,
        itemId: item.id,
        title: item.title,
        priceCents: item.priceCents,
        retailEstimateCents: item.retailEstimateCents,
        tagColor: item.tagColor,
        listPriceCents: item.listPriceCents,
      },
    ]);
    setQuery("");
    setResults([]);
  }

  function addManual(dollars: string) {
    const amount = parseFloat(dollars);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setCart((c) => [
      ...c,
      { key: `manual-${Date.now()}`, title: "Item", priceCents: Math.round(amount * 100) },
    ]);
  }

  const subtotal = cart.reduce((sum, line) => sum + line.priceCents, 0);
  const tax = taxExempt ? 0 : Math.round((subtotal * taxRateBps) / 10_000);
  const beforeRoundUp = subtotal + tax;
  // Round up to the next whole dollar — never a fixed "suggested donation".
  const roundUpCents =
    roundUp && beforeRoundUp > 0 && beforeRoundUp % 100 !== 0 ? 100 - (beforeRoundUp % 100) : 0;
  const total = beforeRoundUp + roundUpCents;

  async function complete(tender: string) {
    if (cart.length === 0) return;

    const sale = {
      offlineId: newOfflineId(),
      lines: cart.map(({ itemId, title, priceCents, retailEstimateCents }) => ({
        itemId,
        title,
        priceCents,
        retailEstimateCents,
      })),
      subtotalCents: subtotal,
      taxCents: tax,
      roundupCents: roundUpCents,
      totalCents: total,
      tender,
      taxExempt,
      createdAt: new Date().toISOString(),
    };

    // Queue first, always. The sale is safe on the device before anything
    // touches the network — that ordering is the whole point.
    await enqueue(sale);
    setCart([]);
    setTaxExempt(false);
    setRoundUp(roundUpEnabled);
    setFlash(`${money(total)} — thank you.`);
    await refreshPending();

    if (navigator.onLine) {
      const result = await flush();
      if (result.rejected.length > 0 || result.unfulfilled > 0) {
        setNeedsAttention({ rejected: result.rejected, unfulfilled: result.unfulfilled });
      }
      await refreshPending();
    }
  }

  /**
   * Take a card on the reader.
   *
   * Nothing is queued and nothing is optimistic. The server prices the cart
   * from the items table, creates the charge, and hands it to the reader; the
   * customer taps; Stripe decides. We poll until it has, and the sale is only
   * complete when Stripe says so — a green light on the reader is not payment.
   */
  async function payByCard() {
    const itemIds = cart.map((line) => line.itemId).filter((id): id is string => Boolean(id));

    // Every price is computed server-side from the items table, so an amount
    // typed at the counter has nothing to compute from. Cash handles it.
    if (itemIds.length !== cart.length) {
      setTerminalError(
        "Manually-priced lines can't go on a card, because the price has to come from a real item record. Take cash for this one, or log the item first."
      );
      return;
    }

    setTerminalError(null);
    setPhase("starting");

    try {
      const res = await fetch("/api/pos/terminal/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds, readerId, roundUpCents: roundUpCents, taxExempt }),
      });
      const data = (await res.json()) as {
        transactionId?: string;
        error?: string;
        state?: string;
      };

      if (!res.ok || !data.transactionId) {
        setPhase("failed");
        setTerminalError(data.error ?? "We couldn't start the payment.");
        return;
      }

      setTerminalTx(data.transactionId);
      setPhase("waiting");
      await pollUntilSettled(data.transactionId);
    } catch {
      setPhase("failed");
      setTerminalError(
        "We lost the connection while starting that payment. Check the reader before trying again — if it took the card, the sale will appear on its own."
      );
    }
  }

  /**
   * Poll until Stripe reaches a terminal state.
   *
   * Deliberately gives up rather than spinning forever. A payment that hasn't
   * resolved in two minutes needs a person to look at the reader, and a cashier
   * staring at a spinner is worse than one being told that plainly.
   */
  async function pollUntilSettled(txId: string) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(`/api/pos/terminal/status/${txId}`);
        const data = (await res.json()) as { state?: string };

        if (data.state === "succeeded") {
          setPhase("succeeded");
          setFlash(`${money(total)} — thank you.`);
          setCart([]);
          setTaxExempt(false);
          setRoundUp(roundUpEnabled);
          setTerminalTx(null);
          setTimeout(() => setPhase("idle"), 2500);
          return;
        }
        if (data.state === "failed" || data.state === "canceled") {
          setPhase("failed");
          setTerminalError(
            data.state === "canceled"
              ? "That payment was cancelled. Nothing was charged."
              : "The card was declined. Nothing was charged — try another card, or take cash."
          );
          return;
        }
      } catch {
        // A dropped poll is not a failed payment. Keep waiting.
      }
    }

    setPhase("failed");
    setTerminalError(
      "This is taking longer than it should. Check the reader — if the payment did go through, it'll appear in Money on its own."
    );
  }

  async function cancelCard() {
    if (!terminalTx) return;
    await fetch("/api/pos/terminal/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId: terminalTx, readerId }),
    }).catch(() => {});
    setPhase("idle");
    setTerminalTx(null);
    setTerminalError(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl text-bark">Register</h1>
        <div className="flex items-center gap-2 text-sm">
          {online ? (
            <Badge color="#2F6F5E">Online</Badge>
          ) : (
            <Badge color="#B8543F">Offline — still selling</Badge>
          )}
          {pending > 0 ? (
            <Badge color="#B8860B">{pending} waiting to sync</Badge>
          ) : null}
        </div>
      </div>

      {!online ? (
        <Notice tone="warn">
          No connection right now. Keep ringing sales up — they're saved on this device and
          will sync themselves the moment you're back.
        </Notice>
      ) : null}

      {flash ? <Notice tone="good">{flash}</Notice> : null}

      {needsAttention.unfulfilled > 0 ? (
        <Notice tone="warn">
          <strong>
            {needsAttention.unfulfilled}{" "}
            {needsAttention.unfulfilled === 1 ? "line was" : "lines were"} paid for but couldn't
            be handed over.
          </strong>{" "}
          Another sale claimed the item first — usually a duplicate tag, or something already
          sold. The money is recorded; someone needs to sort out the item with the customer.
        </Notice>
      ) : null}

      {needsAttention.rejected.length > 0 ? (
        <Notice tone="warn">
          <strong>
            {needsAttention.rejected.length}{" "}
            {needsAttention.rejected.length === 1 ? "sale" : "sales"} couldn't be synced.
          </strong>{" "}
          {needsAttention.rejected[0].reason} They're still saved on this device — nothing is
          lost, but they need a manager rather than another retry.
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <Card>
            <label htmlFor="lookup" className="mb-1.5 block text-sm font-medium text-bark">
              Scan a tag or search
            </label>
            <Input
              id="lookup"
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder="Tag number, or part of the name"
              autoFocus
            />

            {searching ? <p className="mt-2 text-xs text-slate-soft">Looking…</p> : null}

            {results.length > 0 ? (
              <ul className="mt-3 divide-y divide-line">
                {results.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => addItem(item)}
                      className="touch-target flex w-full items-center justify-between gap-3 px-1 py-3 text-left hover:bg-linen"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 shrink-0 rounded-full border border-line"
                          style={{ backgroundColor: TAG_COLOR_HEX[item.tagColor ?? ""] ?? "#ddd" }}
                        />
                        <span className="truncate text-bark">{item.title}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-medium text-bark">{money(item.priceCents)}</span>
                        {item.priceCents < item.listPriceCents ? (
                          <span className="block text-xs text-clay line-through">
                            {money(item.listPriceCents)}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4 flex items-end gap-2 border-t border-line pt-4">
              <div className="flex-1">
                <label htmlFor="manual" className="mb-1.5 block text-sm font-medium text-bark">
                  Or just type a price
                </label>
                <Input
                  id="manual"
                  type="number"
                  step="0.25"
                  min="0"
                  placeholder="0.00"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      addManual((e.target as HTMLInputElement).value);
                      (e.target as HTMLInputElement).value = "";
                    }
                  }}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const el = document.getElementById("manual") as HTMLInputElement | null;
                  if (el) {
                    addManual(el.value);
                    el.value = "";
                  }
                }}
              >
                Add
              </Button>
            </div>
          </Card>

          <Card>
            <h2 className="font-display text-lg text-bark">Cart</h2>
            {cart.length === 0 ? (
              <p className="mt-3 text-sm text-slate-soft">Nothing yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {cart.map((line) => (
                  <li key={line.key} className="flex items-center justify-between gap-3 py-3">
                    <span className="min-w-0 truncate text-bark">{line.title}</span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="font-medium text-bark">{money(line.priceCents)}</span>
                      <button
                        type="button"
                        onClick={() => setCart((c) => c.filter((l) => l.key !== line.key))}
                        className="text-xs text-slate-soft underline underline-offset-2 hover:text-clay"
                      >
                        remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="h-fit">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-soft">Subtotal</dt>
              <dd className="text-bark">{money(subtotal)}</dd>
            </div>
            {taxRateBps > 0 ? (
              <div className="flex justify-between">
                <dt className="text-slate-soft">Tax</dt>
                <dd className="text-bark">{taxExempt ? "exempt" : money(tax)}</dd>
              </div>
            ) : null}
            {roundUpCents > 0 ? (
              <div className="flex justify-between">
                <dt className="text-slate-soft">Rounded up</dt>
                <dd className="text-moss">{money(roundUpCents)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-line pt-2 text-lg">
              <dt className="font-medium text-bark">Total</dt>
              <dd className="font-display text-bark">{money(total)}</dd>
            </div>
          </dl>

          <div className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={roundUp}
                onChange={(e) => setRoundUp(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-bark">Round up for {roundUpCause}</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={taxExempt}
                onChange={(e) => setTaxExempt(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-bark">Tax exempt</span>
            </label>
          </div>

          <div className="mt-4 space-y-2 border-t border-line pt-4">
            {phase === "waiting" || phase === "starting" ? (
              <div className="rounded-xl border border-moss/30 bg-moss/5 p-4 text-center">
                <p className="font-medium text-bark">
                  {phase === "starting" ? "Sending to the reader…" : "Waiting for the card"}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-slate-soft">
                  {phase === "starting"
                    ? "One moment."
                    : `Ask for ${money(total)} on the reader. Don't close this screen.`}
                </p>
                <button
                  type="button"
                  onClick={cancelCard}
                  className="mt-3 text-sm text-clay underline underline-offset-2"
                >
                  Cancel this payment
                </button>
              </div>
            ) : (
              <>
                <Button
                  type="button"
                  className="w-full"
                  disabled={cart.length === 0}
                  onClick={() => complete("cash")}
                >
                  Cash
                </Button>

                {cardReady && readers.length > 0 ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      disabled={cart.length === 0 || !online}
                      onClick={payByCard}
                    >
                      Card on the reader
                    </Button>

                    {readers.length > 1 ? (
                      <select
                        value={readerId}
                        onChange={(e) => setReaderId(e.target.value)}
                        className="touch-target w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-bark"
                      >
                        {readers.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label} · {r.status}
                            {r.is_simulated ? " (simulated)" : ""}
                          </option>
                        ))}
                      </select>
                    ) : null}

                    {!online ? (
                      <p className="text-xs leading-relaxed text-slate-soft">
                        Card payments need a connection — the reader has to reach the bank.
                        Cash still works and syncs later.
                      </p>
                    ) : readers[0]?.is_simulated ? (
                      <p className="text-xs leading-relaxed text-clay">
                        This is a simulated reader. It behaves like the real thing but takes no
                        money.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      disabled={cart.length === 0}
                      onClick={() => complete("card")}
                    >
                      Card
                    </Button>
                    <p className="text-xs leading-relaxed text-slate-soft">
                      {!stripeLive
                        ? "Card sales are recorded but not charged — Stripe isn't connected yet. Cash works fully."
                        : !cardReady
                          ? "Payment setup isn't finished, so card sales are recorded but not charged. Cash works fully."
                          : "No reader is paired yet, so card sales are recorded but not charged."}
                    </p>
                  </>
                )}
              </>
            )}

            {terminalError ? (
              <p className="rounded-xl border border-clay/30 bg-clay/5 p-3 text-sm leading-relaxed text-bark">
                {terminalError}
              </p>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
