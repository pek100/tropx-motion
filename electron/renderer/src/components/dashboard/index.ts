// Dashboard Components
export { DashboardView } from "./DashboardView";
export { PatientInfoCard } from "./PatientInfoCard";
export { PatientNotes, type PatientNote } from "./PatientNotes";
export { SessionCard, type SessionData } from "./SessionCard";
export { SessionsCarousel } from "./SessionsCarousel";
export { ProgressChart } from "./ProgressChart";
export { SessionChart } from "./SessionChart";
export { ChartPane } from "./ChartPane";
export { MetricsDataTable } from "./MetricsDataTable";
export { columns, type MetricRow, type MetricDomain } from "./columns";

// Keep old MetricsTable for backward compatibility (used by old code paths)
export { MetricsTable, METRIC_DEFINITIONS } from "./MetricsTable";
export type { MetricDefinition, MetricValue, MovementType } from "./MetricsTable";
