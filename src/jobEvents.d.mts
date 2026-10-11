export function readJobEvents(body: ReadableStream<Uint8Array>, onEvent: (value: any) => boolean | void): Promise<void>;
