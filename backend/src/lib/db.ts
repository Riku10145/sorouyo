import type { Vote } from '../../../shared/schema';

export interface GroupRow { id: string; name: string; color: string | null; created_by?: string | null }

export interface MemberRow { group_id: string; user_id: string; role: 'admin' | 'member' }

export interface PollRow {
  id: string; group_id: string; creator_id: string; title: string;
  deadline_at: string | null; status: 'open' | 'confirmed';
  confirmed_candidate_id: string | null; created_at: string;
  edit_version: number; reopen_pending: number;
}

export interface CandidateRow { id: string; poll_id: string; position: number; date: string; start_time: string | null }

export interface AnswerRow {
  id: string; poll_id: string; respondent_key: string; user_id: string | null;
  guest_id: string | null; display_name: string; comment: string | null;
  created_at: string; updated_at: string;
}

export interface VoteRow { answer_id: string; candidate_id: string; value: Vote }

export interface EventRow {
  id: string; group_id: string; date: string; start_time: string | null;
  title: string; memo: string | null; source_poll_id: string | null; created_at: string;
}

export interface InviteRow {
  id: string; purpose: 'answer' | 'join'; poll_id: string | null; group_id: string | null;
  token_hash: string; expires_at: string | null; revoked_at: string | null; created_by: string | null;
  created_at: string;
}

export const all = <T>(stmt: Promise<{ results: T[] }>) => stmt.then(r => r.results);
