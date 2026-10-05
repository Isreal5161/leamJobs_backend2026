import { randomUUID } from 'node:crypto';
import { prisma } from '../config/database.js';
import { createNotification } from './notification.service.js';

const activeApplicationStatuses = new Set(['APPLIED', 'REVIEWING', 'SHORTLISTED', 'INTERVIEW']);
const interviewSelect = {
  id: true,
  applicationId: true,
  jobId: true,
  employerId: true,
  seekerId: true,
  method: true,
  status: true,
  scheduledAt: true,
  timezone: true,
  durationMinutes: true,
  message: true,
  meetingUrl: true,
  phoneNumber: true,
  location: true,
  previousApplicationStatus: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  job: { select: { id: true, title: true, location: true, jobType: true } },
  employer: { select: { id: true, firstName: true, lastName: true, employerProfile: { select: { companyName: true } } } },
  seeker: { select: { id: true, firstName: true, lastName: true, seekerProfile: { select: { professionalTitle: true } } } },
  application: { select: { conversation: { select: { id: true } } } },
  history: { select: { event: true, createdAt: true, before: true, after: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
};

export class InterviewError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'InterviewError';
    this.status = status;
  }
}

export class InterviewNotFoundError extends InterviewError {
  constructor() { super('Interview not found', 404); }
}

const intlParts = (date, timezone) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, Number(value)]));
};

const validateTimezone = (timezone) => {
  if (/^[+-]\d{2}:?\d{2}$/.test(String(timezone ?? ''))) {
    throw new InterviewError('timezone must be a named IANA time zone');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    throw new InterviewError('timezone must be a valid IANA time zone');
  }
};

const jsonSnapshot = (value) => JSON.parse(JSON.stringify(value));

const naiveLocalEpoch = ({ year, month, day, hour, minute, second, milliseconds = 0 }) => {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, milliseconds);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
    throw new InterviewError('scheduledAt is not a valid date/time');
  }
  return date.getTime();
};

const parseLocalSchedule = (value, timezone) => {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  if (!match) throw new InterviewError('scheduledAt must be an ISO timestamp with an offset or a local ISO date/time');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0', fractionText = '0'] = match;
  const target = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: Number(secondText),
  };
  const milliseconds = Number(fractionText.padEnd(3, '0'));
  const naiveEpoch = naiveLocalEpoch({ ...target, milliseconds });

  const offsets = new Set();
  for (let hours = -36; hours <= 36; hours += 3) {
    const sample = new Date(naiveEpoch + hours * 60 * 60 * 1000);
    const local = intlParts(sample, timezone);
    const epochSeconds = Math.floor(sample.getTime() / 1000) * 1000;
    offsets.add(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - epochSeconds);
  }

  const matches = [...offsets]
    .map((offset) => new Date(naiveEpoch - offset))
    .filter((candidate) => {
      const actual = intlParts(candidate, timezone);
      return actual.year === target.year && actual.month === target.month && actual.day === target.day
        && actual.hour === target.hour && actual.minute === target.minute && actual.second === target.second;
    });
  if (matches.length === 0) throw new InterviewError('scheduledAt does not exist in the selected time zone because of a clock change');
  if (matches.length > 1) throw new InterviewError('scheduledAt is ambiguous in the selected time zone because of a clock change');
  return matches[0];
};

const resolveSchedule = (localDate, localTime, timezone) => {
  validateTimezone(timezone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(localDate ?? '')) || !/^\d{2}:\d{2}$/.test(String(localTime ?? ''))) {
    throw new InterviewError('localDate must be YYYY-MM-DD and localTime must be HH:mm');
  }
  const date = parseLocalSchedule(`${localDate}T${localTime}`, timezone);
  if (date.getTime() <= Date.now()) throw new InterviewError('scheduledAt must be in the future');
  return date;
};

const normalizePhone = (phoneNumber) => {
  if (phoneNumber == null || phoneNumber === '') return null;
  const value = String(phoneNumber).trim();
  const digits = value.replace(/\D/g, '');
  if (!/^\+[0-9().\-\s]+$/.test(value) || digits.length < 7 || digits.length > 15 || digits.startsWith('0')) {
    throw new InterviewError('phoneNumber must be a valid international phone number starting with +');
  }
  return `+${digits}`;
};

