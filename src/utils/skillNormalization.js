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

export const calculateSkillMatch = (candidateSkills = [], jobSkills = []) => {
  const normalizedJobSkills = normalizeSkills(jobSkills);
  const candidateSkillKeys = new Set(normalizeSkills(candidateSkills).map((skill) => skill.key));
  const matchedSkills = normalizedJobSkills.filter((skill) => candidateSkillKeys.has(skill.key));

  return {
    score: normalizedJobSkills.length ? Math.round((matchedSkills.length / normalizedJobSkills.length) * 100) : null,
    matchedSkills: matchedSkills.map((skill) => skill.display),
    totalJobSkills: normalizedJobSkills.length,
  };
};
