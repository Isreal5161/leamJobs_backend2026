import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';
process.env.R2_ENDPOINT = 'https://test.r2.cloudflarestorage.com';
process.env.R2_BUCKET_NAME = 'test-bucket';
process.env.R2_ACCESS_KEY_ID = 'test-key-id';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';

const mockPrisma = {
  seekerProfile: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
};

// Mock the S3Client
let mockSend;
jest.unstable_mockModule('@aws-sdk/client-s3', () => {
  mockSend = jest.fn();
  return {
    S3Client: jest.fn(() => ({
      send: mockSend,
    })),
    PutObjectCommand: jest.fn((input) => input),
    GetObjectCommand: jest.fn((input) => input),
    DeleteObjectCommand: jest.fn((input) => input),
  };
});

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));

const { default: app } = await import('../src/app.js');

const seekerId = '11111111-1111-4111-8111-111111111111';
const secondSeekerId = '22222222-2222-4222-8222-222222222222';
const createToken = (role = 'SEEKER', subject = seekerId) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const createPdf = async (textLines) => {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  return new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    textLines.forEach((line) => doc.text(line));
    doc.end();
  });
};

const createDocx = async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml" /></Types>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Jane Doe</w:t></w:r></w:p><w:p><w:r><w:t>Product Designer</w:t></w:r></w:p><w:p><w:r><w:t>Skills</w:t></w:r></w:p><w:p><w:r><w:t>Figma, Research</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockPrisma.seekerProfile.findUnique.mockResolvedValue({ resumeObjectKey: 'seekers/user/resume/current.pdf' });
  const pdfBuffer = await createPdf([
    'John Doe',
    'Software Engineer',
    'john@example.com',
    'Summary',
    'Builds reliable software systems.',
    'Experience',
    'Software Engineer',
    'Example Company',
    '2022 - Present',
    'Built platform features.',
    'Skills',
    'JavaScript, Node.js, PostgreSQL',
  ]);
  mockSend.mockResolvedValue({ Body: (async function* () { yield pdfBuffer; })() });
});

