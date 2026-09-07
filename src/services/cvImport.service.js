import { randomUUID } from 'node:crypto';
import mammoth from 'mammoth';
import PDFParser from 'pdf2json';
import { readSeekerFileForUser } from './seekerProfile.service.js';

const MAX_EXTRACTED_TEXT_LENGTH = 100_000;
const MAX_PDF_PAGES = 30;
const MAX_DOCX_ENTRIES = 300;
const MIN_MEANINGFUL_TEXT_LENGTH = 20;

const pdfSignature = (buffer) => buffer.subarray(0, 5).toString() === '%PDF-';
const docSignature = (buffer) => buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
const zipSignature = (buffer) => buffer.subarray(0, 2).equals(Buffer.from([0x50, 0x4b]));

export class CvImportError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.name = 'CvImportError';
    this.publicCode = code;
    this.status = status;
  }
}

const emptyCv = () => ({
  fullName: null,
  professionalTitle: null,
  bio: null,
  experience: [],
  education: [],
  skills: [],
  certifications: [],
  languages: [],
  projects: [],
  linkedinUrl: null,
});

const normalizeText = (text) => {
  const normalized = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[•●▪◦]/g, '-')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => !/^-+Page \(\d+\) Break-+$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (normalized.length > MAX_EXTRACTED_TEXT_LENGTH) {
    return {
      text: normalized.slice(0, MAX_EXTRACTED_TEXT_LENGTH),
      warnings: ['Some extracted CV text was truncated for safety.'],
    };
  }

  return { text: normalized, warnings: [] };
};

const hasMeaningfulText = (text) => text.replace(/[\s\W_]+/g, '').length >= MIN_MEANINGFUL_TEXT_LENGTH;

const detectFormat = (objectKey, buffer) => {
  const extension = String(objectKey).toLowerCase().split('.').pop();

  if (extension === 'pdf' && pdfSignature(buffer)) return 'pdf';
  if (extension === 'docx' && zipSignature(buffer) && buffer.includes(Buffer.from('[Content_Types].xml'))) return 'docx';
  if (extension === 'doc' && docSignature(buffer)) return 'doc';

  throw new CvImportError('UNSUPPORTED_RESUME_FORMAT', 'The stored CV format could not be verified.', 422);
};

const countZipEntries = (buffer) => {
  let count = 0;
  const signature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

  for (let offset = 0; offset <= buffer.length - signature.length; offset += 1) {
    if (buffer.subarray(offset, offset + signature.length).equals(signature)) count += 1;
    if (count > MAX_DOCX_ENTRIES) return count;
  }

  return count;
};

const extractPdfText = async (buffer) => {
  try {
    const result = await new Promise((resolve, reject) => {
      const parser = new PDFParser(null, 1);
      parser.on('pdfParser_dataReady', (data) => resolve({
        text: parser.getRawTextContent(),
        pages: Array.isArray(data?.Pages) ? data.Pages.length : 0,
      }));
      parser.on('pdfParser_dataError', (error) => reject(error?.parserError || new Error('PDF parser failed')));
      try {
        parser.parseBuffer(buffer);
      } catch (error) {
        reject(error);
      }
    });

    if (result.pages > MAX_PDF_PAGES) {
      throw new CvImportError('TEXT_EXTRACTION_FAILED', 'This CV has more pages than the import limit.', 422);
    }

    return result.text;
  } catch (error) {
    if (error instanceof CvImportError) throw error;
    throw new CvImportError('TEXT_EXTRACTION_FAILED', 'The PDF could not be read safely.', 422);
  }
};

const extractDocxText = async (buffer) => {
  if (countZipEntries(buffer) > MAX_DOCX_ENTRIES) {
    throw new CvImportError('TEXT_EXTRACTION_FAILED', 'This DOCX contains too many document parts to import safely.', 422);
  }

  try {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value, hadMessages: result.messages.length > 0 };
  } catch {
    throw new CvImportError('TEXT_EXTRACTION_FAILED', 'The DOCX could not be read safely.', 422);
  }
};