const normalizeMeetingUrl = (meetingUrl) => {
  if (meetingUrl == null || meetingUrl === '') return null;
  let parsed;
  try {
    parsed = new URL(String(meetingUrl).trim());
  } catch {
    throw new InterviewError('meetingUrl must be a valid HTTPS URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new InterviewError('meetingUrl must be a secure HTTPS URL without embedded credentials');
  }
  return parsed.toString();
};

const normalizeLocation = (location) => {
  if (location == null || location === '') return null;
  const value = String(location).trim();
  if (value && value.length < 2) throw new InterviewError('location must contain at least 2 characters');
  return value || null;
};

const clearInapplicableMethodFields = (interview) => ({
  ...interview,
  meetingUrl: ['VIDEO', 'OTHER'].includes(interview.method) ? interview.meetingUrl : null,
  phoneNumber: ['PHONE', 'WHATSAPP', 'OTHER'].includes(interview.method) ? interview.phoneNumber : null,
  location: ['IN_PERSON', 'OTHER'].includes(interview.method) ? interview.location : null,
});

const validateMethodFields = (interview) => {
  if (!interview.method) throw new InterviewError('method is required');
  if (interview.method === 'VIDEO' && !interview.meetingUrl) throw new InterviewError('meetingUrl is required for VIDEO interviews');
  if (interview.method === 'PHONE' && !interview.phoneNumber) throw new InterviewError('phoneNumber is required for PHONE interviews');
  if (interview.method === 'WHATSAPP' && !interview.phoneNumber) throw new InterviewError('phoneNumber is required for WHATSAPP interviews');
  if (interview.method === 'IN_PERSON' && !interview.location) throw new InterviewError('location is required for IN_PERSON interviews');
  if (interview.method === 'OTHER' && !interview.meetingUrl && !interview.phoneNumber && !interview.location) {
    throw new InterviewError('OTHER interviews require a meetingUrl, phoneNumber, or location');
  }
};

const toIso = (date) => date == null ? null : new Date(date).toISOString();

const mapInterview = (interview, role) => ({
  id: interview.id,
  applicationId: interview.applicationId,
  method: interview.method,
  status: interview.status,
  scheduledAt: toIso(interview.scheduledAt),
  timezone: interview.timezone,
  durationMinutes: interview.durationMinutes,
  message: interview.message,
  meetingUrl: interview.meetingUrl,
  location: interview.location,
  cancelledAt: toIso(interview.cancelledAt),
  createdAt: toIso(interview.createdAt),
  updatedAt: toIso(interview.updatedAt),
  job: interview.job ? {
    id: interview.job.id,
    title: interview.job.title,
    location: interview.job.location,
    jobType: interview.job.jobType,
  } : null,
  companyName: interview.employer?.employerProfile?.companyName ?? null,
  ...(role === 'SEEKER' ? {
    ...(interview.method === 'PHONE' ? { phoneNumber: interview.phoneNumber } : {}),
    ...(interview.method === 'WHATSAPP' ? { whatsappNumber: interview.phoneNumber } : {}),
    ...(interview.method === 'OTHER' && interview.phoneNumber
      ? { otherContactNumber: interview.phoneNumber }
      : {}),
    messageUrl: interview.application?.conversation?.id
      ? `/seeker/messages?conversationId=${encodeURIComponent(interview.application.conversation.id)}`
      : null,
    employer: interview.employer ? {
      id: interview.employer.id,
      firstName: interview.employer.firstName,
      lastName: interview.employer.lastName,
      companyName: interview.employer.employerProfile?.companyName ?? null,
    } : null,
  } : { applicant: interview.seeker ? {
    id: interview.seeker.id,
    firstName: interview.seeker.firstName,
    lastName: interview.seeker.lastName,
    fullName: `${interview.seeker.firstName} ${interview.seeker.lastName}`.trim(),
    professionalTitle: interview.seeker.seekerProfile?.professionalTitle ?? null,
  } : null }),
  actions: {
    canEdit: role === 'EMPLOYER' && interview.status === 'SCHEDULED',
    canCancel: role === 'EMPLOYER' && interview.status === 'SCHEDULED',
    canRespond: false,
  },
  events: interview.history?.map(({ event, createdAt, before, after }) => ({
    eventType: event,
    createdAt: toIso(createdAt),
    ...(before?.scheduledAt ? {
      oldSchedule: { scheduledAt: before.scheduledAt, timezone: before.timezone ?? null },
    } : {}),
    ...(after?.scheduledAt ? {
      newSchedule: { scheduledAt: after.scheduledAt, timezone: after.timezone ?? null },
    } : {}),
    ...(typeof after?.reason === 'string' && after.reason ? { reason: after.reason } : {}),
  })) ?? [],
});

const notifySeeker = async (interview, action, revisionKey = null, client = prisma) => {
  const labels = {
    scheduled: ['Interview scheduled', 'interview:scheduled'],
    rescheduled: ['Interview rescheduled', 'interview:rescheduled'],
    updated: ['Interview details updated', 'interview:updated'],
    cancelled: ['Interview cancelled', 'interview:cancelled'],
  };
  const [title, eventPrefix] = labels[action];
  const formattedDate = new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: interview.timezone,
  }).format(interview.scheduledAt);
  const company = interview.employer?.employerProfile?.companyName || `${interview.employer?.firstName ?? ''} ${interview.employer?.lastName ?? ''}`.trim() || 'Your employer';
  const method = interview.method.toLowerCase().replaceAll('_', ' ');
  const message = action === 'cancelled'
    ? `${company} cancelled your ${method} interview for ${interview.job.title}, previously scheduled for ${formattedDate} (${interview.timezone}).`
    : `${company} ${action === 'scheduled' ? 'scheduled' : action === 'rescheduled' ? 'rescheduled' : 'updated'} your ${method} interview for ${interview.job.title} on ${formattedDate} (${interview.timezone}, ${interview.durationMinutes} minutes).`;
  await createNotification({
    recipientUserId: interview.seekerId,
    actorUserId: interview.employerId,
    type: action === 'cancelled' ? 'WARNING' : 'INFO',
    category: 'APPLICATION',
    eventKey: `${eventPrefix}:${interview.id}${revisionKey ? `:${revisionKey}` : ''}`,
    title,
    message,
    link: `/seeker/interviews/${encodeURIComponent(interview.id)}`,
    metadata: {
      interviewId: interview.id,
      applicationId: interview.applicationId,
      jobId: interview.jobId,
      jobTitle: interview.job.title,
      companyName: company,
      scheduledAt: interview.scheduledAt.toISOString(),
      timezone: interview.timezone,
      method: interview.method,
      durationMinutes: interview.durationMinutes,
      meetingUrl: interview.meetingUrl,
      phoneNumber: interview.phoneNumber,
      location: interview.location,
      message: interview.message,
    },
  }, client);
};

