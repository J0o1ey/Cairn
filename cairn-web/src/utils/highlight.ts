// 简易 YAML / Timeline / 中文报告渲染（保持与原前端一致的视觉效果）。

export function escapeHtml(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightYamlScalar(value: string): string {
  const escaped = escapeHtml(value);
  if (!value.trim()) return escaped;
  if (/^\s*#.*$/.test(value)) return `<span style="color:#64748b">${escaped}</span>`;
  if (/^\s*['"].*['"]\s*$/.test(value)) return `<span style="color:#15803d">${escaped}</span>`;
  if (/^\s*\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})\s*$/.test(value)) return `<span style="color:#b45309">${escaped}</span>`;
  if (/^\s*(true|false|null|~)\s*$/i.test(value)) return `<span style="color:#b91c1c">${escaped}</span>`;
  if (/^\s*-?\d+(\.\d+)?\s*$/.test(value)) return `<span style="color:#0f766e">${escaped}</span>`;
  if (/^\s*(origin|goal|f\d+|i\d+)\s*$/i.test(value)) return `<span style="color:#6d28d9">${escaped}</span>`;
  return `<span style="color:#0f172a">${escaped}</span>`;
}

function highlightYamlLine(line: string): string {
  if (/^\s*$/.test(line)) return '';
  if (/^\s*#/.test(line)) return `<span style="color:#64748b">${escapeHtml(line)}</span>`;

  const listKeyMatch = line.match(/^(\s*-\s+)([^:#\n][^:]*):(.*)$/);
  if (listKeyMatch) {
    const [, prefix, key, rest] = listKeyMatch;
    return `${escapeHtml(prefix)}<span style="color:#7dd3fc">${escapeHtml(key)}</span>:${highlightYamlScalar(rest)}`;
  }

  const keyMatch = line.match(/^(\s*)([^:#\n][^:]*):(.*)$/);
  if (keyMatch) {
    const [, indent, key, rest] = keyMatch;
    return `${escapeHtml(indent)}<span style="color:#7dd3fc">${escapeHtml(key)}</span>:${highlightYamlScalar(rest)}`;
  }

  const listValueMatch = line.match(/^(\s*-\s+)(.*)$/);
  if (listValueMatch) {
    const [, prefix, rest] = listValueMatch;
    return `${escapeHtml(prefix)}${highlightYamlScalar(rest)}`;
  }

  return highlightYamlScalar(line);
}

interface YamlSectionTint {
  header: string;
  body: string;
  itemA: string;
  itemB: string;
}

function yamlSectionTint(name: string): YamlSectionTint {
  const tints: Record<string, YamlSectionTint> = {
    project: { header: '#eff6ff', body: '#fafcff', itemA: '#f3f8ff', itemB: '#edf5ff' },
    hints: { header: '#fffbeb', body: '#fffef8', itemA: '#fffaf0', itemB: '#fff6e8' },
    facts: { header: '#eef2ff', body: '#fafaff', itemA: '#f5f7ff', itemB: '#eef3ff' },
    intents: { header: '#ecfdf5', body: '#f8fdfb', itemA: '#f1fbf5', itemB: '#eaf8ef' },
  };
  return tints[name] ?? { header: '#f8fafc', body: '#ffffff', itemA: '#f8fafc', itemB: '#f1f5f9' };
}

export function highlightYaml(text: string): string {
  const lines = String(text ?? '').split('\n');
  let activeSection = 'project';
  let activeItemStripe = 0;
  let lastSawItem = false;
  return lines
    .map(line => {
      const lineHtml = highlightYamlLine(line) || '&nbsp;';
      const topLevelMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):/);
      if (topLevelMatch) {
        activeSection = topLevelMatch[1];
        activeItemStripe = 0;
        lastSawItem = false;
      }
      const isItemLine = /^\s*-\s+/.test(line) || (lastSawItem && /^\s+\S/.test(line));
      if (/^\s*-\s+/.test(line)) {
        activeItemStripe = 1 - activeItemStripe;
        lastSawItem = true;
      } else if (!/^\s/.test(line)) {
        lastSawItem = false;
      }

      const tint = yamlSectionTint(activeSection);
      let background = tint.body;
      let fontWeight = '400';
      if (topLevelMatch) {
        background = tint.header;
        fontWeight = '700';
      } else if (isItemLine) {
        background = activeItemStripe === 0 ? tint.itemA : tint.itemB;
      }
      return `<div style="white-space:pre;padding:0 16px;background:${background};font-weight:${fontWeight};color:#0f172a">${lineHtml}</div>`;
    })
    .join('');
}

export function highlightTimeline(text: string): string {
  const lines = String(text ?? '').split('\n');
  const stripes = ['#fffbf5', '#fef5ee'];
  let blockIndex = -1;
  return lines
    .map(line => {
      if (/^\[/.test(line)) blockIndex++;
      const bg = blockIndex < 0 ? stripes[0] : stripes[blockIndex % 2];
      const isBlank = /^\s*$/.test(line);
      return `<div style="white-space:pre;padding:0 16px;background:${bg};color:#0f172a">${
        isBlank ? '&nbsp;' : escapeHtml(line)
      }</div>`;
    })
    .join('');
}

