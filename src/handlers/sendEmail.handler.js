// Stub handler: simulates an email send. No real I/O is performed.
export async function handle(payload) {
  await new Promise((resolve) => setTimeout(resolve, 800));

  return { sent: true, to: payload?.to ?? null, provider: 'stub' };
}

export default handle;
