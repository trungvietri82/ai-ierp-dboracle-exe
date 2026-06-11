import { describe, expect, it } from 'vitest';

import { resolveMessageEndPayload, toUserFacingErrorText } from '../src/main/claude/agent-runner-message-end';

describe('resolveMessageEndPayload', () => {
  it('falls back to accumulated streamed text when message_end content is empty', () => {
    const result = resolveMessageEndPayload({
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'stop',
      },
      streamedText: 'streamed fallback',
    });

    expect(result.nextStreamedText).toBe('');
    expect(result.errorText).toBeUndefined();
    expect(result.shouldEmitMessage).toBe(true);
    expect(result.effectiveContent).toEqual([
      { type: 'text', text: 'streamed fallback' },
    ]);
  });

  it('surfaces user-facing error text when message_end stops with error', () => {
    const result = resolveMessageEndPayload({
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'first_response_timeout',
      },
      streamedText: 'partial text',
    });

    expect(result.nextStreamedText).toBe('');
    expect(result.shouldEmitMessage).toBe(false);
    expect(result.effectiveContent).toEqual([]);
    expect(result.errorText).toBe('Hết thời gian chờ phản hồi từ mô hình: chưa nhận được dữ liệu sau thời gian dài. Vui lòng thử lại hoặc kiểm tra tải của mô hình/gateway hiện tại.');
  });

  it('surfaces empty_success_result when message_end has no content and no streamed fallback', () => {
    const result = resolveMessageEndPayload({
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'stop',
      },
      streamedText: '',
    });

    expect(result.nextStreamedText).toBe('');
    expect(result.shouldEmitMessage).toBe(false);
    expect(result.effectiveContent).toEqual([]);
    expect(result.errorText).toBe('Mô hình trả về kết quả rỗng. Có thể mô hình hoặc gateway hiện tại không tương thích — vui lòng thử lại hoặc đổi giao thức rồi thử lại.');
  });
});

describe('toUserFacingErrorText', () => {
  it('maps 400 / bad request to configuration hint', () => {
    const result = toUserFacingErrorText('HTTP 400: bad request - ROLE_UNSPECIFIED');
    expect(result).toContain('Yêu cầu bị máy chủ từ chối (400)');
    expect(result).toContain('Lỗi gốc:');
    expect(result).toContain('ROLE_UNSPECIFIED');
  });

  it('maps invalid request to configuration hint', () => {
    const result = toUserFacingErrorText('invalid request: unsupported parameter "store"');
    expect(result).toContain('Yêu cầu bị máy chủ từ chối (400)');
    expect(result).toContain('Lỗi gốc:');
  });

  it('maps 401 to authentication hint', () => {
    const result = toUserFacingErrorText('Error 401: Unauthorized');
    expect(result).toContain('Xác thực thất bại');
    expect(result).toContain('API Key');
    expect(result).toContain('Lỗi gốc:');
  });

  it('maps 429 / rate limit to throttle hint', () => {
    const result = toUserFacingErrorText('429 Too Many Requests - rate limit exceeded');
    expect(result).toContain('Yêu cầu bị giới hạn tần suất (429)');
    expect(result).toContain('Lỗi gốc:');
  });

  it('passes through unknown errors unchanged', () => {
    const raw = 'some obscure upstream error';
    expect(toUserFacingErrorText(raw)).toBe(raw);
  });

  it('still maps first_response_timeout correctly (regression)', () => {
    expect(toUserFacingErrorText('first_response_timeout')).toBe(
      'Hết thời gian chờ phản hồi từ mô hình: chưa nhận được dữ liệu sau thời gian dài. Vui lòng thử lại hoặc kiểm tra tải của mô hình/gateway hiện tại.',
    );
  });

  it('maps 5xx server errors to upstream service hint', () => {
    const result = toUserFacingErrorText('HTTP 502: Bad Gateway');
    expect(result).toContain('Máy chủ thượng nguồn gặp sự cố');
    expect(result).toContain('Lỗi gốc:');
    expect(result).toContain('502');
  });

  it('maps "server error" to upstream service hint', () => {
    const result = toUserFacingErrorText('internal server error');
    expect(result).toContain('Máy chủ thượng nguồn gặp sự cố');
  });

  it('maps "overloaded" to upstream service hint', () => {
    const result = toUserFacingErrorText('overloaded_error');
    expect(result).toContain('Máy chủ thượng nguồn gặp sự cố');
  });

  it('maps "terminated" to network connection hint', () => {
    const result = toUserFacingErrorText('terminated');
    expect(result).toContain('Kết nối mạng bị gián đoạn');
    expect(result).toContain('terminated');
  });

  it('maps "connection error" to network connection hint', () => {
    const result = toUserFacingErrorText('connection error: ECONNRESET');
    expect(result).toContain('Kết nối mạng bị gián đoạn');
  });

  it('maps "fetch failed" to network connection hint', () => {
    const result = toUserFacingErrorText('fetch failed');
    expect(result).toContain('Kết nối mạng bị gián đoạn');
  });

  it('maps "other side closed" to network connection hint', () => {
    const result = toUserFacingErrorText('other side closed');
    expect(result).toContain('Kết nối mạng bị gián đoạn');
  });

  it('maps "too many requests" without status code to throttle hint', () => {
    const result = toUserFacingErrorText('too many requests');
    expect(result).toContain('Yêu cầu bị giới hạn tần suất (429)');
    expect(result).toContain('Lỗi gốc:');
  });

  it('maps "retry delay exceeded" to network connection hint', () => {
    const result = toUserFacingErrorText('retry delay exceeded');
    expect(result).toContain('Kết nối mạng bị gián đoạn');
  });
});
