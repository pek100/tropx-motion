/**
 * Relationship Configuration
 *
 * Single source of truth for all parent→child relationships.
 * Used by cascade.ts for deletions, can also power admin dashboards, etc.
 */

import { TableNames } from "../_generated/dataModel";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface Relationship {
  table: TableNames;
  field: string;
  index: string;
}

export interface ArrayRelationship {
  table: TableNames;
  field: string;
}

// ─────────────────────────────────────────────────────────────────
// Relationship Config
// ─────────────────────────────────────────────────────────────────

/** Children to delete when parent is deleted */
export const RELATIONSHIPS: Record<string, Relationship[]> = {
  // When a session is deleted, delete these child records:
  "recordingSessions.sessionId": [
    { table: "recordingChunks", field: "sessionId", index: "by_session" },
    { table: "recordingMetrics", field: "sessionId", index: "by_session" },
    { table: "horusAnalyses", field: "sessionId", index: "by_session" },
    { table: "horusPipelineStatus", field: "sessionId", index: "by_session" },
    { table: "horusChatHistory", field: "sessionId", index: "by_session" },
    { table: "horusAnalysisEmbeddings", field: "sessionId", index: "by_session" },
  ],

  // When only Horus analysis is deleted (not full session):
  "horus.sessionId": [
    { table: "horusAnalyses", field: "sessionId", index: "by_session" },
    { table: "horusPipelineStatus", field: "sessionId", index: "by_session" },
    { table: "horusChatHistory", field: "sessionId", index: "by_session" },
    { table: "horusAnalysisEmbeddings", field: "sessionId", index: "by_session" },
  ],

  // When a user is deleted, delete these child records:
  "users._id": [
    { table: "userDevices", field: "userId", index: "by_user" },
    { table: "notifications", field: "userId", index: "by_user" },
    { table: "userTags", field: "userId", index: "by_user" },
    { table: "lwwConflicts", field: "userId", index: "by_user" },
    { table: "invites", field: "fromUserId", index: "by_from_user" },
    { table: "horusProgress", field: "patientId", index: "by_patient" },
    { table: "horusAnalyses", field: "patientId", index: "by_patient" },
    { table: "horusAnalysisEmbeddings", field: "patientId", index: "by_patient" },
    { table: "horusChatHistory", field: "patientId", index: "by_patient" },
    // Notes owned by this user
    { table: "notes", field: "userId", index: "by_user_category" },
    // Notes about this user (as patient/subject via contextId)
    { table: "notes", field: "contextId", index: "by_context" },
    // Storage tracking records for this user's uploads
    { table: "storageTracking", field: "uploadedBy", index: "by_user" },
  ],
};

/** Array fields where parent ID should be removed (not full record deletion) */
export const ARRAY_RELATIONSHIPS: Record<string, ArrayRelationship[]> = {
  "recordingSessions.sessionId": [
    { table: "horusProgress", field: "sessionIds" },
  ],
  "horus.sessionId": [
    { table: "horusProgress", field: "sessionIds" },
  ],
  "users._id": [
    { table: "recordingSessions", field: "sharedWith" },
  ],
};
