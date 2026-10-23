// Dependencies are injected so reinstall behaviour can be tested without native modules.
export function createDeviceIdentity({ platform, scope, androidId, readSecure, writeSecure, uuid, digest }) {
  let flight;
  async function resolve() {
    const namespace = await digest(`ota-device-v1:${scope}`);
    let seed;
    if (platform === 'android') {
      seed = androidId();
      if (!seed) throw new Error('Android ID unavailable');
    } else if (platform === 'ios') {
      const key = `ota-device-v1.${namespace}`;
      seed = await readSecure(key);
      if (!seed) {
        seed = uuid();
        await writeSecure(key, seed);
      }
    } else {
      return null;
    }
    return digest(`${namespace}:${platform}:${seed}`);
  }
  return () => {
    if (!flight) flight = resolve().catch((error) => { flight = undefined; throw error; });
    return flight;
  };
}