describe('seeker resume import endpoint', () => {
  test('requires authentication and seeker role', async () => {
    const unauthenticated = await request(app).post('/api/seeker/profile/resume/import');
    expect(unauthenticated.status).toBe(401);

    const employer = await request(app)
      .post('/api/seeker/profile/resume/import')
      .set('Authorization', `Bearer ${createToken('EMPLOYER')}`);
    expect(employer.status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('returns a controlled error when no resume exists', async () => {
    mockPrisma.seekerProfile.findUnique.mockResolvedValueOnce({ resumeObjectKey: null });

    const response = await request(app)
      .post('/api/seeker/profile/resume/import')
      .set('Authorization', `Bearer ${createToken('SEEKER', '11111111-1111-4111-8111-111111111121')}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'RESUME_NOT_FOUND', message: 'Upload a CV before importing it.' },
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('extracts candidate data from a stored PDF without writing profile data', async () => {
    const response = await request(app)
      .post('/api/seeker/profile/resume/import')
      .set('Authorization', `Bearer ${createToken('SEEKER', '11111111-1111-4111-8111-111111111122')}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.requiresReview).toBe(true);
    expect(response.body.data.source.format).toBe('pdf');
    expect(response.body.data.cv.fullName).toBe('John Doe');
    expect(response.body.data.cv.skills).toEqual(expect.arrayContaining(['JavaScript', 'Node.js', 'PostgreSQL']));
    expect(mockSend).toHaveBeenCalled();
    expect(mockPrisma.seekerProfile.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.seekerProfile.update).not.toHaveBeenCalled();
  });

  test('fails safely for malformed PDF data', async () => {
    mockSend.mockResolvedValueOnce({ Body: (async function* () { yield Buffer.from('%PDF-1.7 malformed document'); })() });

    const response = await request(app)
      .post('/api/seeker/profile/resume/import')
      .set('Authorization', `Bearer ${createToken('SEEKER', '11111111-1111-4111-8111-111111111123')}`);

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('TEXT_EXTRACTION_FAILED');
  });

  test('extracts text from a valid DOCX document', async () => {
    mockPrisma.seekerProfile.findUnique.mockResolvedValueOnce({ resumeObjectKey: 'seekers/user/resume/current.docx' });
    const docxBuffer = await createDocx();
    mockSend.mockResolvedValueOnce({ Body: (async function* () { yield docxBuffer; })() });

    const response = await request(app)
      .post('/api/seeker/profile/resume/import')
      .set('Authorization', `Bearer ${createToken('SEEKER', '11111111-1111-4111-8111-111111111124')}`);

    expect(response.status).toBe(200);
    expect(response.body.data.source.format).toBe('docx');
    expect(response.body.data.cv.fullName).toBe('Jane Doe');
    expect(response.body.data.cv.skills).toEqual(expect.arrayContaining(['Figma', 'Research']));
    expect(response.body.data.requiresReview).toBe(true);
  });

  test('rejects legacy DOC import without changing upload support', async () => {
    mockPrisma.seekerProfile.findUnique.mockResolvedValueOnce({ resumeObjectKey: 'seekers/user/resume/current.doc' });
    mockSend.mockResolvedValueOnce({ Body: (async function* () { yield Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00]); })() });

    const response = await request(app)
      .post('/api/seeker/profile/resume/import')
      .set('Authorization', `Bearer ${createToken('SEEKER', '11111111-1111-4111-8111-111111111125')}`);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('DOC_IMPORT_UNSUPPORTED');
    expect(mockPrisma.seekerProfile.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.seekerProfile.update).not.toHaveBeenCalled();
  });

  test('extracts an Aparna-style CV while excluding template vendor content', async () => {
    mockPrisma.seekerProfile.findUnique.mockResolvedValueOnce({ resumeObjectKey: 'seekers/user/resume/aparna.pdf' });
    const aParnaBuffer = await createPdf([
      'Aparna Khatri',
      'Senior Graphic Design Specialist',
      'Profile:',
      'Senior Graphic Design Specialist with 6+ years of experience managing design processes, from conceptualization to delivery.',
      'Education:',
      'Bachelor Of Fine Arts In Graphic Design',
      'Rochester Technology, New York, NY',
      'May 2015',
      'GPA: 3.7/4.0',
      'Key Skills:',
      'InDesign',
      'Illustrator',
      'Photoshop',
      'Figma',
      'Blender',
      'Sketchbook',
      'Professional Experience:',
      'Senior Graphic Design Specialist',
      'Experion, New York, NY',
      'Sep 2019 - Present',
      'Led design strategy and delivered high-impact campaigns.',
      'Graphic Design Specialist',
      'Stepping Stone Advertising, New York, NY',
      'Jun 2017 - Aug 2019',
      'Created concept art and supported brand execution.',
      'Junior Graphic Designer',
      'Redfin Technologies, New Rochelle, NY',
      'Jun 2015 - May 2019',
      'Produced marketing and digital visuals for campaigns.',
      'Contact:',
      '+1 (555) 123-4567',
      'Chicago, Illinois',
      'aparna@example.com',
      'https://www.linkedin.com/in/aparna-khatri',
      'https://www.aparna-portfolio.com',
      'Dear Job Seeker',
      'Resume Builder',
      'How to Write a Resume',
      'Cover Letter Generator',
      'Fonts',
      'Lexend',
      'Inter',
      'installation instructions',
    ]);
    mockSend.mockResolvedValueOnce({ Body: (async function* () { yield aParnaBuffer; })() });

    const response = await request(app)
      .post('/api/seeker/profile/resume/import')
      .set('Authorization', `Bearer ${createToken('SEEKER', '11111111-1111-4111-8111-111111111133')}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.cv.fullName).toBe('Aparna Khatri');
    expect(response.body.data.cv.professionalTitle).toBe('Senior Graphic Design Specialist');
    expect(response.body.data.cv.bio).toContain('Senior Graphic Design Specialist');
    expect(response.body.data.cv.skills).toEqual(expect.arrayContaining(['InDesign', 'Illustrator', 'Photoshop', 'Figma', 'Blender', 'Sketchbook']));
    expect(response.body.data.cv.experience).toHaveLength(3);
    expect(response.body.data.cv.education[0].degree).toMatch(/Bachelor|Fine Arts|Graphic Design/i);
    expect(response.body.data.cv.education[0].school).toContain('Rochester');
    expect(response.body.data.cv.linkedinUrl).toContain('linkedin.com/in/aparna-khatri');
    expect(response.body.data.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/template|vendor|marketing|resume/i)]));
    expect(mockPrisma.seekerProfile.upsert).not.toHaveBeenCalled();
  });

  test('keeps deterministic extraction working when AI is unavailable or fails', async () => {
    const originalValue = process.env.CV_IMPORT_AI_ENABLED;
    const originalApiKey = process.env.OPENAI_API_KEY;
    process.env.CV_IMPORT_AI_ENABLED = 'true';
    delete process.env.OPENAI_API_KEY;
    const response = await request(app)
      .post('/api/seeker/profile/resume/import')
      .set('Authorization', `Bearer ${createToken('SEEKER', '11111111-1111-4111-8111-111111111144')}`);

    expect(response.status).toBe(200);
    expect(response.body.data.extraction.method).toBe('deterministic');
    expect(response.body.data.cv.fullName).toBe('John Doe');

    if (originalValue === undefined) delete process.env.CV_IMPORT_AI_ENABLED;
    else process.env.CV_IMPORT_AI_ENABLED = originalValue;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  });

  test('falls back to deterministic parsing when AI provider errors', async () => {
    const originalValue = process.env.CV_IMPORT_AI_ENABLED;
    const originalApiKey = process.env.OPENAI_API_KEY;
    process.env.CV_IMPORT_AI_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'test-api-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Bad gateway' } }),
    });

    const response = await request(app)
      .post('/api/seeker/profile/resume/import')
      .set('Authorization', `Bearer ${createToken('SEEKER', '11111111-1111-4111-8111-111111111145')}`);

    expect(response.status).toBe(200);
    expect(response.body.data.extraction.method).toBe('deterministic');
    expect(response.body.data.cv.fullName).toBe('John Doe');
    expect(response.body.data.warnings.join(' ')).toMatch(/AI|fallback|deterministic/i);

    if (originalValue === undefined) delete process.env.CV_IMPORT_AI_ENABLED;
    else process.env.CV_IMPORT_AI_ENABLED = originalValue;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    delete global.fetch;
  });

  test('falls back to deterministic parsing when AI provider times out', async () => {
    const originalValue = process.env.CV_IMPORT_AI_ENABLED;
    const originalApiKey = process.env.OPENAI_API_KEY;
    process.env.CV_IMPORT_AI_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'test-api-key';
    global.fetch = jest.fn(() => new Promise((_, reject) => {
      setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })), 0);
    }));

    const response = await request(app)
      .post('/api/seeker/profile/resume/import')
      .set('Authorization', `Bearer ${createToken('SEEKER', '11111111-1111-4111-8111-111111111146')}`);

    expect(response.status).toBe(200);
    expect(response.body.data.extraction.method).toBe('deterministic');
    expect(response.body.data.cv.fullName).toBe('John Doe');

    if (originalValue === undefined) delete process.env.CV_IMPORT_AI_ENABLED;
    else process.env.CV_IMPORT_AI_ENABLED = originalValue;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    delete global.fetch;
  });

  test('does not accept a client-supplied object key', async () => {
    await request(app)
      .post('/api/seeker/profile/resume/import')
      .send({ userId: 'another-user', resumeObjectKey: 'seekers/another-user/resume/cv.pdf' })
      .set('Authorization', `Bearer ${createToken('SEEKER', secondSeekerId)}`);

    expect(mockPrisma.seekerProfile.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: secondSeekerId } }));
  });
});
