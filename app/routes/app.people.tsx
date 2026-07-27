import { Form, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/app.people";
import { requireUser } from "../lib/auth";
import { all } from "../lib/db";
import { envFrom } from "../lib/env";
import { listContacts, parseRoles, roleLabel, ROLES } from "../lib/contacts";
import { Badge, Card, EmptyState, Input, Select, TableScroll } from "../components/ui";

export function meta() {
  return [{ title: "People | ThriftOS" }];
}

const ROLE_COLORS: Record<string, string> = {
  donor: "#2F6F5E",
  shopper: "#2B6CB0",
  volunteer: "#B8860B",
  worker: "#6B46C1",
  referrer: "#B8543F",
  partner: "#0F766E",
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const url = new URL(request.url);

  const role = url.searchParams.get("role");
  const search = url.searchParams.get("q")?.trim() ?? "";
  const focus = url.searchParams.get("focus");

  const [page, focused] = await Promise.all([
    listContacts(env.DB, user.orgId, {
      cursor: url.searchParams.get("cursor"),
      role: role && role !== "all" ? role : null,
      search: search || null,
    }),
    focus
      ? all<{ id: string; name: string; email: string | null; roles: string; notes: string | null }>(
          env.DB,
          `SELECT id, name, email, roles, notes FROM contacts WHERE org_id = ? AND id = ?`,
          user.orgId,
          focus
        )
      : Promise.resolve([]),
  ]);

  return {
    contacts: page.contacts.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      roles: parseRoles(c.roles),
      lastSeenAt: c.last_seen_at,
    })),
    nextCursor: page.nextCursor,
    role: role ?? "all",
    search,
    focused: focused[0] ?? null,
  };
}

export default function People({ loaderData }: Route.ComponentProps) {
  const { contacts, nextCursor, role, search, focused } = loaderData;
  const [params] = useSearchParams();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-bark">People</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-soft">
          One list, not four. Someone can be a donor and a volunteer and a regular shopper —
          roles stack rather than compete, and they're added automatically as people show up.
        </p>
      </div>

      {focused ? (
        <Card className="border-moss/40 bg-moss/5">
          <p className="text-xs uppercase tracking-wide text-slate-soft">From the Compass</p>
          <h2 className="mt-1 font-display text-xl text-bark">{focused.name}</h2>
          {focused.email ? (
            <p className="mt-1 text-sm text-slate-soft">{focused.email}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {parseRoles(focused.roles).map((r) => (
              <Badge key={r} color={ROLE_COLORS[r]}>
                {roleLabel(r)}
              </Badge>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <Form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label htmlFor="q" className="mb-1.5 block text-sm font-medium text-bark">
              Search
            </label>
            <Input id="q" name="q" defaultValue={search} placeholder="Name or email" />
          </div>
          <div className="w-44">
            <label htmlFor="role" className="mb-1.5 block text-sm font-medium text-bark">
              Role
            </label>
            <Select id="role" name="role" defaultValue={role}>
              <option value="all">Everyone</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </Select>
          </div>
          <button
            type="submit"
            className="touch-target rounded-xl bg-moss px-5 py-3 font-medium text-white hover:bg-moss-deep"
          >
            Filter
          </button>
        </Form>
      </Card>

      {contacts.length === 0 ? (
        <EmptyState
          title="No one here yet"
          body="People appear automatically — the first time you record a donation with a name on it, they'll show up here."
        />
      ) : (
        <TableScroll>
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-linen/60 text-left">
              <tr>
                <th className="px-4 py-3 font-medium text-slate-soft">Name</th>
                <th className="px-4 py-3 font-medium text-slate-soft">Roles</th>
                <th className="px-4 py-3 font-medium text-slate-soft">Contact</th>
                <th className="px-4 py-3 font-medium text-slate-soft">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {contacts.map((contact) => (
                <tr key={contact.id} className="hover:bg-linen/40">
                  <td className="px-4 py-3 text-bark">{contact.name}</td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1">
                      {contact.roles.map((r) => (
                        <Badge key={r} color={ROLE_COLORS[r]}>
                          {roleLabel(r)}
                        </Badge>
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-soft">
                    {contact.email ?? contact.phone ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-soft">
                    {new Date(contact.lastSeenAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {nextCursor ? (
        <div className="text-center">
          <Link
            to={`?${new URLSearchParams({ ...Object.fromEntries(params), cursor: nextCursor })}`}
            prefetch="intent"
            className="inline-block rounded-xl border border-line bg-white px-5 py-3 text-sm font-medium text-bark hover:bg-linen"
          >
            Show more
          </Link>
        </div>
      ) : null}
    </div>
  );
}
