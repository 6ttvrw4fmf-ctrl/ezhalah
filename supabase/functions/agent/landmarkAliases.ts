// Read only the named recognition row. Its Arabic aliases still require location-catalog
// validation; a landmark's city/category alone never authorizes a citywide search.
export async function readLandmarkAliases(url: string, key: string, name: string, request = fetch): Promise<string[] | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 6000);
  try {
    const params = new URLSearchParams({ select: 'aliases', landmark_name: `eq.${name}`, limit: '2' });
    const response = await request(`${url}/rest/v1/landmarks?${params}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: ac.signal,
    });
    if (!response.ok) return null;
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1) return [];
    return Array.isArray(rows[0].aliases) ? rows[0].aliases.filter((s: unknown) => typeof s === 'string' && /[\u0600-\u06FF]/u.test(s)) : [];
  } catch { return null; } finally { clearTimeout(timer); }
}
