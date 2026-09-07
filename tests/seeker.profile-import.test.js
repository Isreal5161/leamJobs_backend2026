import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import JSZip from 'jszip';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  seekerProfile: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
};

const mockStorage = {
  createObjectKey: jest.fn(),
  uploadObject: jest.fn(),
  deleteObject: jest.fn(),
  readObject: jest.fn(),
};

jest.unstable_mockModule('../src/config/database.js', () => ({ prisma: mockPrisma, checkDatabaseHealth: jest.fn() }));
jest.unstable_mockModule('../src/services/storage/storage.service.js', () => mockStorage);

const { default: app } = await import('../src/app.js');

const seekerId = '11111111-1111-4111-8111-111111111111';
const secondSeekerId = '22222222-2222-4222-8222-222222222222';
const createToken = (role = 'SEEKER', subject = seekerId) => jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
  algorithm: 'HS256', issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h',
});

const createPdf = (textLines) => {
  const stream = `BT\n/F1 12 Tf\n72 260 Td\n${textLines.map((line) => `(${line.replace(/[()\\]/g, '\\$&')}) Tj\n0 -18 Td`).join('')}ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream) + 1} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output);
};

const createDocx = async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml" /></Types>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Jane Doe</w:t></w:r></w:p><w:p><w:r><w:t>Product Designer</w:t></w:r></w:p><w:p><w:r><w:t>Skills</w:t></w:r></w:p><w:p><w:r><w:t>Figma, Research</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.seekerProfile.findUnique.mockResolvedValue({ resumeObjectKey: 'seekers/user/resume/current.pdf' });
  mockStorage.readObject.mockResolvedValue(createPdf([
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
  ]));
});

describe('seeker resume import endpoint', () => {
  test('requires authentication and seeker role', async () => {
    const unauthenticated = await request(app).post('/api/seeker/profile/resume/import');
    expect(unauthenticated.status).toBe(401);

    const employer = await request(app)
      .post('/api/seeker/profile/resume/import')
      .set('Authorization', `Bearer ${createToken('EMPLOYER')}`);
    expect(employer.status).toBe(403);
    expect(mockStorage.readObject).not.toHaveBeenCalled();
  });

  test('returns a controlled error when no resume exists', async () => {
    mockPrisma.seekerProfile.findUnique.mockResolvedValueOnce({ resumeObjectKey: null });

    const response = await request(app)
      .post('/api/seeker/profile/resume/import')
      .set('Authorization', `Bearer ${createToken()}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'RESUME_NOT_FOUND', message: 'Upload a CV before importing it.' },
    });
    expect(mockStorage.readObject).not.toHaveBeenCalled();
  });

  test('extracts candidate data from a stored PDF without writing profile data', async () => {
    const response = await request(app)
      .post('/api/seeker/profile/resume/import')
      .set('Authorization', `Bearer ${createToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.requiresReview).toBe(true);
    expect(response.body.data.source.format).toBe('pdf');
    expect(response.body.data.cv.fullName).toBe('John Doe');
    expect(response.body.data.cv.skills).toEqual(expect.arrayContaining(['JavaScript', 'Node.js', 'PostgreSQL']));
    expect(mockStorage.readObject).toHaveBeenCalled();
    expect(mockPrisma.seekerProfile.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.seekerProfile.update).not.toHaveBeenCalled();
  });

  test('fails safely for malformed PDF data', async () => {
    mockStorage.readObject.mockResolvedValueOnce(Buffer.from('%PDF-1.7 malformed document'));

    const response = await request(app)
      .post('/api/seeker/profile/resume/import')
      .set('Authorization', `Bearer ${createToken()}`);

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('TEXT_EXTRACTION_FAILED');
  });

  test('extracts text from a valid DOCX document', async () => {
    mockPrisma.seekerProfile.findUnique.mockResolvedValueOnce({ resumeObjectKey: 'seekers/user/resume/current.docx' });
    mockStorage.readObject.mockResolvedValueOnce(await createDocx());

    const response = await request(app)
      .post('/api/seeker/profile/resume/import')
      .set('Authorization', `Bearer ${createToken()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.source.format).toBe('docx');
    expect(response.body.data.cv.fullName).toBe('Jane Doe');
    expect(response.body.data.cv.skills).toEqual(expect.arrayContaining(['Figma', 'Research']));
    expect(response.body.data.requiresReview).toBe(true);
  });

  test('rejects legacy DOC import without changing upload support', async () => {
    mockPrisma.seekerProfile.findUnique.mockResolvedValueOnce({ resumeObjectKey: 'seekers/user/resume/current.doc' });
    mockStorage.readObject.mockResolvedValueOnce(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00]));

    const response = await request(app)
      .post('/api/seeker/profile/resume/import')
      .set('Authorization', `Bearer ${createToken()}`);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('DOC_IMPORT_UNSUPPORTED');
    expect(mockPrisma.seekerProfile.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.seekerProfile.update).not.toHaveBeenCalled();
  });

  test('does not accept a client-supplied object key', async () => {
    await request(app)
      .post('/api/seeker/profile/resume/import')
      .send({ userId: 'another-user', resumeObjectKey: 'seekers/another-user/resume/cv.pdf' })
      .set('Authorization', `Bearer ${createToken('SEEKER', secondSeekerId)}`);

    expect(mockPrisma.seekerProfile.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: secondSeekerId } }));
  });
});
