// Reads Firestore as the signed-in user (their ID token), so security rules apply
// and the server needs no service-account credentials.
export function decodeValue(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields);
  return null;
}

export function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

export function userFirestore(idToken, projectId, fetcher = fetch) {
  const origin = process.env.FIRESTORE_EMULATOR_HOST
    ? 'http://' + process.env.FIRESTORE_EMULATOR_HOST
    : 'https://firestore.googleapis.com';
  return {
    // Resolves to the document data, or undefined when it is missing or the rules deny the read.
    async get(path) {
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      const response = await fetcher(`${origin}/v1/projects/${projectId}/databases/(default)/documents/${encoded}`, {
        headers: { Authorization: 'Bearer ' + idToken },
      });
      if (response.status === 404 || response.status === 403) return undefined;
      if (!response.ok) throw Object.assign(Error('อ่านข้อมูลจาก Firestore ไม่สำเร็จ (' + response.status + ')'), { status: 502 });
      return decodeFields((await response.json()).fields);
    },
  };
}
