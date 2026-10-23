// Pure controller: storage and network are injected so ordering is testable.
// One persisted envelope owns identity, sequence and the bounded outbox.
export function createInstallationClient({ read, write, uuid, snapshot, send, setIdentity, now = () => new Date().toISOString() }) {
  let state;
  let queue = Promise.resolve();
  let flight;
  const serial = (work) => {
    const result = queue.then(work);
    queue = result.catch(() => undefined);
    return result;
  };
  async function initialize() {
    if (state) return state;
    const stored = await read();
    if (stored) {
      const parsed = JSON.parse(stored);
      if (!parsed.installationId || !Number.isSafeInteger(parsed.sequence) || parsed.sequence < 0) throw new Error("Invalid OTA client state");
      state = parsed;
    } else {
      const next = { installationId: uuid(), sequence: 0, pending: null };
      await write(JSON.stringify(next));
      state = next;
    }
    return state;
  }
  const ready = () => serial(async () => {
    const current = await initialize();
    await setIdentity(current.installationId);
    return current.installationId;
  });
  async function flush() {
    if (flight) return flight;
    flight = (async () => {
      const pending = await serial(async () => (await initialize()).pending);
      if (!pending) return;
      await send(pending);
      await serial(async () => {
        if (state.pending?.eventId !== pending.eventId) return;
        const next = { ...state, pending: null };
        await write(JSON.stringify(next));
        state = next;
      });
    })();
    try { await flight; } finally { flight = undefined; }
  }
  async function observe() {
    await serial(async () => {
      const current = await initialize();
      await setIdentity(current.installationId);
      if (current.sequence >= Number.MAX_SAFE_INTEGER) throw new Error("OTA sequence exhausted");
      const sequence = current.sequence + 1;
      const pending = { ...snapshot(), installationId: current.installationId, eventId: uuid(), sequence, observedAt: now() };
      const next = { ...current, sequence, pending };
      await write(JSON.stringify(next));
      state = next;
    });
    await flush();
  }
  return { ready, observe, flush };
}
