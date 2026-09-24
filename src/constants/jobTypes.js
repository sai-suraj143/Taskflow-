export const JOB_TYPES = [
  'SEND_EMAIL',
  'PROCESS_DATA',
  'GENERATE_REPORT',
  'SEND_WEBHOOK',
];

export const isValidJobType = (type) => JOB_TYPES.includes(type);