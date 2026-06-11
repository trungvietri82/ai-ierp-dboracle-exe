import { describe, it, expect } from 'vitest';
import {
  normalizeLocalFileMarkdownLinks,
  extractLocalFilePathFromHref,
  resolveLocalFilePathFromHref,
} from '../src/renderer/utils/markdown-local-link';

describe('normalizeLocalFileMarkdownLinks', () => {
  it('normalizes absolute macOS path markdown links with spaces and newlines', () => {
    const input = [
      'Created a Word document:',
      '[weather.docx](',
      '/Users/haoqing/Library/Application Support/open-cowork/default_working_dir/weather.docx',
      ')',
    ].join('\n');

    const output = normalizeLocalFileMarkdownLinks(input);

    expect(output).toContain('[weather.docx](file:///Users/haoqing/Library/Application%20Support/open-cowork/default_working_dir/weather.docx)');
  });

  it('keeps web links unchanged', () => {
    const input = '[OpenAI](https://openai.com/docs)';
    expect(normalizeLocalFileMarkdownLinks(input)).toBe(input);
  });

  it('removes accidental line breaks inside local path href', () => {
    const input = '[document](/Users/haoqing/Library/Application\n Support/open-cowork/default_working_dir/document.docx)';
    const output = normalizeLocalFileMarkdownLinks(input);
    expect(output).toContain('file:///Users/haoqing/Library/Application%20Support/open-cowork/default_working_dir/document.docx');
    expect(output).not.toContain('%0A');
  });
});

describe('extractLocalFilePathFromHref', () => {
  it('extracts decoded local path from file URL', () => {
    const href = 'file:///Users/haoqing/Library/Application%20Support/open-cowork/test-file.docx';
    expect(extractLocalFilePathFromHref(href)).toBe('/Users/haoqing/Library/Application Support/open-cowork/test-file.docx');
  });

  it('extracts UNC paths from file URLs without dropping the host', () => {
    const href = 'file://server/share/test-file.docx';
    const result = extractLocalFilePathFromHref(href);
    if (process.platform === 'win32') {
      expect(result).toBe('\\\\server\\share\\test-file.docx');
    } else {
      expect(result).toBe('//server/share/test-file.docx');
    }
  });

  it('returns null for external URLs', () => {
    expect(extractLocalFilePathFromHref('https://openai.com')).toBe(null);
    expect(extractLocalFilePathFromHref('mailto:test@example.com')).toBe(null);
  });
});

describe('resolveLocalFilePathFromHref', () => {
  it('resolves relative artifact links using cwd', () => {
    const href = 'reports/weather.docx';
    expect(resolveLocalFilePathFromHref(href, '/Users/haoqing/Library/Application Support/open-cowork/default_working_dir'))
      .toBe('/Users/haoqing/Library/Application Support/open-cowork/default_working_dir/reports/weather.docx');
  });

  it('resolves /workspace links using cwd like artifact panel', () => {
    const href = '/workspace/reports/summary.docx';
    expect(resolveLocalFilePathFromHref(href, '/Users/haoqing/Library/Application Support/open-cowork/default_working_dir'))
      .toBe('/Users/haoqing/Library/Application Support/open-cowork/default_working_dir/reports/summary.docx');
  });

  it('normalizes line breaks before resolving local href', () => {
    const href = '/Users/haoqing/Library/Application\n Support/open-cowork/default_working_dir/document.docx';
    expect(resolveLocalFilePathFromHref(href, null))
      .toBe('/Users/haoqing/Library/Application Support/open-cowork/default_working_dir/document.docx');
  });

  it('keeps UNC paths intact after resolving file URLs', () => {
    const href = 'file://server/share/demo.txt';
    const result = resolveLocalFilePathFromHref(href, null);
    if (process.platform === 'win32') {
      expect(result).toBe('\\\\server\\share\\demo.txt');
    } else {
      expect(result).toBe('//server/share/demo.txt');
    }
  });
});
