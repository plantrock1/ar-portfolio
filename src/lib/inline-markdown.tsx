import type { ReactNode } from "react";

/**
 * Renders inline `*italic*` markdown for short user-supplied strings (e.g.
 * featured-media titles where album names should be italicized).
 *
 * Intentionally tiny — only handles single-asterisk italic spans. No bold,
 * no links, no lists. If we ever need more, swap in a proper micromark or
 * marked-renderer build, but for now this avoids the dependency weight.
 *
 * Safe: text content goes through React, which escapes by default. The
 * <em> wrapper is the only HTML produced.
 */
export function renderInlineItalics(text: string): ReactNode {
  if (!text) return text;
  // Split into runs: `*foo*` becomes its own group, everything else stays
  // verbatim. The group content must be non-empty and contain no nested
  // asterisks, which avoids ambiguity with `*a * b*`.
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return parts.map((part, i) => {
    if (
      part.length >= 3 &&
      part.startsWith("*") &&
      part.endsWith("*") &&
      part.slice(1, -1).trim().length > 0
    ) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}
