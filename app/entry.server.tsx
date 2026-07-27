/**
 * The server entry, revealed from the framework default for one reason: to add
 * `handleError`. Everything above that export is React Router's own.
 *
 * Without it, an error thrown in a loader or an action is rendered by the
 * error boundary and then dropped on the floor — the shop sees "something went
 * sideways" and we never hear about it. That is the failure mode this whole
 * file exists to close.
 */
import type { ActionFunctionArgs, EntryContext, LoaderFunctionArgs, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import { envFrom } from "./lib/env";
import { reportError } from "./lib/sentry";

export const streamTimeout = 5_000;

export function handleError(
  error: unknown,
  { request, context }: LoaderFunctionArgs | ActionFunctionArgs
) {
  // Somebody navigated away mid-load. Not a fault, and reporting it would bury
  // the real ones under a pile of noise from people using the app normally.
  if (request.signal.aborted) return;

  // A thrown Response is a deliberate 404 or 403 — the app saying no, on
  // purpose. Those belong in the error boundary, not in an issue tracker.
  if (error instanceof Response) return;

  try {
    const url = new URL(request.url);
    reportError(envFrom(context as RouterContextProvider), error, {
      // Pathname only. A query string on this app can carry a receipt token or
      // a Stripe return code, and those must not leave the Worker.
      path: url.pathname,
      method: request.method,
    });
  } catch {
    // Reporting must never be the thing that breaks the request.
  }

  console.error(error);
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  let shellRendered = false;
  let userAgent = request.headers.get("user-agent");

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      signal: AbortSignal.timeout(streamTimeout + 1000),
      onError(error: unknown) {
        responseStatusCode = 500;
        // Log streaming rendering errors from inside the shell. Don't log
        // errors encountered during initial shell rendering since they'll
        // reject and get logged in handleDocumentRequest.
        if (shellRendered) {
          console.error(error);
        }
      },
    },
  );
  shellRendered = true;

  // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
  // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