const withTransaction = (callback) => prisma.$transaction(callback);

export const createInterview = async (employerId, jobId, applicationId, input) => {
  const scheduledAt = resolveSchedule(input.localDate, input.localTime, input.timezone);
  const normalized = {
    method: input.method,
    scheduledAt,
    timezone: input.timezone,
    durationMinutes: input.durationMinutes ?? 30,
    message: input.message?.trim() || null,
    meetingUrl: normalizeMeetingUrl(input.meetingUrl),
    phoneNumber: normalizePhone(input.phoneNumber),
    location: normalizeLocation(input.location),
  };
  Object.assign(normalized, clearInapplicableMethodFields(normalized));
  validateMethodFields(normalized);

  let created;
  try {
    created = await withTransaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Application" WHERE "id" = ${applicationId} FOR UPDATE`;
      const application = await transaction.application.findFirst({
        where: { id: applicationId, jobId, job: { employerId } },
        select: {
          id: true, jobId: true, seekerId: true, status: true,
          job: { select: { id: true, title: true, employerId: true } },
        },
      });
      if (!application) throw new InterviewNotFoundError();
      if (!activeApplicationStatuses.has(application.status)) throw new InterviewError('An interview cannot be scheduled for an inactive application', 409);
      const active = await transaction.interview.findFirst({
        where: { applicationId, status: 'SCHEDULED' },
        select: { id: true },
      });
      if (active) throw new InterviewError('An active interview already exists for this application', 409);

      if (normalized.method === 'LEAMJOBS') {
        let conversation = await transaction.conversation.findUnique({ where: { applicationId }, select: { id: true } });
        if (!conversation) {
          conversation = await transaction.conversation.create({
            data: { applicationId, employerId, seekerId: application.seekerId, jobId, lastMessageAt: new Date() },
            select: { id: true },
          });
        }
        const messageParts = [
          `INTERVIEW ${application.job.title}`,
          `${normalized.scheduledAt.toISOString()} (${normalized.timezone})`,
          `${normalized.durationMinutes} minutes`,
          normalized.message,
        ].filter(Boolean);
        await transaction.message.create({ data: { conversationId: conversation.id, senderId: employerId, body: messageParts.join('\n') } });
        await transaction.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
      }

      const interview = await transaction.interview.create({
        data: {
          ...normalized,
          applicationId,
          jobId,
          employerId,
          seekerId: application.seekerId,
          previousApplicationStatus: application.status,
        },
        select: { id: true },
      });
      await transaction.interviewHistory.create({
        data: { interviewId: interview.id, actorId: employerId, event: 'CREATED', after: jsonSnapshot(normalized) },
      });
      await transaction.application.update({ where: { id: applicationId }, data: { status: 'INTERVIEW' } });
      const created = await transaction.interview.findUnique({ where: { id: interview.id }, select: interviewSelect });
      await notifySeeker(created, 'scheduled', null, transaction);
      return created;
    });
  } catch (error) {
    if (error?.code === 'P2002') throw new InterviewError('An active interview already exists for this application', 409);
    throw error;
  }

  return mapInterview(created, 'EMPLOYER');
};

