import { Link } from "react-router";

export function MarketingHeader() {
  return (
    <header className="border-b border-line bg-white">
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
        <Link to="/" className="font-display text-xl text-moss">
          ThriftOS
        </Link>
        <div className="flex items-center gap-1 text-sm sm:gap-4">
          <Link to="/nri" prefetch="intent" className="rounded-lg px-2 py-1 text-slate-soft hover:text-bark">
            NRI
          </Link>
          <Link to="/guides" prefetch="intent" className="rounded-lg px-2 py-1 text-slate-soft hover:text-bark">
            Guides
          </Link>
          <Link to="/pricing" prefetch="intent" className="rounded-lg px-2 py-1 text-slate-soft hover:text-bark">
            Pricing
          </Link>
          <Link
            to="/demo"
            className="rounded-lg bg-moss px-4 py-2 font-medium text-white hover:bg-moss-deep"
          >
            See the demo
          </Link>
        </div>
      </nav>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-white">
      <div className="mx-auto max-w-5xl px-4 py-12">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <p className="font-display text-lg text-moss">ThriftOS</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-soft">
              The register, the racks, and the relationships — with the impact reported
              beside the revenue.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-bark">Product</p>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-soft">
              <li>
                <Link to="/nri" className="hover:text-bark">
                  What NRI is
                </Link>
              </li>
              <li>
                <Link to="/pricing" className="hover:text-bark">
                  Pricing
                </Link>
              </li>
              <li>
                <Link to="/demo" className="hover:text-bark">
                  The demo shop
                </Link>
              </li>
              <li>
                <Link to="/signup" className="hover:text-bark">
                  Set up a shop
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-medium text-bark">Guides</p>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-soft">
              <li>
                <Link to="/guides" className="hover:text-bark">
                  All guides
                </Link>
              </li>
              <li>
                <Link to="/guides/donation-receipts-irs-rules" className="hover:text-bark">
                  Donation receipts
                </Link>
              </li>
              <li>
                <Link to="/guides/color-tag-markdown-system" className="hover:text-bark">
                  Colour-tag markdowns
                </Link>
              </li>
              <li>
                <Link to="/guides/thrift-store-software-comparison" className="hover:text-bark">
                  Honest comparison
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <p className="mt-10 border-t border-line pt-6 text-xs text-slate-soft">
          Built for shops of every size, from a church basement open two afternoons a week to
          a network of twenty stores.
        </p>
      </div>
    </footer>
  );
}

export function Section({
  children,
  tinted = false,
}: {
  children: React.ReactNode;
  tinted?: boolean;
}) {
  return (
    <section className={tinted ? "bg-white py-16 sm:py-24" : "py-16 sm:py-24"}>
      <div className="mx-auto max-w-5xl px-4">{children}</div>
    </section>
  );
}
