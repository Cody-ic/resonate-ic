// Shared request deadlines. Expiring a wait never authorizes repeating a write
// or a paid/provider request whose outcome is unknown.
export const timeouts={
  page:120000,
  account:180000,
  upload:300000,
  repository:120000,
  discussionAI:180000,
  projectAI:480000,
  mailRequest:60000,
  mailLease:600000,
} as const;
export const reviewStepTimeout='15 minutes' as const;
