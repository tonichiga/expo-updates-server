// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDevicesReport } from "./use-devices-report";

let root: Root;
let state: ReturnType<typeof useDevicesReport>;
const fetchReport = vi.fn<typeof fetch>();
const response = (total: number, offset = 0) =>
  Response.json({
    total,
    offset,
    pageSize: 20,
    options: { channels: [], runtimes: [] },
  });

function Screen() {
  const result = useDevicesReport();
  useLayoutEffect(() => {
    state = result;
  });
  return null;
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  fetchReport.mockReset().mockImplementation(async () => response(24));
  vi.stubGlobal("fetch", fetchReport);
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Screen />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("debounces typing, cancels pending searches on select/reset, and starts filtering at the first page", async () => {
  await act(async () => state.paginate(20));
  await act(async () => state.update("search", "a"));
  await act(async () => state.update("search", "ab"));
  expect(fetchReport).toHaveBeenCalledTimes(2);
  await act(async () => state.update("platform", "ios"));
  const params = new URL(
    String(fetchReport.mock.lastCall![0]),
    "http://localhost",
  ).searchParams;
  expect(Object.fromEntries(params)).toEqual({
    days: "7",
    offset: "0",
    search: "ab",
    platform: "ios",
  });
  await act(async () => state.update("search", "abc"));
  await act(async () => state.reset());
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(fetchReport).toHaveBeenCalledTimes(4);
  expect(String(fetchReport.mock.lastCall![0])).not.toContain("search=");
});

it("keeps the last success through errors and ignores late responses from aborted requests", async () => {
  let resolveLate!: (value: Response) => void;
  fetchReport.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveLate = resolve;
      }),
  );
  await act(async () => state.update("days", "1"));
  const signal = fetchReport.mock.lastCall![1]!.signal!;
  await act(async () => state.update("search", "a"));
  expect(signal.aborted).toBe(true);
  fetchReport.mockResolvedValueOnce(
    Response.json({ error: "Temporary outage" }, { status: 503 }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(state.error).toBe("Temporary outage");
  await act(async () => resolveLate(response(900)));
  expect(state.report?.total).toBe(24);
  expect(state.error).toBe("Temporary outage");
  fetchReport.mockResolvedValueOnce(response(2));
  await act(async () => state.refresh());
  expect(state.report?.total).toBe(2);
  expect(state.error).toBe("");
});

it("retrieves the last available page when a refresh shrinks the registry", async () => {
  fetchReport
    .mockResolvedValueOnce(response(23, 40))
    .mockResolvedValueOnce(response(23, 20));
  await act(async () => state.paginate(40));
  expect(String(fetchReport.mock.lastCall![0])).toContain("offset=20");
  expect(state.report?.offset).toBe(20);
  await act(async () => state.refresh());
  expect(String(fetchReport.mock.lastCall![0])).toContain("offset=20");
});
