interface DeviceIdentityDependencies {
  platform: string;
  scope: string;
  androidId(): string | null;
  readSecure(key: string): Promise<string | null>;
  writeSecure(key: string, value: string): Promise<void>;
  uuid(): string;
  digest(value: string): Promise<string>;
}

// Dependencies are injected so reinstall behaviour can be tested without native modules.
export function createDeviceIdentity({
  platform,
  scope,
  androidId,
  readSecure,
  writeSecure,
  uuid,
  digest,
}: DeviceIdentityDependencies) {
  let flight: Promise<string | null> | undefined;
  async function resolve() {
    const namespace = await digest(`ota-device-v1:${scope}`);
    let seed;
    if (platform === "android") {
      seed = androidId();
      if (!seed) throw new Error("Android ID unavailable");
    } else if (platform === "ios") {
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
    if (!flight)
      flight = resolve().catch((error) => {
        flight = undefined;
        throw error;
      });
    return flight;
  };
}
