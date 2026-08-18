const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * True when a route parameter looks like an aggregate id.
 *
 * Detail screens use this before fetching. Without it, a path the router did
 * not match to a more specific route — /faturas/nova before that route
 * existed — arrives as `:id`, and the screen dutifully issues
 * `GET /invoices/nova`, which the service rejects with a 400 that means nothing
 * to the person looking at it. Checking here turns a confusing server error
 * into the "não encontrado" the screen already knows how to render.
 */
export function isAggregateId(value: string | undefined): value is string {
  return typeof value === 'string' && UUID.test(value);
}
