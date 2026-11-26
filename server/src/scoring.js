import { skillKey } from './skills.js';

const degrees = ['High school', 'Associate degree', 'Bachelor’s degree', 'Master’s degree', 'Doctorate'];

export function scoreFit(resume, job) {
  const skills = new Set(resume.skills.map((skill) => skillKey(skill.name)));
  const required = job.requiredSkills || [];
  const preferred = job.preferredSkills || [];
  const education = job.educationRequirements || [];
  const credentials = resume.credentials || [];
  const degreeLevel = Math.max(-1, ...credentials.map((name) => degrees.indexOf(name)));
  const matched = required.filter((name) => skills.has(skillKey(name)));
  const missing = required.filter((name) => !skills.has(skillKey(name)));
  const missingPreferred = preferred.filter((name) => !skills.has(skillKey(name)));
  const missingEducation = education.filter((name) => {
    const level = degrees.indexOf(name);
    return level < 0 ? !credentials.includes(name) : degreeLevel < level;
  });
  const requiredYears = job.minimumYears || 0;
  const resumeYears = resume.totalYears || 0;
  const parts = {
    skills: { weight: 50, ratio: required.length ? matched.length / required.length : null },
    preferred: { weight: 20, ratio: preferred.length ? 1 - missingPreferred.length / preferred.length : null },
    experience: { weight: 20, ratio: requiredYears ? Math.min(resumeYears / requiredYears, 1) : null },
    education: { weight: 10, ratio: education.length ? 1 - missingEducation.length / education.length : null }
  };
  const active = Object.values(parts).filter(({ ratio }) => ratio !== null);
  const totalWeight = active.reduce((sum, { weight }) => sum + weight, 0);
  const score = totalWeight
    ? Math.round(active.reduce((sum, { weight, ratio }) => sum + weight * ratio, 0) / totalWeight * 100)
    : null;
  const breakdown = Object.fromEntries(Object.entries(parts).map(([key, { weight, ratio }]) => [
    key, { weight, percent: ratio === null ? null : Math.round(ratio * 100) }
  ]));
  const suggestions = missing.slice(0, 4).map((skill) => 'If you have hands-on experience with ' + skill + ', add a bullet that states what you did and the result.');
  if (requiredYears > resumeYears) suggestions.push('Add dates to relevant roles and state your relevant experience clearly. The posting asks for ' + requiredYears + ' years.');
  if (missingEducation.length) suggestions.push('Check whether your resume lists these credentials: ' + missingEducation.join(', ') + '.');
  if (!suggestions.length && missingPreferred.length) suggestions.push('If applicable, show where you used ' + missingPreferred.slice(0, 3).join(', ') + '.');
  if (!suggestions.length) suggestions.push(score === null
    ? 'Paste a posting with explicit requirements to calculate a fit score.'
    : 'Make the strongest matching experience easy to find by placing it near the top and describing its outcome.');
  return { score, breakdown, matched, missing, missingPreferred, suggestions };
}
