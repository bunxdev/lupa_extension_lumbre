// Lumbre — minimal Markdown parser. Vanilla JS, ~250 lines, no deps.
//
// Scope (CommonMark-flavoured subset, biased to what cinder/Obsidian-style notes use):
//   - ATX headings: # … ######
//   - Paragraphs (blank-line separated)
//   - Setext headings (=== / ---) — optional, off by default for simplicity
//   - Bullet lists with -, *, +; ordered lists with `N.` (basic, single-level + nesting via 2-space indent)
//   - Blockquotes `> …` (one level)
//   - Fenced code blocks ``` and ~~~ (with optional language label)
//   - Indented code blocks (4-space)
//   - Horizontal rules: ---, ***, ___
//   - GitHub-flavoured tables (| h | h |\n| - | - |\n| c | c |)
//   - Inline: **bold**, *italic*, ~~strike~~, `code`, [text](url), <autolinks>, ![alt](url)
//   - Hard breaks at end-of-line backslash
//   - Raw HTML is escaped — never injected. This is a security boundary.
//
// Out of scope (deliberate): nested complex lists, footnotes, definition lists,
// reference-style links, embedded HTML.

(function () {
  'use strict';

  // -------- escape helpers --------

  // HTML-escape any user-provided content. Apply at every leaf so an attribute or
  // text node never carries unescaped < > & " '.
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Whitelist URL schemes we'll embed in href/src. Anything else (including
  // javascript:, vbscript:, data:text/html...) collapses to '#'.
  function safeUrl(raw) {
    if (!raw) return '#';
    const u = String(raw).trim().replace(/[\r\n]/g, '');
    if (/^(javascript|vbscript|file):/i.test(u)) return '#';
    if (/^data:/i.test(u)) {
      // Allow harmless image data URIs only.
      if (/^data:image\/(png|jpe?g|gif|svg\+xml|webp);/i.test(u)) return u;
      return '#';
    }
    return u.replace(/"/g, '%22');
  }

  // -------- inline tokeniser --------

  // Process inline tokens AFTER the line content has already been HTML-escaped.
  // We lean on the escape pass to neutralise all dangerous content and then layer
  // markup on top — that way a regex can't accidentally allow raw HTML.
  function inline(srcEscaped) {
    let s = srcEscaped;

    // Inline code first — its content shouldn't get any other inline transforms.
    // Backticks were not escaped above; they're safe to use as delimiters here.
    s = s.replace(/(`+)([^`]+?)\1/g, (_, _ticks, code) => '<code>' + code + '</code>');

    // Image: ![alt](url) — done before plain links so the leading ! sticks.
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]+)&quot;)?\)/g, (_, alt, url, _title) => {
      return '<img src="' + safeUrl(url) + '" alt="' + alt + '">';
    });

    // [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]+)&quot;)?\)/g, (_, text, url) => {
      return '<a href="' + safeUrl(url) + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
    });

    // Autolinks: <https://...>
    s = s.replace(/&lt;((?:https?|mailto|ftp):[^\s&]+)&gt;/g, (_, url) => {
      return '<a href="' + safeUrl(url) + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });

    // Strikethrough ~~text~~
    s = s.replace(/~~([^~]+?)~~/g, '<del>$1</del>');

    // Bold (**text** or __text__), then italic (*text* or _text_).
    // Order matters: bold first so `**foo**` doesn't degrade to italic+foo+italic.
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, '$1<em>$2</em>');

    // Hard breaks: trailing backslash → <br>
    s = s.replace(/\\$/gm, '<br>');

    return s;
  }

  // -------- block tokeniser --------

  function isHr(line) {
    return /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line);
  }
  function isFence(line) {
    return /^[ \t]{0,3}(```+|~~~+)([^`]*)$/.exec(line);
  }
  function isAtxHeading(line) {
    return /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
  }
  function isBlockquote(line) {
    return /^[ \t]{0,3}>[ \t]?(.*)$/.exec(line);
  }
  function isBullet(line) {
    return /^([ \t]*)([-*+])[ \t]+(.*)$/.exec(line);
  }
  function isOrdered(line) {
    return /^([ \t]*)(\d+)\.[ \t]+(.*)$/.exec(line);
  }
  function isTableSep(line) {
    // GFM allows ≥1 hyphens per cell — `| - | - |` is a valid separator.
    return /^[ \t]{0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/.test(line);
  }
  function isTableRow(line) {
    return /^[ \t]{0,3}\|.+\|[ \t]*$/.test(line) || /^[ \t]{0,3}[^|\s].*\|.*[^|]\s*$/.test(line);
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  }

  // Frontmatter strip — accept YAML/TOML-ish blocks bracketed by `---` / `+++`
  // at the top of the file. We don't render them; we surface as metadata if needed.
  function stripFrontmatter(src) {
    const m = src.match(/^(?:﻿)?(---|\+\+\+)\n([\s\S]*?)\n\1\n?/);
    if (!m) return { body: src, frontmatter: '' };
    return { body: src.slice(m[0].length), frontmatter: m[2] };
  }

  function parse(srcRaw) {
    if (typeof srcRaw !== 'string') return { html: '', frontmatter: '' };
    const norm = srcRaw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const { body, frontmatter } = stripFrontmatter(norm);
    const lines = body.split('\n');

    const html = [];
    let i = 0;

    // Helpers that emit pre-escaped, then inline-decorated HTML.
    function emitPara(buf) {
      const txt = buf.join('\n').trim();
      if (!txt) return;
      html.push('<p>' + inline(escHtml(txt)) + '</p>');
    }

    while (i < lines.length) {
      const line = lines[i];

      // Blank line: skip.
      if (/^[ \t]*$/.test(line)) { i++; continue; }

      // Fenced code block.
      const fence = isFence(line);
      if (fence) {
        const opener = fence[1];
        const lang = (fence[2] || '').trim();
        i++;
        const code = [];
        while (i < lines.length && !new RegExp('^[ \\t]{0,3}' + opener[0] + '{' + opener.length + ',}[ \\t]*$').test(lines[i])) {
          code.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // skip closing fence
        const cls = lang ? ' class="language-' + escHtml(lang) + '"' : '';
        html.push('<pre><code' + cls + '>' + escHtml(code.join('\n')) + '</code></pre>');
        continue;
      }

      // ATX heading.
      const ah = isAtxHeading(line);
      if (ah) {
        const level = ah[1].length;
        html.push('<h' + level + '>' + inline(escHtml(ah[2])) + '</h' + level + '>');
        i++;
        continue;
      }

      // Horizontal rule.
      if (isHr(line)) { html.push('<hr>'); i++; continue; }

      // Blockquote — collect contiguous `> ...` lines.
      if (isBlockquote(line)) {
        const buf = [];
        while (i < lines.length && isBlockquote(lines[i])) {
          buf.push(lines[i].replace(/^[ \t]{0,3}>[ \t]?/, ''));
          i++;
        }
        // Recursively render the contents so nested headings/code/etc work.
        const inner = parse(buf.join('\n')).html;
        html.push('<blockquote>' + inner + '</blockquote>');
        continue;
      }

      // Table — header row, separator, then body rows.
      if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = splitRow(line);
        const align = splitRow(lines[i + 1]).map((c) => {
          if (/^:-*:$/.test(c)) return 'center';
          if (/^:-*$/.test(c)) return 'left';
          if (/^-*:$/.test(c)) return 'right';
          return '';
        });
        i += 2;
        const rows = [];
        while (i < lines.length && isTableRow(lines[i])) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        const styled = (cell, j) => align[j] ? ' style="text-align:' + align[j] + '"' : '';
        const out = ['<table><thead><tr>'];
        head.forEach((c, j) => out.push('<th' + styled(c, j) + '>' + inline(escHtml(c)) + '</th>'));
        out.push('</tr></thead><tbody>');
        for (const row of rows) {
          out.push('<tr>');
          row.forEach((c, j) => out.push('<td' + styled(c, j) + '>' + inline(escHtml(c)) + '</td>'));
          out.push('</tr>');
        }
        out.push('</tbody></table>');
        html.push(out.join(''));
        continue;
      }

      // List (bullet or ordered).
      const bul = isBullet(line);
      const ord = isOrdered(line);
      if (bul || ord) {
        const isOrd = !!ord;
        const tag = isOrd ? 'ol' : 'ul';
        const items = [];
        while (i < lines.length) {
          const li = lines[i];
          const m = isOrd ? isOrdered(li) : isBullet(li);
          if (!m) {
            // continuation of the previous bullet (indented lines)
            if (items.length && /^\s+\S/.test(li) && !/^[ \t]*$/.test(li)) {
              items[items.length - 1] += '\n' + li.replace(/^\s+/, '');
              i++;
              continue;
            }
            break;
          }
          items.push(m[3]);
          i++;
        }
        const lis = items.map((t) => {
          const nested = t.includes('\n') ? parse(t).html : '<p>' + inline(escHtml(t)) + '</p>';
          // Strip wrapping <p> for single-line items so the bullet looks tight.
          if (nested.startsWith('<p>') && nested.endsWith('</p>') && !nested.slice(3, -4).includes('<p>')) {
            return '<li>' + nested.slice(3, -4) + '</li>';
          }
          return '<li>' + nested + '</li>';
        });
        html.push('<' + tag + '>' + lis.join('') + '</' + tag + '>');
        continue;
      }

      // Indented code block (4-space).
      if (/^ {4,}\S/.test(line)) {
        const buf = [];
        while (i < lines.length && (/^ {4,}/.test(lines[i]) || /^[ \t]*$/.test(lines[i]))) {
          buf.push(lines[i].replace(/^ {4}/, ''));
          i++;
        }
        // Trim trailing empty lines from the indented block.
        while (buf.length && /^[ \t]*$/.test(buf[buf.length - 1])) buf.pop();
        html.push('<pre><code>' + escHtml(buf.join('\n')) + '</code></pre>');
        continue;
      }

      // Paragraph: collect until blank line / next block-starter.
      const buf = [];
      while (i < lines.length && !/^[ \t]*$/.test(lines[i])) {
        const cur = lines[i];
        if (isAtxHeading(cur) || isFence(cur) || isHr(cur) || isBlockquote(cur) || isBullet(cur) || isOrdered(cur)) break;
        buf.push(cur);
        i++;
      }
      emitPara(buf);
    }

    return { html: html.join('\n'), frontmatter: frontmatter };
  }

  // Expose to viewer + tests.
  window.LumbreMd = { parse: parse, escHtml: escHtml, safeUrl: safeUrl, inline: inline };
})();
