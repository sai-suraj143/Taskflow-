// Application priority -> BullMQ queue priority.
//
// JobPriority (HIGH/NORMAL/LOW) is the domain vocabulary stored in Postgres; BullMQ's
// own `priority` job option is a plain integer where a LOWER number is dequeued
// FIRST. The mapping is therefore inverted relative to intuition: HIGH (1) sorts
// ahead of NORMAL (2), which sorts ahead of LOW (3).
//
// This mapping is applied at enqueue time only. Postgres keeps the readable enum and
// the queue keeps the integer, so the translation lives in exactly one place and the
// worker never needs to know about the domain vocabulary.
export const PRIORITY_MAP = {
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

// Used whenever a job carries no priority or an unrecognised one, so an unknown value
// can never produce a job that silently sorts ahead of HIGH.
export const DEFAULT_BULLMQ_PRIORITY = PRIORITY_MAP.NORMAL;

export default PRIORITY_MAP;
