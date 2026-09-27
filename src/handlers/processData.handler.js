// Stub handler: simulates a data processing run. No real I/O is performed.
export async function handle(payload) {
  await new Promise((resolve) => setTimeout(resolve, 1200));

  return { processed: true, source: payload?.source ?? null, records: payload?.records ?? null };
}

export default handle;
