// SSE records may be split at any byte, including UTF-8 and CRLF boundaries.
export async function readJobEvents(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const dispatch = record => {
    const data = record.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data || data === '[DONE]') return true;
    return onEvent(JSON.parse(data)) !== false;
  };
  try {
    for (;;) {
      const {value, done} = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, {stream: true});
      // Normalize after accumulation so a CRLF split between chunks stays intact.
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const record = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (!dispatch(record)) return;
      }
      if (done) {
        if (buffer.trim()) dispatch(buffer);
        return;
      }
      if (buffer.length > 20 * 1024 * 1024) throw Error('ข้อมูลสถานะ AI ยาวเกินขีดจำกัด');
    }
  } finally {
    try { await reader.cancel(); } catch { /* connection already closed */ }
    reader.releaseLock();
  }
}
