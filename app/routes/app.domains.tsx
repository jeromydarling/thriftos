import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/app.domains";
import { requireUser, roleAtLeast } from "../lib/auth";
import { envFrom } from "../lib/env";
import { first } from "../lib/db";
import {
  addDomain,
  DomainError,
  domainInstructions,
  domainReadiness,
  listDomains,
  refreshDomain,
  removeDomain,
  validateHostname,
  type DomainConfig,
} from "../lib/domains";
import { Badge, Button, Card, Input, Notice } from "../components/ui";
import { ToastFrom } from "../components/toast";

export function meta() {
  return [{ title: "Your domain | ThriftOS" }];
}

function configFor(env: {
  CF_SAAS_API_TOKEN?: string;
  CF_SAAS_ZONE_ID?: string;
  APP_URL?: string;
}): DomainConfig | null {
  if (!env.CF_SAAS_API_TOKEN || !env.CF_SAAS_ZONE_ID) return null;
  return {
    apiToken: env.CF_SAAS_API_TOKEN,
    zoneId: env.CF_SAAS_ZONE_ID,
    cnameTarget: (env.APP_URL ?? "").replace(/^https?:\/\//, "") || "thriftos.app",
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);

  const org = await first<{ slug: string }>(env.DB, `SELECT slug FROM orgs WHERE id = ?`, user.orgId);
  const readiness = domainReadiness(env);
  const config = configFor(env);

  let domains = await listDomains(env.DB, user.orgId);

  // Ask Cloudflare on the way in, so a shop that added a CNAME last night
  // sees it working rather than having to press a button to find out.
  if (config) {
    domains = await Promise.all(
      domains.map((d) => (d.status === "active" ? Promise.resolve(d) : refreshDomain(env.DB, config, d)))
    );
  }

  const host = (env.APP_URL ?? "").replace(/^https?:\/\//, "") || "thriftos.app";

  return {
    domains: domains.map((d) => ({
      ...d,
      instructions: domainInstructions(d, config?.cnameTarget ?? host),
    })),
    readiness,
    slug: org?.slug ?? "",
    host,
    cnameTarget: config?.cnameTarget ?? host,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);

  // Pointing a domain is an outward-facing, hard-to-undo act, and a mistake
  // takes a shop's website down. Owner or admin only.
  if (!roleAtLeast(user.role, "admin")) {
    return { error: "Adding a domain needs an owner or an admin." };
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const config = configFor(env);

  if (intent === "remove") {
    await removeDomain(env.DB, config, user.orgId, String(form.get("id") ?? ""));
    return { ok: "Domain removed. Your ThriftOS address still works." };
  }

  if (intent !== "add") return { error: "That action isn't one we know." };

  if (!config) {
    return { error: domainReadiness(env).reason };
  }

  const check = validateHostname(String(form.get("hostname") ?? ""), env.APP_URL ?? "");
  if (!check.ok) return { error: check.reason };

  try {
    await addDomain(env.DB, config, {
      orgId: user.orgId,
      hostname: check.hostname,
      userId: user.id,
    });
    return { ok: "Added. Now point the DNS record below at us." };
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message };
    throw err;
  }
}

const STATUS_TONE: Record<string, string> = {
  active: "#2F6F5E",
  verifying: "#B8860B",
  pending: "#B8860B",
  failed: "#B8543F",
};

export default function Domains({ loaderData, actionData }: Route.ComponentProps) {
  const { domains, readiness, slug, host, cnameTarget } = loaderData;
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="font-display text-3xl text-bark">Your domain</h1>
        <p className="mt-3 leading-relaxed text-slate-soft">
          Your shop is already live at{" "}
          <a
            href={`/${slug}`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-moss underline underline-offset-2"
          >
            {host}/{slug}
          </a>
          , free and for as long as you're here. If you already own a domain, you can point it
          here instead — and if you don't, you genuinely don't need one.
        </p>
      </header>

      <ToastFrom data={actionData} />

      {!readiness.configured ? <Notice tone="info">{readiness.reason}</Notice> : null}

      {domains.length > 0 ? (
        <section className="space-y-4">
          {domains.map((domain) => (
            <Card key={domain.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-bark">{domain.hostname}</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-soft">
                    {domain.instructions}
                  </p>
                </div>
                <Badge color={STATUS_TONE[domain.status] ?? "#6B7280"}>
                  {domain.status === "active"
                    ? "live"
                    : domain.status === "failed"
                      ? "needs attention"
                      : "waiting for DNS"}
                </Badge>
              </div>

              {domain.status !== "active" ? (
                <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-linen/50 p-4">
                  <p className="text-sm font-medium text-bark">
                    Add this at your domain provider
                  </p>
                  <table className="mt-2 w-full min-w-[26rem] text-sm">
                    <tbody className="divide-y divide-line">
                      <tr>
                        <td className="py-1.5 pr-4 text-slate-soft">Type</td>
                        <td className="py-1.5 font-mono text-bark">CNAME</td>
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-4 text-slate-soft">Name</td>
                        <td className="py-1.5 font-mono text-bark">{domain.hostname}</td>
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-4 text-slate-soft">Value</td>
                        <td className="py-1.5 font-mono text-bark">{cnameTarget}</td>
                      </tr>
                      {domain.verification_txt_name ? (
                        <>
                          <tr>
                            <td className="py-1.5 pr-4 text-slate-soft">Also add TXT</td>
                            <td className="py-1.5 break-all font-mono text-xs text-bark">
                              {domain.verification_txt_name}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-1.5 pr-4 text-slate-soft">TXT value</td>
                            <td className="py-1.5 break-all font-mono text-xs text-bark">
                              {domain.verification_txt_value}
                            </td>
                          </tr>
                        </>
                      ) : null}
                    </tbody>
                  </table>
                  <p className="mt-3 text-xs leading-relaxed text-slate-soft">
                    We check this page every time you open it, and again overnight. There's
                    nothing to press — when the record is in place it goes live on its own.
                  </p>
                </div>
              ) : null}

              <Form method="post" className="mt-4">
                <input type="hidden" name="intent" value="remove" />
                <input type="hidden" name="id" value={domain.id} />
                <button
                  type="submit"
                  disabled={busy}
                  className="text-sm text-clay underline underline-offset-2 disabled:opacity-50"
                >
                  Remove this domain
                </button>
              </Form>
            </Card>
          ))}
        </section>
      ) : null}

      <Card>
        <h2 className="font-display text-xl text-bark">
          {domains.length > 0 ? "Add another" : "Use your own domain"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-soft">
          You'll need to be able to edit DNS records wherever the domain is registered. If that
          sentence means nothing to you, your ThriftOS address works perfectly well and this is
          safe to skip.
        </p>
        <Form method="post" className="mt-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="intent" value="add" />
          <div className="min-w-[16rem] flex-1">
            <label htmlFor="hostname" className="block text-sm font-medium text-bark">
              Your domain
            </label>
            <Input
              id="hostname"
              name="hostname"
              placeholder="shop.yourcharity.org"
              className="mt-1"
              spellCheck={false}
              disabled={!readiness.configured}
            />
          </div>
          <Button type="submit" disabled={busy || !readiness.configured}>
            Add it
          </Button>
        </Form>
      </Card>

      <section className="border-t border-line pt-8 text-sm leading-relaxed text-slate-soft">
        <h2 className="font-display text-lg text-bark">Worth knowing</h2>
        <ul className="mt-3 space-y-2">
          <li>
            · Your ThriftOS address keeps working whatever you do here. Both addresses can be
            live at once.
          </li>
          <li>
            · We don't sell domains and we don't hold yours. It stays registered wherever you
            bought it, and you can point it somewhere else whenever you like.
          </li>
          <li>
            · The certificate is issued and renewed automatically. There's nothing to buy and
            nothing that expires on you.
          </li>
          <li>
            · If you leave ThriftOS, remove the DNS record and the domain is entirely yours
            again — there's nothing to ask us for.
          </li>
        </ul>
        <p className="mt-4">
          <Link to="/app/site" className="text-moss underline underline-offset-2">
            Back to your website
          </Link>
        </p>
      </section>
    </div>
  );
}
