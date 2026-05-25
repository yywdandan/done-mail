export function formatTime(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 24 * 60 * 60 * 1000;
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' });
  if (date.getTime() >= startToday) return time;
  if (date.getTime() >= startYesterday) return `昨天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

export function formatFullTime(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' }).replace(/\//g, '-');
  const time = date.toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
  return `${day} ${time}`;
}

export function formatBytes(value: number) {
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function plainTextFromHtml(html: string) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '').trim();
}

export function mailBodyText(mail: { textBody: string; htmlBody: string }) {
  return mail.textBody || plainTextFromHtml(mail.htmlBody) || '无正文';
}

function forceExternalLinks(html: string) {
  return html.replace(/<a\b([^>]*)>/gi, (_match, attrs: string) => {
    const cleanAttrs = String(attrs)
      .replace(/\s+target\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s+rel\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return `<a${cleanAttrs} target="_blank" rel="noopener noreferrer">`;
  });
}

const attributeValue = '(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))';
const imagePattern = /<img\b([^>]*)>/gi;

function attributePattern(name: string, flags = 'i') {
  return new RegExp(`\\s+${name}\\s*=\\s*${attributeValue}`, flags);
}

function readAttribute(attrs: string, name: string) {
  const match = attributePattern(name).exec(attrs);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function hasAttribute(attrs: string, name: string) {
  return attributePattern(name).test(attrs);
}

function removeAttribute(attrs: string, name: string) {
  return attrs.replace(attributePattern(name, 'gi'), '');
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function setAttribute(attrs: string, name: string, value: string) {
  return `${removeAttribute(attrs, name)} ${name}="${escapeAttribute(value)}"`;
}

function cleanImageAttrs(attrs: string) {
  const trimmed = attrs.trimEnd();
  return /(?:["']|\s)\/$/.test(trimmed) ? trimmed.slice(0, -1) : attrs;
}

function hideImage(attrs: string, reason: 'remote' | 'blocked') {
  let next = removeAttribute(removeAttribute(attrs, 'src'), 'srcset');
  next = setAttribute(next, 'data-dm-hidden-image', reason);
  const style = readAttribute(next, 'style').trim();
  const hiddenStyle = `${style}${style && !style.endsWith(';') ? ';' : ''}display:none!important;`;
  return setAttribute(next, 'style', hiddenStyle);
}

function isHttpsImageSource(value: string) {
  const source = value.trim();
  return /^https:\/\//i.test(source) || /^\/\//.test(source);
}

function isInlineImageSource(value: string) {
  return /^data:image\//i.test(value.trim());
}

function normalizeImageSource(value: string) {
  const source = value.trim();
  return source.startsWith('//') ? `https:${source}` : source;
}

function srcsetSources(value: string) {
  return value
    .split(',')
    .map((item) => item.trim().split(/\s+/)[0] || '')
    .filter(Boolean);
}

function hasHttpsImageSource(attrs: string) {
  const src = readAttribute(attrs, 'src');
  const srcset = readAttribute(attrs, 'srcset');
  if (src && isHttpsImageSource(src)) return true;
  return srcsetSources(srcset).some(isHttpsImageSource);
}

function normalizeSrcset(value: string) {
  const items = value
    .split(',')
    .map((item) => {
      const parts = item.trim().split(/\s+/);
      const source = parts[0] || '';
      if (!isHttpsImageSource(source)) return '';
      return [normalizeImageSource(source), ...parts.slice(1)].join(' ');
    })
    .filter(Boolean);
  return items.join(', ');
}

function prepareImageTags(html: string, allowRemoteImages: boolean) {
  return html.replace(imagePattern, (match, rawAttrs: string) => {
    let attrs = cleanImageAttrs(rawAttrs);
    const hasSrc = hasAttribute(attrs, 'src');
    const hasSrcset = hasAttribute(attrs, 'srcset');
    const src = hasSrc ? readAttribute(attrs, 'src') : '';
    const srcset = hasSrcset ? readAttribute(attrs, 'srcset') : '';
    const hasRemote = hasHttpsImageSource(attrs);
    const hasInline = isInlineImageSource(src);

    if (hasRemote && !allowRemoteImages) {
      return `<img${hideImage(attrs, 'remote')}>`;
    }

    if (hasSrc) {
      if (isHttpsImageSource(src) && allowRemoteImages) {
        attrs = setAttribute(attrs, 'src', normalizeImageSource(src));
      } else if (!isInlineImageSource(src)) {
        attrs = removeAttribute(attrs, 'src');
      }
    }

    if (hasSrcset) {
      const nextSrcset = allowRemoteImages ? normalizeSrcset(srcset) : '';
      attrs = nextSrcset ? setAttribute(attrs, 'srcset', nextSrcset) : removeAttribute(attrs, 'srcset');
    }

    const hasUsableSource = (hasInline || (allowRemoteImages && hasRemote)) && (readAttribute(attrs, 'src') || readAttribute(attrs, 'srcset'));
    if (!hasUsableSource && (hasSrc || hasSrcset)) {
      return `<img${hideImage(attrs, 'blocked')}>`;
    }

    return `<img${attrs}>`;
  });
}

export function hasRemoteImages(html: string) {
  imagePattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = imagePattern.exec(html))) {
    if (hasHttpsImageSource(match[1] || '')) return true;
  }
  return false;
}

export function mailHtmlSrcdoc(mail: { htmlBody: string; allowRemoteImages?: boolean }) {
  const html = mail.htmlBody.trim();
  const allowRemoteImages = Boolean(mail.allowRemoteImages);
  const imageSources = allowRemoteImages ? 'data: https:' : 'data:';
  const hiddenImageStyle = `
  img[data-dm-hidden-image] { display: none !important; }`;
  const shell = `
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imageSources}; media-src data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; navigate-to 'none'">
<base target="_blank">
<style>
  html, body { margin: 0; padding: 0; background: #fff; color: #111827; font: 14px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body { padding: 18px; overflow-wrap: anywhere; }
  img, video { max-width: 100% !important; height: auto !important; }
  table { width: 100% !important; max-width: 100% !important; min-width: 0 !important; table-layout: fixed; border-collapse: collapse; }
  th, td { min-width: 0 !important; overflow-wrap: anywhere; word-break: break-word; }
  pre, code, p, div { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
  a { color: #005bd1; }
  ${hiddenImageStyle}
</style>`;
  const body = forceExternalLinks(prepareImageTags(html, allowRemoteImages));
  if (/<head[\s>]/i.test(body)) return body.replace(/<head([^>]*)>/i, `<head$1>${shell}`);
  if (/<html[\s>]/i.test(body)) return body.replace(/<html([^>]*)>/i, `<html$1><head>${shell}</head>`);
  return `<!doctype html><html><head>${shell}</head><body>${body}</body></html>`;
}
