/** Elysia `set.redirect` is unreliable on Cloudflare Workers; use explicit 302. */
export function redirectTo(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location },
  });
}
