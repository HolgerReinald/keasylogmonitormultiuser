/**
 * Keasy Log Monitor — Markdown → HTML Konverter
 */

function escapeHtmlServer(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inlineMarkdown(text) {
  text = escapeHtmlServer(text);
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    if (/^https?:\/\//i.test(url)) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
    return `${label} (${url})`;
  });
  return text;
}

function markdownToHtml(md) {
  const lines = md.split(/\r?\n/);
  let html = '';
  let inCodeBlock = false;
  let inTable = false;
  let inList = false;
  let listType = '';

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        html += '</code></pre>\n';
        inCodeBlock = false;
      } else {
        if (inList) { html += `</${listType}>\n`; inList = false; }
        if (inTable) { html += '</tbody></table>\n'; inTable = false; }
        html += '<pre><code>';
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      html += escapeHtmlServer(line) + '\n';
      continue;
    }

    if (line.includes('|') && line.trim().startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      if (cells.length > 0) {
        if (cells.every(c => /^[-:]+$/.test(c))) continue;
        if (!inTable) {
          if (inList) { html += `</${listType}>\n`; inList = false; }
          html += '<table><tbody>\n';
          inTable = true;
          html += '<tr>' + cells.map(c => `<th>${inlineMarkdown(c)}</th>`).join('') + '</tr>\n';
          continue;
        }
        html += '<tr>' + cells.map(c => `<td>${inlineMarkdown(c)}</td>`).join('') + '</tr>\n';
        continue;
      }
    } else if (inTable) {
      html += '</tbody></table>\n';
      inTable = false;
    }

    if (!line.trim()) {
      if (inList) { html += `</${listType}>\n`; inList = false; }
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      if (inList) { html += `</${listType}>\n`; inList = false; }
      const level = headingMatch[1].length;
      const text = inlineMarkdown(headingMatch[2]);
      if (level === 3) {
        html += `<details class="docs-collapsible"><summary><h${level}>${text}</h${level}></summary>\n`;
        let j = i + 1;
        while (j < lines.length) {
          const nextHeading = lines[j].match(/^(#{1,3})\s/);
          if (nextHeading && nextHeading[1].length <= level) break;
          j++;
        }
        const sectionLines = lines.slice(i + 1, j);
        html += markdownToHtml(sectionLines.join('\n'));
        html += '</details>\n';
        i = j - 1;
      } else {
        html += `<h${level}>${text}</h${level}>\n`;
      }
      continue;
    }

    if (line.startsWith('> ')) {
      if (inList) { html += `</${listType}>\n`; inList = false; }
      html += `<blockquote>${inlineMarkdown(line.slice(2))}</blockquote>\n`;
      continue;
    }

    if (/^[-*]\s/.test(line.trim())) {
      if (!inList || listType !== 'ul') {
        if (inList) html += `</${listType}>\n`;
        html += '<ul>\n';
        inList = true;
        listType = 'ul';
      }
      html += `<li>${inlineMarkdown(line.replace(/^\s*[-*]\s/, ''))}</li>\n`;
      continue;
    }

    if (/^\d+\.\s/.test(line.trim())) {
      if (!inList || listType !== 'ol') {
        if (inList) html += `</${listType}>\n`;
        html += '<ol>\n';
        inList = true;
        listType = 'ol';
      }
      html += `<li>${inlineMarkdown(line.replace(/^\s*\d+\.\s/, ''))}</li>\n`;
      continue;
    }

    if (inList) { html += `</${listType}>\n`; inList = false; }
    html += `<p>${inlineMarkdown(line)}</p>\n`;
  }

  if (inList) html += `</${listType}>\n`;
  if (inTable) html += '</tbody></table>\n';
  if (inCodeBlock) html += '</code></pre>\n';
  return html;
}

module.exports = { escapeHtmlServer, inlineMarkdown, markdownToHtml };