const headingKey = (line) => line.toLowerCase().replace(/[^a-z]/g, '');

const SECTION_NAMES = new Map([
  ['summary', 'summary'],
  ['profile', 'summary'],
  ['professionalsummary', 'summary'],
  ['aboutme', 'summary'],
  ['experience', 'experience'],
  ['workexperience', 'experience'],
  ['professionalexperience', 'experience'],
  ['employmenthistory', 'experience'],
  ['careerhistory', 'experience'],
  ['education', 'education'],
  ['academicbackground', 'education'],
  ['qualifications', 'education'],
  ['skills', 'skills'],
  ['technicalskills', 'skills'],
  ['coreskills', 'skills'],
  ['competencies', 'skills'],
  ['certifications', 'certifications'],
  ['certificates', 'certifications'],
  ['professionalcertifications', 'certifications'],
  ['languages', 'languages'],
  ['projects', 'projects'],
  ['worksamples', 'projects'],
]);

const splitSections = (text) => {
  const sections = { contact: [] };
  let current = 'contact';

  for (const line of text.split('\n')) {
    const nextSection = SECTION_NAMES.get(headingKey(line));
    if (nextSection) {
      current = nextSection;
      sections[current] ??= [];
      continue;
    }

    sections[current] ??= [];
    sections[current].push(line);
  }

  return sections;
};

const nonEmptyLines = (lines = []) => lines.map((line) => line.trim()).filter(Boolean);
const splitBlocks = (lines = []) => lines.join('\n').split(/\n\s*\n/).map((block) => nonEmptyLines(block.split('\n'))).filter((block) => block.length > 0);
const datePattern = /(?:19|20)\d{2}(?:[-/]\d{1,2})?|present|current|now/i;

const extractDateRange = (value) => {
  const matches = value.match(/(?:19|20)\d{2}(?:[-/]\d{1,2})?|present|current|now/gi) ?? [];
  const startDate = matches[0] ?? '';
  const endDate = matches[1] ?? '';
  const currentlyWorking = /present|current|now/i.test(value);
  return { startDate, endDate: currentlyWorking ? '' : endDate, currentlyWorking };
};

const parseExperience = (lines) => splitBlocks(lines).flatMap((block) => {
  if (block.length < 2) return [];
  const dateIndex = block.findIndex((line) => datePattern.test(line));
  const dateLine = dateIndex >= 0 ? block[dateIndex] : '';
  const details = block.filter((_, index) => index !== dateIndex);
  if (details.length < 2) return [];
  const dates = extractDateRange(dateLine);
  return [{
    id: randomUUID(),
    jobTitle: details[0],
    company: details[1],
    startDate: dates.startDate,
    endDate: dates.endDate,
    currentlyWorking: dates.currentlyWorking,
    description: details.slice(2).join(' '),
  }];
});

const parseEducation = (lines) => splitBlocks(lines).flatMap((block) => {
  if (block.length < 2) return [];
  const yearIndex = block.findIndex((line) => /(?:19|20)\d{2}/.test(line));
  const year = yearIndex >= 0 ? block[yearIndex] : '';
  const details = block.filter((_, index) => index !== yearIndex);
  return [{ id: randomUUID(), degree: details[0], school: details[1] ?? '', year }];
});

const parseCertifications = (lines) => splitBlocks(lines).flatMap((block) => {
  if (block.length === 0) return [];
  return [{ id: randomUUID(), name: block[0], issuer: block.slice(1).join(' ') }];
});

const parseLanguages = (lines) => nonEmptyLines(lines).flatMap((line) => {
  const parts = line.split(/\s+[-|:]\s+/);
  if (parts.length < 2) return [];
  const proficiency = ['Basic', 'Conversational', 'Professional', 'Fluent', 'Native']
    .find((level) => level.toLowerCase() === parts[1].trim().toLowerCase());
  if (!proficiency) return [];
  return [{ id: randomUUID(), name: parts[0].trim(), proficiency }];
});

