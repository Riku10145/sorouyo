import { z } from 'zod';

export const voteValues = ['yes', 'maybe', 'no'] as const;
export const voteSchema = z.enum(voteValues);
export type Vote = z.infer<typeof voteSchema>;

export const GROUP_CREATION_LIMIT = 5;

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const createGroupBody = z.object({ name: z.string().trim().min(1).max(40), color: colorSchema.nullish() });
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const createPollBody = z.object({
  title: z.string().trim().min(1).max(60),
  deadlineAt: z.iso.datetime().nullish(),
  candidates: z.array(z.object({ date: z.iso.date(), time: timeSchema.nullish() })).min(1).max(31),
});
export const inviteBody = z.object({ token: z.string().min(1) });
export const answerBody = z.object({
  token: z.string().min(1),
  name: z.string().trim().min(1).max(30),
  comment: z.string().trim().max(100).nullish(),
  votes: z.array(z.object({ candidateId: z.string().min(1), value: voteSchema })).max(50),
});
export const confirmBody = z.object({ candidateId: z.string().min(1) });
export const notificationSettingsBody = z.object({ enabled: z.boolean(), time: timeSchema });
export const unconfirmBody = z.object({ eventId: z.string().min(1) });
export const eventBody = z.object({
  date: z.iso.date(), time: timeSchema.nullish(), title: z.string().trim().min(1).max(60), memo: z.string().trim().max(500).nullish(),
});
const candidateInput = z.object({ id: z.string().min(1).optional(), date: z.iso.date(), time: timeSchema.nullish() });
export const updatePollBody = z.object({
  editVersion: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(60),
  deadlineAt: z.iso.datetime().nullish(),
  candidates: z.array(candidateInput).min(1).max(31),
});
