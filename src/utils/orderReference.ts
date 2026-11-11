/** Display only. Never use this value for routes, payments, webhooks or foreign keys. */
export function orderReference(order: { id: string; publicCode?: string | null }): string {
  return order.publicCode?.trim() || order.id;
}