const parseProjects = (lines) => splitBlocks(lines).flatMap((block) => {
  if (block.length === 0) return [];
  return [{
    id: randomUUID(),
    name: block[0],
    description: block.slice(1).join(' '),
    technologies: [],
    projectUrl: '',
    githubUrl: '',
    startDate: '',
    endDate: '',
  }];
});

const parseSkills = (lines) => [...new Set(nonEmptyLines(lines)
  .flatMap((line) => line.split(/[,;|•]/))
  .map((skill) => skill.replace(/^[-*]\s*/, '').trim())
  .filter((skill) => skill.length > 1 && skill.length <= 100))];

const parseStructuredCv = (text) => {
  const lines = nonEmptyLines(text.split('\n'));
  const email = text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] ?? null;
  const linkedinUrl = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[\w-]+/i)?.[0] ?? null;
  const namePattern = /^[A-Z][a-z]+(?:[-' ][A-Z][a-z]+){1,3}$/;
  const nameCandidates = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => namePattern.test(line));
  const reversedContactOrder = lines.slice(0, 3).some((line) => /[,;|]/.test(line)) && namePattern.test(lines.at(-1) ?? '');
  const sectionLines = reversedContactOrder ? [...lines].reverse() : lines;
  const sections = splitSections(sectionLines.join('\n'));
  const nameCandidate = reversedContactOrder ? nameCandidates.at(-1) : nameCandidates[0];
  const titleCandidate = reversedContactOrder ? nameCandidates.at(-2) : nameCandidates[1];
  const fullName = nameCandidate?.line ?? null;
  const professionalTitle = titleCandidate?.line ?? null;
  const warnings = [];
  if (reversedContactOrder) warnings.push('PDF reading order may have affected contact field detection.');
  const bio = nonEmptyLines(sections.summary).join(' ') || null;
  const experience = parseExperience(sections.experience);
  const education = parseEducation(sections.education);
  const certifications = parseCertifications(sections.certifications);
  const languages = parseLanguages(sections.languages);
  const projects = parseProjects(sections.projects);
  const skills = parseSkills(sections.skills);

  if (!experience.length && sections.experience?.length) warnings.push('Some experience entries could not be confidently identified.');
  if (!education.length && sections.education?.length) warnings.push('Some education entries could not be confidently identified.');
  if (!linkedinUrl) warnings.push('No LinkedIn profile was detected.');
  if (!text.includes('\n\n')) warnings.push('Document layout may have affected section detection.');

  return {
    cv: {
      fullName,
      professionalTitle,
      bio,
      experience,
      education,
      skills,
      certifications,
      languages,
      projects,
      linkedinUrl,
    },
    warnings,
    email,
  };
};

export const importSeekerResumeForUser = async (userId) => {
  const storedFile = await readSeekerFileForUser(userId, 'resumeObjectKey');
  if (!storedFile) {
    throw new CvImportError('RESUME_NOT_FOUND', 'Upload a CV before importing it.', 404);
  }

  const format = detectFormat(storedFile.objectKey, storedFile.buffer);
  if (format === 'doc') {
    throw new CvImportError('DOC_IMPORT_UNSUPPORTED', 'Automatic import is not available for legacy DOC files. Convert the CV to PDF or DOCX and upload it again.', 422);
  }

  const extraction = format === 'pdf'
    ? { text: await extractPdfText(storedFile.buffer), hadMessages: false }
    : await extractDocxText(storedFile.buffer);
  const normalized = normalizeText(extraction.text);
  if (!hasMeaningfulText(normalized.text)) {
    throw new CvImportError('TEXT_EXTRACTION_EMPTY', 'No readable CV text was found. Manual entry is required for this document.', 422);
  }

  const parsed = parseStructuredCv(normalized.text);
  const warnings = [...normalized.warnings, ...parsed.warnings];
  if (extraction.hadMessages || (format === 'pdf' && normalized.text.length < 100)) {
    warnings.push('Text extraction returned limited content. Some information may require manual entry.');
  }

  return {
    source: { format, filename: null },
    requiresReview: true,
    warnings: [...new Set(warnings)],
    cv: parsed.cv,
  };
};
