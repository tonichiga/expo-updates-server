const labels = {
  ru: { copy: "Копировать код", permalink: "Ссылка на раздел" },
  uk: { copy: "Копіювати код", permalink: "Посилання на розділ" },
};

// VitePress 1.x exposes these Markdown labels globally; resolve them per page.
export function localizeMarkdown(md) {
  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, index, options, env, renderer) => {
    const html = fence(tokens, index, options, env, renderer);
    const text = labels[env.relativePath?.split("/")[0]];
    return text ? html.replace('title="Copy Code" class="copy"', `title="${text.copy}" class="copy"`) : html;
  };

  const link = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    if (token.attrGet("class") === "header-anchor") {
      const text = labels[env.relativePath?.split("/")[0]];
      const label = token.attrGet("aria-label");
      if (label) {
        token.attrSet("aria-label", label
          .replace(/\s*\{#[^}]+\}/g, "")
          .replace(/^Permalink to/, text?.permalink ?? "Permalink to"));
      }
    }
    return link ? link(tokens, index, options, env, renderer) : renderer.renderToken(tokens, index, options);
  };
}
