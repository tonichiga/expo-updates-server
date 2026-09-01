import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./guard-action-combobox.tsx", import.meta.url),
  "utf8",
);

describe("Guard action combobox semantics", () => {
  it("uses a named dialog popup instead of interactive listbox options", () => {
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-label="Guard action catalog"');
    expect(source).not.toMatch(/role="(?:listbox|option)"/);
  });

  it("keeps selection and catalog deletion as sibling buttons", () => {
    const optionRow = source.slice(
      source.indexOf("filteredOptions.map"),
      source.indexOf("{showCreate ?"),
    );
    expect(optionRow.match(/<button/g)).toHaveLength(2);
    expect(optionRow).toContain("chooseOption(option)");
    expect(optionRow).toContain("void onDelete(option)");
  });
});
