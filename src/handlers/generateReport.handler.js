// Stub handler: simulates report generation. No real I/O is performed.
export async function handle(payload) {
  await new Promise((resolve) => setTimeout(resolve, 1500));

  return { generated: true, reportName: payload?.reportName ?? null, format: payload?.format ?? 'pdf' };
}

export default handle;
