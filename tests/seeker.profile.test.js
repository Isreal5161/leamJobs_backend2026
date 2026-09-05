import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_ISSUER = 'test-issuer';
process.env.JWT_AUDIENCE = 'test-audience';

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  seekerProfile: { upsert: jest.fn() },
};

jest.unstable_mockModule('../src/config/database.js', () => ({
  prisma: mockPrisma,
  checkDatabaseHealth: jest.fn(),
}));

const { default: app } = await import('../src/app.js');

const seekerId = '11111111-1111-4111-8111-111111111111';
const otherSeekerId = '22222222-2222-4222-8222-222222222222';

const createToken = (role = 'SEEKER', subject = seekerId) =>
  jwt.sign({ sub: subject, role }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_AUDIENCE,
    expiresIn: '1h',
  });

const createUserRecord = (overrides = {}) => ({
  id: seekerId,
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '+2348000000000',
  seekerProfile: {
    id: 'profile-1',
    country: 'Nigeria',
    state: 'Lagos',
    city: 'Ikeja',
    professionalTitle: 'Frontend Developer',
    location: 'Ikeja, Lagos, Nigeria',
    skills: ['React', 'TypeScript'],
    languages: [{ id: 'language-1', name: 'English', proficiency: 'Professional' }],
    projects: [{ id: 'project-1', name: 'LeamJobs', description: '', technologies: [], projectUrl: '', githubUrl: '', startDate: '', endDate: '' }],
  },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('seeker profile onboarding endpoints', () => {
  test('GET /api/seeker/profile returns the authenticated seeker profile data', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(createUserRecord());

    const response = await request(app)
      .get('/api/seeker/profile')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user).toMatchObject({
      id: seekerId,
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '+2348000000000',
    });
    expect(response.body.data.profile).toMatchObject({
      country: 'Nigeria',
      state: 'Lagos',
      city: 'Ikeja',
      professionalTitle: 'Frontend Developer',
      skills: ['React', 'TypeScript'],
      languages: [{ name: 'English', proficiency: 'Professional' }],
      projects: [{ name: 'LeamJobs' }],
    });
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  test('GET /api/seeker/profile returns 401 without authentication', async () => {
    const response = await request(app).get('/api/seeker/profile');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Invalid authentication token' });
  });

  test('GET /api/seeker/profile returns 403 for an EMPLOYER token', async () => {
    const response = await request(app)
      .get('/api/seeker/profile')
      .set('Authorization', `Bearer ${createToken('EMPLOYER')}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Forbidden' });
  });

  test('PATCH /api/seeker/profile updates onboarding fields for the authenticated seeker only', async () => {
    mockPrisma.seekerProfile.upsert.mockResolvedValue({
      id: 'profile-1',
      userId: seekerId,
      country: 'Nigeria',
      state: 'Lagos',
      city: 'Ikeja',
      professionalTitle: 'Senior Frontend Developer',
      location: 'Ikeja, Lagos, Nigeria',
      skills: ['React', 'TypeScript', 'Node.js'],
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    });

    const response = await request(app)
      .patch('/api/seeker/profile')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({
        country: 'Nigeria',
        state: 'Lagos',
        city: 'Ikeja',
        professionalTitle: 'Senior Frontend Developer',
        skills: ['React', 'TypeScript', 'Node.js'],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      country: 'Nigeria',
      state: 'Lagos',
      city: 'Ikeja',
      professionalTitle: 'Senior Frontend Developer',
      skills: ['React', 'TypeScript', 'Node.js'],
      location: 'Ikeja, Lagos, Nigeria',
    });
    expect(mockPrisma.seekerProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: seekerId },
    }));
  });

  test('PATCH /api/seeker/profile rejects unknown client-controlled fields', async () => {
    const response = await request(app)
      .patch('/api/seeker/profile')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({
        country: 'Nigeria',
        state: 'Lagos',
        city: 'Ikeja',
        userId: otherSeekerId,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
  });

  test('PATCH /api/seeker/profile rejects empty or invalid onboarding values', async () => {
    const response = await request(app)
      .patch('/api/seeker/profile')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({
        country: '   ',
        state: '',
        city: 'Ikeja',
        professionalTitle: '',
        skills: ['React', '   ', 'TypeScript'],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
    expect(response.body.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'country', message: expect.any(String) }),
      expect.objectContaining({ field: 'state', message: expect.any(String) }),
      expect.objectContaining({ field: 'professionalTitle', message: expect.any(String) }),
    ]));
    expect(response.body.errors.some((error) => error.field.startsWith('skills'))).toBe(true);
  });

  test('GET /api/seeker/profile returns the neutral profile object when the seeker has no profile', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: seekerId,
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '+2348000000000',
      seekerProfile: null,
    });

    const response = await request(app)
      .get('/api/seeker/profile')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user).toMatchObject({
      id: seekerId,
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '+2348000000000',
    });
    expect(response.body.data.profile).toEqual({
      id: null,
      country: null,
      state: null,
      city: null,
      professionalTitle: null,
      location: null,
      skills: [],
      bio: null,
      education: null,
      experience: null,
      certifications: null,
      languages: null,
      projects: null,
      cvTemplate: null,
      linkedinUrl: null,
      resumeUrl: null,
      resumeObjectKey: null,
      profilePictureUrl: null,
      profilePictureKey: null,
    });
  });

  test('PATCH /api/seeker/profile creates a profile when the authenticated seeker has no existing profile', async () => {
    mockPrisma.seekerProfile.upsert.mockResolvedValue({
      id: 'profile-1',
      userId: seekerId,
      country: 'Nigeria',
      state: 'Lagos',
      city: 'Ikeja',
      professionalTitle: 'Frontend Developer',
      location: 'Ikeja, Lagos, Nigeria',
      skills: ['React', 'TypeScript'],
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    });

    const response = await request(app)
      .patch('/api/seeker/profile')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({
        country: 'Nigeria',
        state: 'Lagos',
        city: 'Ikeja',
        professionalTitle: 'Frontend Developer',
        skills: ['React', 'TypeScript'],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      country: 'Nigeria',
      state: 'Lagos',
      city: 'Ikeja',
      professionalTitle: 'Frontend Developer',
      location: 'Ikeja, Lagos, Nigeria',
      skills: ['React', 'TypeScript'],
    });

    expect(mockPrisma.seekerProfile.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.seekerProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: seekerId },
      create: expect.objectContaining({
        userId: seekerId,
        country: 'Nigeria',
        state: 'Lagos',
        city: 'Ikeja',
        professionalTitle: 'Frontend Developer',
        skills: ['React', 'TypeScript'],
        location: 'Ikeja, Lagos, Nigeria',
      }),
      update: expect.objectContaining({
        country: 'Nigeria',
        state: 'Lagos',
        city: 'Ikeja',
        professionalTitle: 'Frontend Developer',
        skills: ['React', 'TypeScript'],
        location: 'Ikeja, Lagos, Nigeria',
      }),
    }));

    expect(Object.keys(mockPrisma.seekerProfile.upsert.mock.calls[0][0].create)).not.toContain('bio');
    expect(Object.keys(mockPrisma.seekerProfile.upsert.mock.calls[0][0].create)).not.toContain('education');
    expect(Object.keys(mockPrisma.seekerProfile.upsert.mock.calls[0][0].create)).not.toContain('experience');
    expect(Object.keys(mockPrisma.seekerProfile.upsert.mock.calls[0][0].create)).not.toContain('resumeUrl');
    expect(Object.keys(mockPrisma.seekerProfile.upsert.mock.calls[0][0].create)).not.toContain('profilePictureUrl');
  });

  test('PATCH /api/seeker/profile preserves existing non-onboarding profile fields', async () => {
    mockPrisma.seekerProfile.upsert.mockResolvedValue({
      id: 'profile-1',
      userId: seekerId,
      country: 'Nigeria',
      state: 'Lagos',
      city: 'Ikeja',
      professionalTitle: 'Frontend Developer',
      location: 'Ikeja, Lagos, Nigeria',
      skills: ['React', 'TypeScript'],
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    });

    const response = await request(app)
      .patch('/api/seeker/profile')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({
        country: 'Nigeria',
        state: 'Lagos',
        city: 'Ikeja',
        professionalTitle: 'Frontend Developer',
        skills: ['React', 'TypeScript'],
      });

    expect(response.status).toBe(200);

    const upsertArgs = mockPrisma.seekerProfile.upsert.mock.calls[0][0];
    expect(upsertArgs.update).toEqual(expect.objectContaining({
      country: 'Nigeria',
      state: 'Lagos',
      city: 'Ikeja',
      professionalTitle: 'Frontend Developer',
      skills: ['React', 'TypeScript'],
      location: 'Ikeja, Lagos, Nigeria',
    }));
    expect(upsertArgs.update).not.toHaveProperty('bio');
    expect(upsertArgs.update).not.toHaveProperty('education');
    expect(upsertArgs.update).not.toHaveProperty('experience');
    expect(upsertArgs.update).not.toHaveProperty('resumeUrl');
    expect(upsertArgs.update).not.toHaveProperty('profilePictureUrl');
    expect(upsertArgs.create).not.toHaveProperty('bio');
    expect(upsertArgs.create).not.toHaveProperty('education');
    expect(upsertArgs.create).not.toHaveProperty('experience');
    expect(upsertArgs.create).not.toHaveProperty('resumeUrl');
    expect(upsertArgs.create).not.toHaveProperty('profilePictureUrl');
  });

  test('PATCH /api/seeker/profile accepts fullName and splits it into firstName and lastName without storing a duplicate fullName field', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: seekerId,
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '+2348000000000',
      seekerProfile: null,
    });
    mockPrisma.user.update.mockResolvedValue({
      id: seekerId,
      firstName: 'Jane',
      lastName: 'Mary Doe',
      email: 'jane@example.com',
      phone: '+2348000000000',
    });

    mockPrisma.seekerProfile.upsert.mockResolvedValue({
      id: 'profile-1',
      userId: seekerId,
      country: 'Nigeria',
      state: 'Lagos',
      city: 'Ikeja',
      professionalTitle: 'Frontend Developer',
      location: 'Ikeja, Lagos, Nigeria',
      skills: ['React', 'TypeScript'],
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    });

    const response = await request(app)
      .patch('/api/seeker/profile')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({
        fullName: 'Jane Mary Doe',
        country: 'Nigeria',
        state: 'Lagos',
        city: 'Ikeja',
        professionalTitle: 'Frontend Developer',
        skills: ['React', 'TypeScript'],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      country: 'Nigeria',
      state: 'Lagos',
      city: 'Ikeja',
      professionalTitle: 'Frontend Developer',
      skills: ['React', 'TypeScript'],
    });
  });

  test('PATCH /api/seeker/profile does not create duplicate seeker profiles for the same user', async () => {
    mockPrisma.seekerProfile.upsert.mockResolvedValue({
      id: 'profile-1',
      userId: seekerId,
      country: 'Nigeria',
      state: 'Lagos',
      city: 'Ikeja',
      professionalTitle: 'Frontend Developer',
      location: 'Ikeja, Lagos, Nigeria',
      skills: ['React'],
    });

    const response = await request(app)
      .patch('/api/seeker/profile')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({
        country: 'Nigeria',
        state: 'Lagos',
        city: 'Ikeja',
        professionalTitle: 'Frontend Developer',
        skills: ['React'],
      });

    expect(response.status).toBe(200);
    expect(mockPrisma.seekerProfile.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.seekerProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: seekerId },
    }));
  });
});

describe('seeker profile CV endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/seeker/profile returns linkedinUrl, bio, education, experience, certifications, and cvTemplate', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: seekerId,
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '+2348000000000',
      seekerProfile: {
        id: 'profile-1',
        country: 'Nigeria',
        state: 'Lagos',
        city: 'Ikeja',
        professionalTitle: 'Frontend Developer',
        location: 'Ikeja, Lagos, Nigeria',
        skills: ['React', 'TypeScript'],
        bio: 'Experienced frontend developer',
        linkedinUrl: 'https://linkedin.com/in/janedoe',
        education: [
          { id: '1', degree: 'B.Sc. Computer Science', school: 'University', year: '2020' },
        ],
        experience: [
          { id: '1', jobTitle: 'Frontend Developer', company: 'Company', startDate: '2020', endDate: '2023', currentlyWorking: false, description: 'Built UI' },
        ],
        certifications: [
          { id: 'cert-1', name: 'AWS Certified Cloud Practitioner', issuer: 'AWS' },
        ],
        cvTemplate: 'modern',
      },
    });

    const response = await request(app)
      .get('/api/seeker/profile')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.profile).toMatchObject({
      bio: 'Experienced frontend developer',
      linkedinUrl: 'https://linkedin.com/in/janedoe',
      education: expect.any(Array),
      experience: expect.any(Array),
      certifications: expect.any(Array),
      cvTemplate: 'modern',
    });
  });

  test('PATCH /api/seeker/profile/cv updates bio', async () => {
    mockPrisma.seekerProfile.upsert.mockResolvedValue({
      id: 'profile-1',
      userId: seekerId,
      bio: 'Updated bio',
      education: null,
      experience: null,
      linkedinUrl: null,
    });

    const response = await request(app)
      .patch('/api/seeker/profile/cv')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({ bio: 'Updated bio' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.bio).toBe('Updated bio');
  });

  test('PATCH /api/seeker/profile/cv updates education', async () => {
    const education = [
      { id: '1', degree: 'B.Sc. Computer Science', school: 'University', year: '2020' },
    ];

    mockPrisma.seekerProfile.upsert.mockResolvedValue({
      id: 'profile-1',
      userId: seekerId,
      bio: null,
      education,
      experience: null,
      linkedinUrl: null,
    });

    const response = await request(app)
      .patch('/api/seeker/profile/cv')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({ education });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.education).toEqual(education);
  });

  test('PATCH /api/seeker/profile/cv updates experience', async () => {
    const experience = [
      { id: '1', jobTitle: 'Frontend Developer', company: 'Company', startDate: '2020', endDate: '2023', currentlyWorking: false, description: 'Built UI' },
    ];

    mockPrisma.seekerProfile.upsert.mockResolvedValue({
      id: 'profile-1',
      userId: seekerId,
      bio: null,
      education: null,
      experience,
      linkedinUrl: null,
    });

    const response = await request(app)
      .patch('/api/seeker/profile/cv')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({ experience });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.experience).toEqual(experience);
  });

  test('PATCH /api/seeker/profile/cv updates linkedinUrl', async () => {
    mockPrisma.seekerProfile.upsert.mockResolvedValue({
      id: 'profile-1',
      userId: seekerId,
      bio: null,
      education: null,
      experience: null,
      certifications: null,
      linkedinUrl: 'https://linkedin.com/in/janedoe',
      cvTemplate: null,
    });

    const response = await request(app)
      .patch('/api/seeker/profile/cv')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({ linkedinUrl: 'https://linkedin.com/in/janedoe' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.linkedinUrl).toBe('https://linkedin.com/in/janedoe');
  });

  test('PATCH /api/seeker/profile/cv updates certifications and cvTemplate', async () => {
    const certifications = [
      { id: 'cert-1', name: 'AWS Certified Cloud Practitioner', issuer: 'AWS' },
      { id: 'cert-2', name: 'Scrum Alliance', issuer: 'Scrum Alliance' },
    ];

    mockPrisma.seekerProfile.upsert.mockResolvedValue({
      id: 'profile-1',
      userId: seekerId,
      bio: null,
      education: null,
      experience: null,
      certifications,
      linkedinUrl: null,
      cvTemplate: 'professional',
    });

    const response = await request(app)
      .patch('/api/seeker/profile/cv')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({ certifications, cvTemplate: 'professional' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.certifications).toEqual(certifications);
    expect(response.body.data.cvTemplate).toBe('professional');
  });

  test('PATCH /api/seeker/profile/cv updates normalized languages and projects', async () => {
    const languages = [
      { id: 'language-1', name: ' English ', proficiency: 'Professional' },
      { id: 'language-2', name: 'French', proficiency: 'Conversational' },
    ];
    const projects = [{
      id: 'project-1', name: 'LeamJobs', description: 'Marketplace', technologies: [' React ', 'Node.js'],
      projectUrl: 'https://example.com', githubUrl: '', startDate: '2026-01', endDate: '2026-06',
    }];
    mockPrisma.seekerProfile.upsert.mockResolvedValue({
      id: 'profile-1', languages: [{ id: 'language-1', name: 'English', proficiency: 'Professional' }], projects: [{ ...projects[0], technologies: ['React', 'Node.js'] }],
    });

    const response = await request(app)
      .patch('/api/seeker/profile/cv')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({ languages, projects });

    expect(response.status).toBe(200);
    expect(mockPrisma.seekerProfile.upsert.mock.calls[0][0].update.languages).toEqual([
      { id: 'language-1', name: 'English', proficiency: 'Professional' },
      { id: 'language-2', name: 'French', proficiency: 'Conversational' },
    ]);
    expect(mockPrisma.seekerProfile.upsert.mock.calls[0][0].update.projects[0].technologies).toEqual(['React', 'Node.js']);
  });

  test.each([
    [{ languages: [{ name: '', proficiency: 'Fluent' }] }],
    [{ languages: [{ name: 'English', proficiency: 'Invalid' }] }],
    [{ languages: [{ name: 'English', proficiency: 'Fluent', extra: true }] }],
    [{ languages: [{ name: 'English', proficiency: 'Fluent' }, { name: 'english', proficiency: 'Native' }] }],
    [{ projects: [{ name: '', technologies: [] }] }],
    [{ projects: [{ name: 'Demo', projectUrl: 'not-a-url' }] }],
    [{ projects: [{ name: 'Demo', technologies: ['React', 'react'] }] }],
  ])('rejects malformed language/project payloads: %j', async (payload) => {
    const response = await request(app)
      .patch('/api/seeker/profile/cv')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send(payload);

    expect(response.status).toBe(400);
    expect(mockPrisma.seekerProfile.upsert).not.toHaveBeenCalled();
  });

  test('preserves language and project fields during unrelated partial CV updates', async () => {
    mockPrisma.seekerProfile.upsert.mockResolvedValue({ id: 'profile-1' });

    const response = await request(app)
      .patch('/api/seeker/profile/cv')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({ bio: 'Updated' });

    expect(response.status).toBe(200);
    const update = mockPrisma.seekerProfile.upsert.mock.calls[0][0].update;
    expect(update).not.toHaveProperty('languages');
    expect(update).not.toHaveProperty('projects');
  });

  test('PATCH /api/seeker/profile/cv rejects invalid cvTemplate', async () => {
    const response = await request(app)
      .patch('/api/seeker/profile/cv')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({ cvTemplate: 'futuristic' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
  });

  test('PATCH /api/seeker/profile/cv allows partial CV updates', async () => {
    mockPrisma.seekerProfile.upsert.mockResolvedValue({
      id: 'profile-1',
      userId: seekerId,
      bio: 'My bio',
      education: null,
      experience: null,
      linkedinUrl: null,
    });

    const response = await request(app)
      .patch('/api/seeker/profile/cv')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({ bio: 'My bio' });

    expect(response.status).toBe(200);
    expect(mockPrisma.seekerProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ bio: 'My bio' }),
    }));
  });

  test('PATCH /api/seeker/profile/cv rejects invalid LinkedIn URL', async () => {
    const response = await request(app)
      .patch('/api/seeker/profile/cv')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({ linkedinUrl: 'not-a-valid-url' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
  });

  test('PATCH /api/seeker/profile/cv rejects malformed education', async () => {
    const response = await request(app)
      .patch('/api/seeker/profile/cv')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({
        education: [
          { degree: 'B.Sc.' },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
  });

  test('PATCH /api/seeker/profile/cv rejects malformed experience', async () => {
    const response = await request(app)
      .patch('/api/seeker/profile/cv')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({
        experience: [
          { jobTitle: 'Developer' },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
  });

  test('PATCH /api/seeker/profile/cv rejects unknown fields', async () => {
    const response = await request(app)
      .patch('/api/seeker/profile/cv')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`)
      .send({
        bio: 'My bio',
        unknownField: 'should not be accepted',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
  });

  test('PATCH /api/seeker/profile/cv returns 401 without authentication', async () => {
    const response = await request(app)
      .patch('/api/seeker/profile/cv')
      .send({ bio: 'My bio' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Invalid authentication token' });
  });

  test('PATCH /api/seeker/profile/cv returns 403 for an EMPLOYER token', async () => {
    const response = await request(app)
      .patch('/api/seeker/profile/cv')
      .set('Authorization', `Bearer ${createToken('EMPLOYER')}`)
      .send({ bio: 'My bio' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'Forbidden' });
  });

  test('GET /api/seeker/profile still calculates onboardingComplete based only on onboarding fields', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: seekerId,
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '+2348000000000',
      seekerProfile: {
        id: 'profile-1',
        country: 'Nigeria',
        state: 'Lagos',
        city: 'Ikeja',
        professionalTitle: 'Frontend Developer',
        location: 'Ikeja, Lagos, Nigeria',
        skills: ['React'],
        bio: null,
        linkedinUrl: null,
        education: null,
        experience: null,
      },
    });

    const response = await request(app)
      .get('/api/seeker/profile')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`);

    expect(response.status).toBe(200);
    expect(response.body.data.onboardingComplete).toBe(true);
  });

  test('GET /api/seeker/profile returns false for onboardingComplete when CV fields are missing onboarding fields', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: seekerId,
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '+2348000000000',
      seekerProfile: {
        id: 'profile-1',
        country: 'Nigeria',
        state: 'Lagos',
        city: 'Ikeja',
        professionalTitle: null,
        location: 'Ikeja, Lagos',
        skills: [],
        bio: 'My bio',
        linkedinUrl: 'https://linkedin.com/in/janedoe',
        education: [],
        experience: [],
      },
    });

    const response = await request(app)
      .get('/api/seeker/profile')
      .set('Authorization', `Bearer ${createToken('SEEKER')}`);

    expect(response.status).toBe(200);
    expect(response.body.data.onboardingComplete).toBe(false);
  });
});
