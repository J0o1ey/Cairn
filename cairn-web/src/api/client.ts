// 简单的 fetch 封装，统一处理 JSON 与文本两种响应。
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

function extractMessage(status: number, data: unknown): string {
  if (data && typeof data === 'object') {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail
        .map(item => {
          if (item && typeof item === 'object' && 'msg' in item) {
            return String((item as { msg: unknown }).msg);
          }
          return String(item);
        })
        .join('; ');
    }
  }
  return `HTTP ${status}`;
}

export async function api<T = unknown>(
  method: Method,
  path: string,
  body?: unknown,
): Promise<T | null> {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined && body !== null) {
    init.body = JSON.stringify(body);
  }
  const resp = await fetch(path, init);
  if (resp.status === 204) return null;

  let data: unknown = null;
  const text = await resp.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!resp.ok) {
    throw new ApiError(extractMessage(resp.status, data), resp.status, data);
  }
  return data as T;
}

export async function fetchText(path: string): Promise<string> {
  const resp = await fetch(path);
  const text = await resp.text();
  if (!resp.ok) {
    let detail: string = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
        const d = (parsed as { detail: unknown }).detail;
        if (typeof d === 'string') detail = d;
      }
    } catch {
      /* not JSON, keep text as-is */
    }
    throw new ApiError(detail || `HTTP ${resp.status}`, resp.status, text);
  }
  return text;
}
