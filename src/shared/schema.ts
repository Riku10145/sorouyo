import { z } from 'zod';
import { VOTE_VALUES } from './model';

export const voteSchema = z.enum(VOTE_VALUES);
