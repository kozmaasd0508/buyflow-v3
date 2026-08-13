export const BUYFLOW_AUDIT_WINDOWS = [7, 30, 90] as const;
export type BuyFlowAuditWindow = (typeof BUYFLOW_AUDIT_WINDOWS)[number];
export const DEFAULT_BUYFLOW_AUDIT_WINDOW: BuyFlowAuditWindow = 30;
