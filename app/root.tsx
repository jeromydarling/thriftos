import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import { ToastHost } from "./components/toast";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "manifest", href: "/manifest.webmanifest" },
];

/**
 * Register the service worker.
 *
 * Inline and tiny on purpose — it must run before anything else can fail, and
 * a shop losing its connection mid-page-load shouldn't also lose the worker
 * that would have let the register keep working. Failure is silent: a browser
 * without service workers is a browser that just doesn't work offline, which
 * is a degradation rather than a fault.
 */
const REGISTER_SW = `
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {});
  });
}`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {/* Wraps everything, including the error boundary, so a message can
            outlive the screen that produced it — you save something, navigate
            on, and the confirmation (and its undo) is still there. */}
        <ToastHost>{children}</ToastHost>
        <ScrollRestoration />
        <Scripts />
        <script dangerouslySetInnerHTML={{ __html: REGISTER_SW }} />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let heading = "Something went sideways";
  let detail =
    "That's on us, not you. Try again in a moment — nothing you'd entered is lost.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      heading = "We couldn't find that page";
      detail = "The link may be old, or the page may have moved.";
    } else if (error.status === 403) {
      heading = "You don't have access to this";
      detail = typeof error.data === "string" ? error.data : "Ask an owner or admin to help.";
    } else {
      heading = `${error.status}`;
      detail = error.statusText || detail;
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    detail = error.message;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 text-center">
      <h1 className="font-display text-3xl text-bark">{heading}</h1>
      <p className="mt-4 leading-relaxed text-slate-soft">{detail}</p>
      <a
        href="/"
        className="mx-auto mt-8 rounded-lg bg-moss px-5 py-3 font-medium text-white hover:bg-moss-deep"
      >
        Back to the start
      </a>
    </main>
  );
}
