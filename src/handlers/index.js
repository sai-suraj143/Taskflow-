import { handle as sendEmailHandler } from './sendEmail.handler.js';
import { handle as processDataHandler } from './processData.handler.js';
import { handle as generateReportHandler } from './generateReport.handler.js';
import { handle as sendWebhookHandler } from './sendWebhook.handler.js';

export const handlers = {
  SEND_EMAIL: sendEmailHandler,
  PROCESS_DATA: processDataHandler,
  GENERATE_REPORT: generateReportHandler,
  SEND_WEBHOOK: sendWebhookHandler,
};

export const getHandler = (type) => {
  if (!Object.hasOwn(handlers, type)) {
    throw new Error(
      `No handler registered for job type "${type}". Registered types: ${Object.keys(handlers).join(', ')}`
    );
  }

  return handlers[type];
};

export default handlers;
