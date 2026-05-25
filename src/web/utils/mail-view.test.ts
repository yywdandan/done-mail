import { describe, expect, it } from 'vitest';
import { hasRemoteImages, mailHtmlSrcdoc } from './mail-view';

describe('mail view', () => {
  it('默认隐藏远程图片并阻止 HTTPS 图片源', () => {
    const html = '<p>正文</p><img src="https://cdn.example.com/logo.png" alt="Logo"><img src="cid:logo">';
    const srcdoc = mailHtmlSrcdoc({ htmlBody: html });

    expect(hasRemoteImages(html)).toBe(true);
    expect(srcdoc).toContain('img-src data:;');
    expect(srcdoc).toContain('data-dm-hidden-image="remote"');
    expect(srcdoc).toContain('data-dm-hidden-image="blocked"');
    expect(srcdoc).not.toContain('src="https://cdn.example.com/logo.png"');
    expect(srcdoc).not.toContain('src="cid:logo"');
    expect(srcdoc).not.toContain('img-src data: https:;');
  });

  it('手动允许后才放开 HTTPS 远程图片源', () => {
    const srcdoc = mailHtmlSrcdoc({
      htmlBody: '<img src="//cdn.example.com/logo.png" alt="Logo"><img src="HTTPS://cdn.example.com/brand.png" alt="Brand">',
      allowRemoteImages: true
    });

    expect(srcdoc).toContain('img-src data: https:;');
    expect(srcdoc).toContain('src="https://cdn.example.com/logo.png"');
    expect(srcdoc).toContain('src="HTTPS://cdn.example.com/brand.png"');
    expect(srcdoc).not.toContain('data-dm-hidden-image="remote"');
  });

  it('支持手动显示 srcset 里的 HTTPS 远程图片', () => {
    const hidden = mailHtmlSrcdoc({
      htmlBody: '<img srcset="https://cdn.example.com/logo.png 1x, /open/logo-2x.png 2x" alt="Logo">'
    });
    const visible = mailHtmlSrcdoc({
      htmlBody: '<img srcset="https://cdn.example.com/logo.png 1x, /open/logo-2x.png 2x" alt="Logo">',
      allowRemoteImages: true
    });

    expect(hasRemoteImages('<img srcset="https://cdn.example.com/logo.png 1x">')).toBe(true);
    expect(hidden).toContain('data-dm-hidden-image="remote"');
    expect(hidden).not.toContain('srcset="https://cdn.example.com/logo.png 1x');
    expect(visible).toContain('srcset="https://cdn.example.com/logo.png 1x"');
    expect(visible).not.toContain('/open/logo-2x.png');
  });

  it('隐藏不能直接加载的相对图片避免裂图', () => {
    const srcdoc = mailHtmlSrcdoc({
      htmlBody: '<img src="/open/logo.png" srcset="/open/logo-2x.png 2x" alt="Logo"><img src="">'
    });

    expect(hasRemoteImages('<img src="/open/logo.png">')).toBe(false);
    expect(srcdoc).toContain('data-dm-hidden-image="blocked"');
    expect(srcdoc).not.toContain('src="/open/logo.png"');
    expect(srcdoc).not.toContain('srcset="/open/logo-2x.png 2x"');
    expect(srcdoc).not.toContain('src=""');
  });
});
