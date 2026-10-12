import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

type HastNode = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

// The admin editor produces basic rich text plus <u>, styled <span> and <video>; everything else follows the default allowlist.
const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'video'],
  attributes: { ...defaultSchema.attributes, span: ['style'], video: ['src', 'controls', 'poster', 'preload'] },
};

// Only text color and font size survive from inline styles, with strictly shaped values.
const STYLE_RULES: Record<string, RegExp> = {
  color: /^(#[0-9a-f]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i,
  'font-size': /^(1[0-9]|[2-3][0-9]|4[0-8])px$/,
};
function cleanStyle(style: string): string {
  return style.split(';').map(rule => rule.split(':').map(part => part.trim())).filter(([name, value, ...rest]) => !rest.length && STYLE_RULES[name?.toLowerCase()]?.test(value ?? '')).map(([name, value]) => `${name.toLowerCase()}: ${value}`).join('; ');
}

// Embedded media is uploaded to the skill server as /media/...; never load images or video from anywhere else.
// Inline styles are narrowed here too, since the sanitizer only allowlists attribute names.
function restrictContent(serverUrl: string) {
  const visit = (node: HastNode) => {
    for (const key of ['src', 'poster']) {
      const value = node.properties?.[key];
      if (typeof value !== 'string') continue;
      try {
        const resolved = new URL(value, serverUrl);
        if (resolved.origin === serverUrl) { node.properties![key] = resolved.href; continue; }
      } catch {}
      delete node.properties![key];
    }
    const style = node.properties?.style;
    if (typeof style === 'string') {
      const cleaned = cleanStyle(style);
      if (cleaned) node.properties!.style = cleaned; else delete node.properties!.style;
    }
    node.children?.forEach(visit);
  };
  return () => (tree: HastNode) => visit(tree);
}

export function renderIntroduction(html: string, serverUrl: string): string {
  return String(unified().use(rehypeParse, { fragment: true }).use(rehypeSanitize, schema).use(restrictContent(serverUrl)).use(rehypeStringify).processSync(html));
}