const listForUser = async (userId, role, { page = 1, limit = 20, status, from, to } = {}) => {
  const where = {
    [role === 'EMPLOYER' ? 'employerId' : 'seekerId']: userId,
    ...(status ? { status } : {}),
    ...((from || to) ? { scheduledAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.interview.findMany({
      where,
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
      select: interviewSelect,
    }),
    prisma.interview.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    interviews: rows.map((row) => mapInterview(row, role)),
    pagination: { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 },
  };
};

export const listEmployerInterviews = (employerId, query) => listForUser(employerId, 'EMPLOYER', query);
export const listSeekerInterviews = (seekerId, query) => listForUser(seekerId, 'SEEKER', query);

export const getInterviewForUser = async (userId, role, interviewId) => {
  const interview = await prisma.interview.findFirst({
    where: { id: interviewId, [role === 'EMPLOYER' ? 'employerId' : 'seekerId']: userId },
    select: interviewSelect,
  });
  if (!interview) throw new InterviewNotFoundError();
  return mapInterview(interview, role);
};

export const updateInterview = async (employerId, interviewId, input) => {
  const current = await prisma.interview.findFirst({
    where: { id: interviewId, employerId },
    select: { id: true, applicationId: true, method: true, status: true, scheduledAt: true, timezone: true, durationMinutes: true, message: true, meetingUrl: true, phoneNumber: true, location: true },
  });
  if (!current) throw new InterviewNotFoundError();

  const result = await withTransaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "Application" WHERE "id" = ${current.applicationId} FOR UPDATE`;
    await transaction.$queryRaw`SELECT "id" FROM "Interview" WHERE "id" = ${interviewId} FOR UPDATE`;
    const interview = await transaction.interview.findFirst({
      where: { id: interviewId, employerId, applicationId: current.applicationId },
      select: interviewSelect,
    });
    if (!interview) throw new InterviewNotFoundError();
    if (interview.status !== 'SCHEDULED') throw new InterviewError('Only scheduled interviews can be updated', 409);

    const values = { ...current, ...input };
    const scheduleChanged = Object.hasOwn(input, 'localDate');
    if (scheduleChanged) values.scheduledAt = resolveSchedule(input.localDate, input.localTime, input.timezone);
    if (Object.hasOwn(input, 'meetingUrl')) values.meetingUrl = normalizeMeetingUrl(input.meetingUrl);
    else values.meetingUrl = normalizeMeetingUrl(values.meetingUrl);
    if (Object.hasOwn(input, 'phoneNumber')) values.phoneNumber = normalizePhone(input.phoneNumber);
    else values.phoneNumber = normalizePhone(values.phoneNumber);
    if (Object.hasOwn(input, 'location')) values.location = normalizeLocation(input.location);
    else values.location = normalizeLocation(values.location);
    if (Object.hasOwn(input, 'message')) values.message = input.message?.trim() || null;
    if (values.durationMinutes == null) values.durationMinutes = 30;
    Object.assign(values, clearInapplicableMethodFields(values));
    validateMethodFields(values);

    const data = {};
    for (const key of ['method', 'scheduledAt', 'timezone', 'durationMinutes', 'message', 'meetingUrl', 'phoneNumber', 'location']) {
      if (Object.hasOwn(input, key) || (key === 'scheduledAt' && scheduleChanged)) data[key] = values[key];
    }
    for (const key of ['meetingUrl', 'phoneNumber', 'location']) {
      if (Object.hasOwn(input, key) || (Object.hasOwn(input, 'method') && values[key] !== current[key])) data[key] = values[key];
    }
    const updatedCount = await transaction.interview.updateMany({
      where: { id: interviewId, employerId, status: 'SCHEDULED' },
      data,
    });
    if (updatedCount.count !== 1) throw new InterviewError('Interview is no longer available to update', 409);
    const updated = await transaction.interview.findUnique({ where: { id: interviewId }, select: interviewSelect });
    const event = scheduleChanged ? 'RESCHEDULED' : 'UPDATED';
    const revisionKey = randomUUID();
    await transaction.interviewHistory.create({
      data: {
        id: revisionKey,
        interviewId,
        actorId: employerId,
        event,
        before: jsonSnapshot({ method: interview.method, scheduledAt: interview.scheduledAt, timezone: interview.timezone, durationMinutes: interview.durationMinutes, message: interview.message, meetingUrl: interview.meetingUrl, phoneNumber: interview.phoneNumber, location: interview.location }),
        after: jsonSnapshot(data),
      },
    });
    const action = scheduleChanged ? 'rescheduled' : 'updated';
    await notifySeeker(updated, action, revisionKey, transaction);
    return updated;
  });
  return mapInterview(result, 'EMPLOYER');
};

export const cancelInterview = async (employerId, interviewId, reason = null) => {
  const current = await prisma.interview.findFirst({
    where: { id: interviewId, employerId },
    select: { applicationId: true },
  });
  if (!current) throw new InterviewNotFoundError();

  const cancelled = await withTransaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "Application" WHERE "id" = ${current.applicationId} FOR UPDATE`;
    await transaction.$queryRaw`SELECT "id" FROM "Interview" WHERE "id" = ${interviewId} FOR UPDATE`;
    const interview = await transaction.interview.findFirst({
      where: { id: interviewId, employerId, applicationId: current.applicationId },
      select: interviewSelect,
    });
    if (!interview) throw new InterviewNotFoundError();
    if (interview.status === 'CANCELLED') return interview;
    const now = new Date();
    const updated = await transaction.interview.updateMany({
      where: { id: interviewId, employerId, status: 'SCHEDULED' },
      data: { status: 'CANCELLED', cancelledAt: now },
    });
    if (updated.count !== 1) throw new InterviewError('Interview is no longer available to cancel', 409);
    const revisionKey = randomUUID();
    await transaction.interviewHistory.create({
      data: {
        id: revisionKey,
        interviewId,
        actorId: employerId,
        event: 'CANCELLED',
        before: jsonSnapshot({ status: interview.status, scheduledAt: interview.scheduledAt, timezone: interview.timezone }),
        after: jsonSnapshot({ status: 'CANCELLED', cancelledAt: now, reason: reason?.trim() || null }),
      },
    });
    await transaction.application.updateMany({
      where: { id: interview.applicationId, status: 'INTERVIEW' },
      data: { status: interview.previousApplicationStatus },
    });
    const cancelled = await transaction.interview.findUnique({ where: { id: interviewId }, select: interviewSelect });
    await notifySeeker(cancelled, 'cancelled', revisionKey, transaction);
    return cancelled;
  });
  return mapInterview(cancelled, 'EMPLOYER');
};
