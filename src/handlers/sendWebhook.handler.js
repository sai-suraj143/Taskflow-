// Stub handler: simulates a webhook delivery. No real network call is performed.
export async function handle(payload) {
  await new Promise((resolve) => setTimeout(resolve, 600));

  return { delivered: true, url: payload?.url ?? null, statusCode: 200 };
}

export default handle;
