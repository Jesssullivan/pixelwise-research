import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import { escapeSvelte } from 'mdsvex';
import { createHighlighter } from 'shiki';
import {
  transformerNotationDiff,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
  transformerNotationFocus,
  transformerMetaHighlight
} from '@shikijs/transformers';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get absolute path to project root for layout resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Shiki highlighter with dual themes for light/dark mode
// This is created once at config load time
const shikiHighlighter = await createHighlighter({
  themes: ['github-light', 'github-dark-default'],
  langs: [
    'javascript', 'typescript', 'svelte', 'html', 'css', 'json', 'yaml', 'markdown',
    'bash', 'shell', 'python', 'rust', 'go', 'java', 'c', 'cpp', 'sql', 'graphql',
    'dockerfile', 'nginx', 'toml', 'xml', 'diff', 'r', 'php', 'ruby',
    'swift', 'kotlin', 'scala', 'haskell', 'elixir', 'clojure', 'lua', 'vim',
    'plaintext', 'text'
  ]
});

/**
 * Custom Shiki highlighter for MDsveX
 *
 * IMPORTANT: Using MDsveX's highlight option instead of @shikijs/rehype plugin
 * because the rehype plugin breaks MDsveX's document structure when .mdx files
 * contain <script> tags, causing duplicate layout rendering.
 *
 * See: https://github.com/pngwn/MDsveX/issues/687
 */
function highlightCode(code, lang, meta) {
  // Handle Mermaid diagrams specially - output div structure for client-side rendering
  // BlogPostWrapper.svelte's renderMermaidDiagrams() looks for these elements
  if (lang === 'mermaid') {
    // Base64 encode the mermaid code to safely pass it as a data attribute
    // btoa() isn't available in Node.js, use Buffer instead
    const encoded = Buffer.from(code.trim()).toString('base64');
    const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;

    // Return a div that BlogPostWrapper.svelte will find and render
    // The div must have class="mermaid-diagram" and data-mermaid-code attribute
    return `<div class="mermaid-diagram my-6 not-prose" data-mermaid-code="${encoded}" data-mermaid-id="${id}"></div>`;
  }

  // Default to plaintext if language not specified or not supported
  const language = lang || 'text';

  try {
    // Generate HTML with dual themes (light/dark) using CSS variables
    const html = shikiHighlighter.codeToHtml(code, {
      lang: language,
      themes: {
        light: 'github-light',
        dark: 'github-dark-default'
      },
      // Use CSS variables for theme switching (same as before)
      defaultColor: false,
      // Apply Shiki transformers for enhanced features
      transformers: [
        transformerNotationDiff(),
        transformerNotationHighlight(),
        transformerNotationWordHighlight(),
        transformerNotationFocus(),
        transformerMetaHighlight()
      ]
    });

    // Escape Svelte special characters in the highlighted HTML
    const escaped = escapeSvelte(html);

    // Return as Svelte @html expression
    return `{@html \`${escaped}\`}`;
  } catch (error) {
    // Fallback: return code in a basic pre/code block if highlighting fails
    console.warn(`[mdsvex] Shiki highlighting failed for lang="${language}":`, error.message);
    const escaped = escapeSvelte(code);
    return `<pre><code class="language-${language}">${escaped}</code></pre>`;
  }
}

/** @type {import('mdsvex').MdsvexOptions} */
const config = {
  extensions: ['.svelte.md', '.md', '.svx', '.mdx'],

  // Use default MdsvexLayout for all markdown content
  // Note: mdsvex can't resolve $lib alias - use absolute paths via path.join
  layout: join(__dirname, 'src/lib/components/layout/MdsvexLayout.svelte'),

  rehypePlugins: [
    rehypeSlug,
    [rehypeAutolinkHeadings, {
      behavior: 'wrap',
      properties: {
        className: ['heading-link']
      }
    }],
    // NOTE: NOT using @shikijs/rehype here - it breaks MDsveX document structure
    // when .mdx files contain <script> tags. Using MDsveX's highlight option instead.
  ],

  // Use custom Shiki highlighter via MDsveX's highlight option
  // This works correctly with .mdx files containing interactive <script> blocks
  highlight: {
    highlighter: highlightCode
  }
};

export default config;
