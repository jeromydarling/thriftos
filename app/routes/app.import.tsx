import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/app.import";
import { requireUser } from "../lib/auth";
import { envFrom } from "../lib/env";
import { FIELDS_FOR, guessMapping, parseCsv, type ImportKind } from "../lib/csv";
import { commitImport, previewImport, MAX_ROWS, type ImportPlan } from "../lib/import";
import { listBatches, reverseBatch } from "../lib/onboarding";
import { newToken } from "../lib/ids";
import { Button, Card, Notice, Select } from "../components/ui";

export function meta() {
  return [{ title: "Import your records | ThriftOS" }];
}

/**
 * Uploaded files live in KV between the preview and the commit.
 *
 * The alternative — round-tripping the whole CSV through a hidden form field —
 * works until somebody uploads a four-megabyte export and their browser stalls.
 * An hour is long enough for anyone to think about a mapping and short enough
 * that we aren't quietly storing shops' donor lists.
 */
const UPLOAD_TTL_SECONDS = 3600;
const uploadKey = (orgId: string, token: string) => `import:${orgId}:${token}`;

/** A ceiling on what we'll accept at all, well above any real thrift export. */
const MAX_BYTES = 8 * 1024 * 1024;

const KINDS: { id: ImportKind; label: string; blurb: string }[] = [
  {
    id: "contacts",
    label: "People",
    blurb: "Donors, volunteers, shoppers. Import these first — everything else attaches to them.",
  },
  {
    id: "donations",
    label: "Donations",
    blurb: "Your donation history, matched to people by email address.",
  },
  {
    id: "items",
    label: "Inventory",
    blurb: "Current stock. Map the intake date and your aged stock arrives correctly marked down.",
  },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const batches = await listBatches(env.DB, user.orgId);

  return {
    batches: batches.filter((b) => b.kind !== "sample"),
    isDemo: user.isDemo,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = envFrom(context);
  const user = await requireUser(request, env.DB);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (user.isDemo) {
    return { error: "The demo shop resets weekly, so imports are switched off in it." };
  }

  /* Upload → guess the mapping → show it for correction. */
  if (intent === "upload") {
    const kind = String(form.get("kind") ?? "contacts") as ImportKind;
    const file = form.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return { error: "Choose a CSV file to upload." };
    }
    if (file.size > MAX_BYTES) {
      return {
        error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB, which is larger than we can read in one go. Split it and import the pieces.`,
      };
    }

    const text = await file.text();
    const parsed = parseCsv(text);

    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      return {
        error:
          "That file has no rows we could read. It needs a header row, then one row per record — if it came out of a spreadsheet, save it as CSV rather than XLSX.",
      };
    }

    const token = newToken(16);
    await env.KV.put(uploadKey(user.orgId, token), text, {
      expirationTtl: UPLOAD_TTL_SECONDS,
    });

    return {
      stage: "map" as const,
      token,
      kind,
      filename: file.name,
      headers: parsed.headers,
      rowCount: parsed.rows.length,
      mapping: guessMapping(parsed.headers, kind),
      sampleRow: parsed.rows[0],
    };
  }

  /* Dry run, or the real thing. Same code path either way. */
  if (intent === "preview" || intent === "commit") {
    const token = String(form.get("token") ?? "");
    const kind = String(form.get("kind") ?? "contacts") as ImportKind;
    const filename = String(form.get("filename") ?? "upload.csv");
    const text = await env.KV.get(uploadKey(user.orgId, token));

    if (!text) {
      return {
        error:
          "That upload has expired — we only hold a file for an hour. Upload it again and your mapping will be guessed the same way.",
      };
    }

    const headers = parseCsv(text).headers;
    const mapping: Record<string, string> = {};
    for (const header of headers) {
      const field = String(form.get(`map:${header}`) ?? "");
      if (field) mapping[header] = field;
    }

    const opts = {
      kind,
      mapping,
      dayFirst: form.get("dayFirst") === "on",
      unmappedToNotes: form.get("unmappedToNotes") === "on",
    };

    if (intent === "preview") {
      const plan = await previewImport(env.DB, user.orgId, text, opts);
      return {
        stage: "preview" as const,
        token,
        kind,
        filename,
        headers,
        mapping,
        dayFirst: opts.dayFirst,
        unmappedToNotes: opts.unmappedToNotes,
        plan,
      };
    }

    const result = await commitImport(env.DB, user.orgId, text, opts, filename, user.id);
    // The file has done its job; there's no reason to keep a shop's donor list
    // sitting in KV for the rest of the hour.
    await env.KV.delete(uploadKey(user.orgId, token));

    return { stage: "done" as const, kind, filename, plan: result, batchId: result.batchId };
  }

  if (intent === "reverse") {
    const batchId = String(form.get("batchId") ?? "");
    const removed = await reverseBatch(env.DB, user.orgId, batchId);
    return { stage: "reversed" as const, removed };
  }

  return { error: "That action isn't one we know." };
}

export default function ImportPage({ loaderData, actionData }: Route.ComponentProps) {
  const { batches, isDemo } = loaderData;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const stage = actionData && "stage" in actionData ? actionData.stage : null;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <h1 className="font-display text-3xl text-bark">Bring your records across</h1>
        <p className="mt-3 leading-relaxed text-slate-soft">
          Upload a CSV, tell us what each column is, and look at the preview before anything is
          written. Every import can be undone in one click.{" "}
          <Link
            to="/app/help?a=importing-from-another-system"
            className="text-moss underline underline-offset-2"
          >
            What's worth bringing, and what isn't
          </Link>
        </p>
      </header>

      {isDemo ? (
        <Notice tone="info">
          The demo shop resets every Monday, so imports are switched off in it.
        </Notice>
      ) : null}

      {actionData && "error" in actionData && actionData.error ? (
        <Notice tone="warn">{actionData.error}</Notice>
      ) : null}

      {stage === "map" || stage === "preview" ? (
        <MappingForm data={actionData as MappingData} busy={busy} />
      ) : stage === "done" ? (
        <Done data={actionData as DoneData} />
      ) : stage === "reversed" ? (
        <Notice tone="good">
          That import has been reversed. The records it created are gone; everything else is
          exactly as it was.
        </Notice>
      ) : (
        <UploadForm busy={busy} />
      )}

      {batches.length > 0 ? <History batches={batches} busy={busy} /> : null}
    </div>
  );
}

function UploadForm({ busy }: { busy: boolean }) {
  return (
    <Form method="post" encType="multipart/form-data" className="space-y-4">
      <input type="hidden" name="intent" value="upload" />

      <fieldset className="space-y-3">
        <legend className="font-display text-xl text-bark">What are you importing?</legend>
        {KINDS.map((kind, i) => (
          <label
            key={kind.id}
            className="flex cursor-pointer gap-3 rounded-xl border border-line bg-white p-4 hover:bg-linen has-[:checked]:border-moss"
          >
            <input
              type="radio"
              name="kind"
              value={kind.id}
              defaultChecked={i === 0}
              className="mt-1.5 accent-[#2F6F5E]"
            />
            <span className="min-w-0">
              <span className="block font-medium text-bark">{kind.label}</span>
              <span className="mt-0.5 block text-sm leading-relaxed text-slate-soft">
                {kind.blurb}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <Card>
        <label htmlFor="file" className="block font-medium text-bark">
          Your CSV file
        </label>
        <p className="mt-1 text-sm leading-relaxed text-slate-soft">
          Up to {MAX_ROWS.toLocaleString()} rows per file. If your system exports XLSX, open it
          and save as CSV first.
        </p>
        <input
          id="file"
          type="file"
          name="file"
          accept=".csv,text/csv,text/plain"
          required
          className="mt-3 block w-full text-sm text-slate-soft file:mr-4 file:rounded-lg file:border-0 file:bg-moss file:px-4 file:py-2 file:font-medium file:text-white hover:file:bg-moss-deep"
        />
        <Button type="submit" className="mt-4" disabled={busy}>
          {busy ? "Reading…" : "Upload and map columns"}
        </Button>
      </Card>
    </Form>
  );
}

interface MappingData {
  stage: "map" | "preview";
  token: string;
  kind: ImportKind;
  filename: string;
  headers: string[];
  mapping: Record<string, string>;
  rowCount?: number;
  sampleRow?: Record<string, string>;
  dayFirst?: boolean;
  unmappedToNotes?: boolean;
  plan?: ImportPlan;
}

function MappingForm({ data, busy }: { data: MappingData; busy: boolean }) {
  const fields = FIELDS_FOR[data.kind];
  const required = fields.filter((f) => f.required);
  const plan = data.plan;

  return (
    <div className="space-y-6">
      <Form method="post" className="space-y-6">
        <input type="hidden" name="token" value={data.token} />
        <input type="hidden" name="kind" value={data.kind} />
        <input type="hidden" name="filename" value={data.filename} />

        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-xl text-bark">What is each column?</h2>
            <p className="text-sm text-slate-soft">
              {data.filename}
              {data.rowCount ? ` · ${data.rowCount.toLocaleString()} rows` : ""}
            </p>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-soft">
            We've guessed from your headers. Correct anything that's wrong — particularly the
            date and money columns.{" "}
            {required.length > 0
              ? `${required.map((f) => f.label).join(" and ")} must be mapped.`
              : ""}
          </p>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-3 py-2 font-medium text-slate-soft">Your column</th>
                  <th className="px-3 py-2 font-medium text-slate-soft">First value</th>
                  <th className="px-3 py-2 font-medium text-slate-soft">Import as</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.headers.map((header) => (
                  <tr key={header}>
                    <td className="px-3 py-2.5 align-top font-medium text-bark">{header}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2.5 align-top text-slate-soft">
                      {data.sampleRow?.[header] || "—"}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Select name={`map:${header}`} defaultValue={data.mapping[header] ?? ""}>
                        <option value="">Don't import</option>
                        {fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                            {f.required ? " (required)" : ""}
                            {f.hint ? ` — ${f.hint}` : ""}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 space-y-3 border-t border-line pt-5">
            <label className="flex cursor-pointer gap-3 text-sm leading-relaxed text-slate-soft">
              <input
                type="checkbox"
                name="dayFirst"
                defaultChecked={data.dayFirst}
                className="mt-0.5 accent-[#2F6F5E]"
              />
              <span>
                <span className="font-medium text-bark">Dates are day/month/year.</span> Tick this
                if 03/09/2024 means the 3rd of September. Getting it wrong quietly ruins donor
                rhythms, so it's worth checking a date you recognise.
              </span>
            </label>
            <label className="flex cursor-pointer gap-3 text-sm leading-relaxed text-slate-soft">
              <input
                type="checkbox"
                name="unmappedToNotes"
                defaultChecked={data.unmappedToNotes ?? true}
                className="mt-0.5 accent-[#2F6F5E]"
              />
              <span>
                <span className="font-medium text-bark">Keep the columns I'm not importing.</span>{" "}
                Anything unmapped goes into the record's notes, so a custom field somebody added
                in 2019 stays findable rather than being lost.
              </span>
            </label>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="submit" name="intent" value="preview" disabled={busy}>
              {busy ? "Checking…" : plan ? "Check again" : "Show me what would happen"}
            </Button>
            {plan && plan.creates + plan.updates > 0 ? (
              <Button type="submit" name="intent" value="commit" variant="secondary" disabled={busy}>
                Import {(plan.creates + plan.updates).toLocaleString()} records
              </Button>
            ) : null}
          </div>
        </Card>
      </Form>

      {plan ? <PlanReport plan={plan} /> : null}
    </div>
  );
}

function PlanReport({ plan }: { plan: ImportPlan }) {
  return (
    <Card>
      <h2 className="font-display text-xl text-bark">Nothing has been written yet</h2>
      <p className="mt-2 leading-relaxed text-slate-soft">
        This is what would happen if you imported now.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Figure n={plan.creates} label="created" />
        <Figure n={plan.updates} label="updated" hint="Matched a record already here" />
        <Figure n={plan.skipped.length} label="skipped" tone={plan.skipped.length > 0 ? "warn" : undefined} />
      </div>

      {plan.preview.length > 0 ? (
        <div className="mt-6">
          <h3 className="font-medium text-bark">The first few, as they'd be created</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[30rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  {Object.keys(plan.preview[0]).map((k) => (
                    <th key={k} className="px-3 py-2 font-medium text-slate-soft">
                      {k.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {plan.preview.map((row, i) => (
                  <tr key={i}>
                    {Object.values(row).map((v, j) => (
                      <td
                        key={j}
                        className="max-w-[14rem] truncate px-3 py-2 align-top text-slate-soft"
                      >
                        {String(v ?? "") || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {plan.skipped.length > 0 ? (
        <IssueList
          title="Rows we'd skip, and why"
          note="These usually reveal a mapping mistake rather than bad data. Fix the mapping above and check again."
          issues={plan.skipped}
          tone="warn"
        />
      ) : null}

      {plan.warnings.length > 0 ? (
        <IssueList
          title="Rows we'd import, with a caveat"
          note="These will be created, but something about them needed a judgement call."
          issues={plan.warnings}
          tone="note"
        />
      ) : null}
    </Card>
  );
}

function IssueList({
  title,
  note,
  issues,
  tone,
}: {
  title: string;
  note: string;
  issues: { line: number; reason: string }[];
  tone: "warn" | "note";
}) {
  const shown = issues.slice(0, 25);
  return (
    <div
      className={`mt-6 rounded-xl border p-4 ${
        tone === "warn" ? "border-clay/30 bg-clay/5" : "border-line bg-linen/60"
      }`}
    >
      <p className="font-medium text-bark">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-slate-soft">{note}</p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {shown.map((issue, i) => (
          <li key={i} className="flex gap-2 leading-relaxed text-slate-soft">
            <span className="shrink-0 font-medium text-bark">
              {issue.line > 0 ? `Line ${issue.line}` : "File"}
            </span>
            <span>{issue.reason}</span>
          </li>
        ))}
      </ul>
      {issues.length > shown.length ? (
        <p className="mt-2 text-sm text-slate-soft">
          …and {(issues.length - shown.length).toLocaleString()} more like these.
        </p>
      ) : null}
    </div>
  );
}

function Figure({
  n,
  label,
  hint,
  tone,
}: {
  n: number;
  label: string;
  hint?: string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p
        className={`font-display text-3xl ${tone === "warn" && n > 0 ? "text-clay" : "text-bark"}`}
      >
        {n.toLocaleString()}
      </p>
      <p className="mt-1 text-sm font-medium text-bark">{label}</p>
      {hint ? <p className="mt-0.5 text-xs leading-relaxed text-slate-soft">{hint}</p> : null}
    </div>
  );
}

interface DoneData {
  stage: "done";
  kind: ImportKind;
  filename: string;
  batchId: string;
  plan: ImportPlan;
}

function Done({ data }: { data: DoneData }) {
  const { plan } = data;
  const next =
    data.kind === "contacts"
      ? { to: "/app/people", label: "See your people" }
      : data.kind === "donations"
        ? { to: "/app/donations", label: "See your donations" }
        : { to: "/app/inventory", label: "See your inventory" };

  return (
    <div className="space-y-6">
      <Notice tone="good">
        Imported {plan.creates.toLocaleString()} new and updated {plan.updates.toLocaleString()}{" "}
        from {data.filename}.
      </Notice>

      <Card>
        <h2 className="font-display text-xl text-bark">That's in</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Figure n={plan.creates} label="created" />
          <Figure n={plan.updates} label="updated" />
          <Figure n={plan.skipped.length} label="skipped" tone={plan.skipped.length > 0 ? "warn" : undefined} />
        </div>

        {plan.skipped.length > 0 ? (
          <IssueList
            title="What was skipped"
            note="Fix these in the file and import it again — re-running updates rather than duplicating, so the rows that worked won't double."
            issues={plan.skipped}
            tone="warn"
          />
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to={next.to}
            className="touch-target inline-flex items-center rounded-xl bg-moss px-5 py-3 font-medium text-white hover:bg-moss-deep"
          >
            {next.label}
          </Link>
          <Link
            to="/app/import"
            className="touch-target inline-flex items-center rounded-xl border border-line bg-white px-5 py-3 font-medium text-bark hover:bg-linen"
          >
            Import another file
          </Link>
        </div>
      </Card>
    </div>
  );
}

function History({
  batches,
  busy,
}: {
  batches: {
    id: string;
    kind: string;
    source: string | null;
    status: string;
    rows_created: number;
    rows_updated: number;
    rows_skipped: number;
    created_at: string;
  }[];
  busy: boolean;
}) {
  return (
    <section className="border-t border-line pt-8">
      <h2 className="font-display text-xl text-bark">What you've imported</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-soft">
        Reversing an import removes exactly the records it created and leaves everything else
        alone. Records it updated keep their updates — undoing an edit isn't something we can do
        honestly, so we don't pretend to.
      </p>

      <ul className="mt-5 divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
        {batches.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-bark">{b.source || b.kind}</p>
              <p className="mt-0.5 text-xs text-slate-soft">
                {new Date(b.created_at).toLocaleDateString()} · {b.rows_created} created,{" "}
                {b.rows_updated} updated
                {b.rows_skipped > 0 ? `, ${b.rows_skipped} skipped` : ""}
                {b.status === "reversed" ? " · reversed" : ""}
              </p>
            </div>
            {b.status === "complete" ? (
              <Form method="post">
                <input type="hidden" name="intent" value="reverse" />
                <input type="hidden" name="batchId" value={b.id} />
                <button
                  type="submit"
                  disabled={busy}
                  className="text-sm text-clay underline underline-offset-2 hover:text-bark disabled:opacity-50"
                >
                  Reverse this import
                </button>
              </Form>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
