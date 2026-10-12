import { describe, expect, it } from 'vitest';
import { renderIntroduction } from './introduction';

const server = 'http://192.168.1.10:3000';

describe('skill introduction rendering', () => {
  it('keeps basic formatting and resolves server media', () => {
    const html = renderIntroduction('<h2>用法</h2><p><strong>粗</strong><u>线</u></p><img src="/media/a.png" alt="图"><video src="/media/b.mp4" controls=""></video>', server);
    expect(html).toContain('<h2>用法</h2>');
    expect(html).toContain('<u>线</u>');
    expect(html).toContain(`<img src="${server}/media/a.png" alt="图">`);
    expect(html).toContain(`<video src="${server}/media/b.mp4" controls></video>`);
  });

  it('keeps only text color and font size from inline styles', () => {
    const html = renderIntroduction('<p><span style="color: rgb(217, 48, 37); font-size: 20px">红</span><span style="position: fixed; background: url(http://evil.example/x)">x</span><span style="font-size: 900px">大</span></p>', server);
    expect(html).toContain('<span style="color: rgb(217, 48, 37); font-size: 20px">红</span>');
    expect(html).not.toMatch(/fixed|evil|900px/);
  });

  it('strips scripts, event handlers and media from other origins', () => {
    const html = renderIntroduction('<p onclick="alert(1)">x</p><script>alert(1)</script><img src="http://evil.example/t.png"><a href="javascript:alert(1)">y</a>', server);
    expect(html).not.toMatch(/onclick|script|evil\.example|javascript:/);
    expect(html).toContain('<img>');
  });
});
