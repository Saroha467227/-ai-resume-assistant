import { z } from 'zod';
import { findSkills, redactContact, skillIdentity, skillKey } from './skills.js';

const textList = z.array(z.string().min(1).max(240)).max(40);
const resumeSchema = z.object({
  extraSkills: z.array(z.object({
    name: z.string().min(1).max(80),
    evidence: z.string().min(1).max(240)
  })).max(35),
  experience: textList,
  education: textList,
  projects: textList
});
const jobSchema = z.object({
  requiredSkills: textList,
  preferredSkills: textList
});

const educationTerms = [
  ['High school', /\b(?:high school|secondary school)\b/i],
  ['Associate degree', /\b(?:associate(?:'s)? degree|A\.?A\.?S\.?)\b/i],
  ['Bachelor’s degree', /\b(?:bachelor(?:'s|’s)?|b\.?\s?(?:tech|sc|eng|e|a)\.?|undergraduate degree)\b/i],
  ['Master’s degree', /\b(?:master(?:'s|’s)?|m\.?\s?(?:tech|sc|eng|ba|ca)|postgraduate degree)\b/i],
  ['Doctorate', /\b(?:doctorate|ph\.?d)\b/i],
  ['PMP', /\bPMP\b/i],
  ['AWS certification', /\bAWS (?:certifi\w+|solutions architect|cloud practitioner)\b/i],
  ['CPA', /\bCPA\b/i],
  ['CompTIA Security+', /\b(?:CompTIA )?Security\+(?!\w)/i],
  ['CISSP', /\bCISSP\b/i],
  ['Scrum certification', /\b(?:CSM|certified scrum master|scrum certification)\b/i]
];
const yearsPattern = /\b(\d{1,2}(?:\.\d+)?)\s*(?:[-–]\s*\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b/gi;
const normalize = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();
const unique = (items) => [...new Set(items)];

function educationFrom(text) {
  return educationTerms.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function yearsFrom(text) {
  const matches = [...text.matchAll(yearsPattern)]
    .map((match) => Number(match[1])).filter((years) => years <= 55);
  return matches.length ? Math.max(...matches) : null;
}

function sections(text) {
  const result = { experience: [], education: [], projects: [] };
  const headings = {
    experience: /^(?:experience|work experience|professional experience|employment|employment history|work history|internships?)\s*:?\s*$/i,
    education: /^(?:education|qualifications|certifications?|education (?:and|&) certifications)\s*:?\s*$/i,
    projects: /^(?:projects|personal projects|selected projects|academic projects)\s*:?\s*$/i
  };
  let section;
  for (const line of text.split('\n').map((value) => value.trim()).filter(Boolean)) {
    const heading = Object.keys(headings).find((key) => headings[key].test(line));
    if (heading || /^(?:skills|technical skills|summary|profile|interests|awards|languages|references)\s*:?\s*$/i.test(line)) {
      section = heading;
    } else if (section && result[section].length < 30) {
      result[section].push(line.slice(0, 240));
    }
  }
  return result;
}

const monthNames = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');

function experienceMonths(lines) {
  const now = new Date();
  const current = now.getFullYear() * 12 + now.getMonth() + 1;
  const date = '(?:([A-Za-z]{3,9})\\s+)?((?:19|20)\\d{2})';
  const range = new RegExp('\\b' + date + '\\s*(?:[-–—]|to)\\s*(?:' + date + '|(present|current|now))\\b', 'gi');
  const months = new Set();
  for (const match of lines.join('\n').matchAll(range)) {
    const startMonth = monthNames.indexOf(match[1]?.slice(0, 3).toLowerCase());
    const endMonth = monthNames.indexOf(match[3]?.slice(0, 3).toLowerCase());
    const start = Number(match[2]) * 12 + Math.max(0, startMonth);
    const end = match[5] ? current : Number(match[4]) * 12 + (endMonth < 0 ? 0 : endMonth + 1);
    if (end <= start || end > current + 1 || end - start > 55 * 12) continue;
    for (let month = start; month < end; month++) months.add(month);
  }
  return Math.round(months.size / 1.2) / 10;
}

export async function extractResume(rawText, generate, userId) {
  const text = redactContact(rawText);
  const local = sections(text);
  const skills = new Map(findSkills(text).map((skill) => [skillKey(skill.name), skill]));
  const output = await generate({
    userId,
    instruction: 'Extract resume facts only. Return exact source excerpts for experience, education, projects and extra skill evidence. Each skill name must appear verbatim in its evidence. Use empty arrays when absent.',
    data: { resume: text.slice(0, 32_000) },
    schema: resumeSchema
  });
  const normalized = normalize(text);
  for (const item of output?.extraSkills || []) {
    const identity = skillIdentity(item.name);
    const key = skillKey(item.name);
    if (!skills.has(key) && normalized.includes(normalize(item.evidence)) && normalize(item.evidence).includes(normalize(item.name))) {
      skills.set(key, { ...identity, evidence: item.evidence });
    }
  }
  const sourceExcerpts = (key) => unique([
    ...local[key], ...(output?.[key] || []).filter((item) => normalized.includes(normalize(item)))
  ]).slice(0, 30);
  const experience = sourceExcerpts('experience');
  const statedYears = yearsFrom(text.split('\n').filter((line) => /\bexperience\b/i.test(line)).join('\n'));
  const inferredYears = experienceMonths(experience);
  return {
    skills: [...skills.values()],
    experience,
    education: sourceExcerpts('education'),
    credentials: educationFrom(sourceExcerpts('education').join('\n') || text),
    projects: sourceExcerpts('projects'),
    totalYears: Math.max(statedYears || 0, inferredYears),
    extractionSource: output ? 'gemini' : 'local'
  };
}

export async function extractJob(rawText, generate, userId) {
  const text = redactContact(rawText);
  const required = [];
  const preferred = [];
  let bucket = required;
  for (const line of text.split('\n')) {
    if (/^\s*[-•]?\s*(?:preferred|desirable|nice[- ]to[- ]have|bonus|advantage)/i.test(line)) bucket = preferred;
    else if (/^\s*[-•]?\s*(?:required|requirements?|minimum|must[- ]have|essential|qualifications)\b/i.test(line)) bucket = required;
    if (/^\s*(?:about (?:us|the role)|benefits|responsibilities|what you.ll do)\s*:?\s*$/i.test(line)) bucket = null;
    bucket?.push(line);
  }
  const requiredText = required.join('\n');
  const preferredText = preferred.join('\n');
  const requiredSkills = new Map(findSkills(requiredText).map((skill) => [skillKey(skill.name), skill.name]));
  const preferredSkills = new Map(findSkills(preferredText).map((skill) => [skillKey(skill.name), skill.name]));
  const output = await generate({
    userId,
    instruction: 'Extract only job-relevant skills the posting explicitly lists. Separate required and preferred skills using the wording. Return exact skill names present in the text. Omit benefits and company background.',
    data: { jobDescription: text.slice(0, 20_000) },
    schema: jobSchema
  });
  const normalizeText = normalize(text);
  for (const [values, map] of [[output?.requiredSkills, requiredSkills], [output?.preferredSkills, preferredSkills]]) {
    for (const value of values || []) {
      const key = skillKey(value);
      if (!requiredSkills.has(key) && !preferredSkills.has(key) && normalizeText.includes(normalize(value))) {
        map.set(key, skillIdentity(value).name);
      }
    }
  }
  for (const key of requiredSkills.keys()) preferredSkills.delete(key);
  const seniority = /\b(staff|principal|lead|senior|mid[- ]level|junior|entry[- ]level|intern(?:ship)?)\b/i.exec(text)?.[0] || '';
  return {
    requiredSkills: [...requiredSkills.values()],
    preferredSkills: [...preferredSkills.values()],
    minimumYears: yearsFrom(requiredText),
    educationRequirements: educationFrom(requiredText),
    seniority,
    extractionSource: output ? 'gemini' : 'local'
  };
}
