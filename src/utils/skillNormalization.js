export const normalizeSkills = (skills = []) => {
  if (!Array.isArray(skills)) return [];

  const seen = new Set();
  return skills.reduce((normalized, skill) => {
    const display = String(skill ?? '').trim();
    const key = display.toLocaleLowerCase();
    if (!display || seen.has(key)) return normalized;
    seen.add(key);
    normalized.push({ key, display });
    return normalized;
  }, []);
};
