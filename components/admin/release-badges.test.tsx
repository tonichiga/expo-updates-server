import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AudienceBadge,
  ChannelBadge,
  DeliveryBadge,
  PlatformBadge,
  ReleaseStatusBadge,
} from "./release-badges";

describe("release badge labels and states", () => {
  it("distinguishes an unpublished draft from a disabled published release", () => {
    const draft = renderToStaticMarkup(
      <ReleaseStatusBadge
        release={{ status: "disabled", policyEditable: true }}
      />,
    );
    const disabled = renderToStaticMarkup(
      <ReleaseStatusBadge
        release={{ status: "disabled", policyEditable: false }}
      />,
    );
    expect(draft).toContain('data-variant="warning"');
    expect(draft).toContain("draft</span>");
    expect(disabled).toContain('data-variant="neutral"');
    expect(disabled).toContain("disabled</span>");
  });
  it("preserves arbitrary registry and channel values, including their case", () => {
    for (const badge of [
      <ChannelBadge key="c" channel="Production" />,
      <PlatformBadge key="p" platform="custom" />,
    ]) {
      expect(renderToStaticMarkup(badge)).toContain('data-variant="neutral"');
    }
    expect(renderToStaticMarkup(<PlatformBadge platform="custom" />)).toContain(
      ">custom<",
    );
    expect(
      renderToStaticMarkup(<ChannelBadge channel="Production" />),
    ).toContain(">Production<");
  });
  it("keeps audience and delivery readable without relying on color", () => {
    expect(renderToStaticMarkup(<AudienceBadge mode="devices" />)).toContain(
      "Selected devices",
    );
    expect(renderToStaticMarkup(<DeliveryBadge mode="background" />)).toContain(
      "Background",
    );
  });
});
