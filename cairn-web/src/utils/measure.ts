// 基于 canvas 的文本测量工具，用于在浏览器里精确计算 Cytoscape 节点尺寸。
// 在 SSR / 没有 document 的环境会自动退化为字符宽度估算。

const CJK_RE =
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

let _canvas: HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | null = null;
let _ctxFont = '';

function getCtx(): CanvasRenderingContext2D | null {
  if (_ctx) return _ctx;
  if (typeof document === 'undefined') return null;
  _canvas = document.createElement('canvas');
  _ctx = _canvas.getContext('2d');
  return _ctx;
}

function setFont(fontSize: number) {
  const ctx = getCtx();
  if (!ctx) return null;
  const font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Inter, sans-serif`;
  if (font !== _ctxFont) {
    ctx.font = font;
    _ctxFont = font;
  }
  return ctx;
}

function estimateCharWidth(char: string, fontSize: number): number {
  // 与原始 Alpine 实现 estimateLabelCharWidth 保持一致的退化估算
  if (/\s/.test(char)) return fontSize * 0.35;
  if (CJK_RE.test(char)) return fontSize * 1.0;
  return fontSize * 0.58;
}

function measureCharWidth(char: string, fontSize: number): number {
  const ctx = setFont(fontSize);
  if (!ctx) return estimateCharWidth(char, fontSize);
  // canvas 在测空白时偏窄，特殊处理
  if (char === ' ') return Math.max(fontSize * 0.32, ctx.measureText(' ').width);
  if (char === '\t') return fontSize * 1.2;
  const width = ctx.measureText(char).width;
  // 极少数字体没加载完，width 会异常偏小，做下保护
  if (!Number.isFinite(width) || width <= 0) return estimateCharWidth(char, fontSize);
  return width;
}

interface MeasureResult {
  width: number;
  height: number;
}

/**
 * 按 maxWidth 折行测量文本所占宽高（单行字符宽度 = canvas measureText 实测）。
 * 与原 Alpine 实现的 measureWrappedText 行为对齐：
 *  - 显式 \n 一律换行
 *  - 字符级溢出自动折行（不识别英文单词边界，与原版一致）
 *  - 行高 = fontSize * 1.35
 *  - 返回宽度上限不超过 maxWidth、且不低于 fontSize*1.6
 */
export function measureWrappedText(text: string, maxWidth: number, fontSize: number): MeasureResult {
  const content = (text ?? '').toString().trim() || ' ';

  let currentWidth = 0;
  let currentChars = 0;
  let maxLineWidth = 0;
  let lineCount = 0;
  let pendingBlankLine = false;

  const flush = () => {
    if (currentChars === 0 && pendingBlankLine) {
      lineCount += 1;
    } else if (currentChars > 0) {
      lineCount += 1;
      maxLineWidth = Math.max(maxLineWidth, currentWidth);
    }
    currentWidth = 0;
    currentChars = 0;
    pendingBlankLine = false;
  };

  for (const char of Array.from(content)) {
    if (char === '\n') {
      pendingBlankLine = currentChars === 0; // 连续换行保留空行
      flush();
      continue;
    }
    const charWidth = measureCharWidth(char, fontSize);
    if (currentChars > 0 && currentWidth + charWidth > maxWidth) {
      flush();
    }
    currentWidth += charWidth;
    currentChars += 1;
  }
  flush();

  const lh = fontSize * 1.35;
  const finalLineCount = Math.max(1, lineCount);
  return {
    width: Math.min(maxWidth, Math.max(fontSize * 1.6, maxLineWidth)),
    height: finalLineCount * lh,
  };
}

interface FactNodePreset {
  fontSize: number;
  maxTextWidth: number;
  minWidth: number;
  minHeight: number;
  paddingX: number;
  paddingY: number;
}

const FACT_PRESETS: Record<'fact' | 'pillar', FactNodePreset> = {
  fact: { fontSize: 10, maxTextWidth: 116, minWidth: 52, minHeight: 34, paddingX: 10, paddingY: 10 },
  pillar: { fontSize: 11, maxTextWidth: 92, minWidth: 58, minHeight: 38, paddingX: 10, paddingY: 10 },
};

/**
 * 计算 fact / origin / goal / 长 bootstrap 节点的 cytoscape 节点宽高。
 *
 * @param label 节点最终展示的文本
 * @param kind  'fact' 表示中间事实节点；其它（origin/goal/bootstrap）使用 pillar 预设。
 */
export function factNodeSize(label: string, kind: 'fact' | 'pillar'): MeasureResult {
  const preset = FACT_PRESETS[kind];
  const measured = measureWrappedText(label, preset.maxTextWidth, preset.fontSize);
  return {
    width: Math.max(preset.minWidth, Math.ceil(measured.width + preset.paddingX * 2)),
    height: Math.max(preset.minHeight, Math.ceil(measured.height + preset.paddingY * 2)),
  };
}
