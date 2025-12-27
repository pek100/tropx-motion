/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as cache from "../cache.js";
import type * as cleanup from "../cleanup.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as devices from "../devices.js";
import type * as electronAuth from "../electronAuth.js";
import type * as fetchById from "../fetchById.js";
import type * as horus_actions from "../horus/actions.js";
import type * as horus_agents_analysis from "../horus/agents/analysis.js";
import type * as horus_agents_decomposition from "../horus/agents/decomposition.js";
import type * as horus_agents_progress from "../horus/agents/progress.js";
import type * as horus_agents_research from "../horus/agents/research.js";
import type * as horus_agents_validator from "../horus/agents/validator.js";
import type * as horus_index from "../horus/index.js";
import type * as horus_llm_parser from "../horus/llm/parser.js";
import type * as horus_llm_schemas from "../horus/llm/schemas.js";
import type * as horus_llm_usage from "../horus/llm/usage.js";
import type * as horus_llm_vertex from "../horus/llm/vertex.js";
import type * as horus_metrics from "../horus/metrics.js";
import type * as horus_mutations from "../horus/mutations.js";
import type * as horus_orchestrator from "../horus/orchestrator.js";
import type * as horus_prompts_analysis from "../horus/prompts/analysis.js";
import type * as horus_prompts_decomposition from "../horus/prompts/decomposition.js";
import type * as horus_prompts_index from "../horus/prompts/index.js";
import type * as horus_prompts_progress from "../horus/prompts/progress.js";
import type * as horus_prompts_research from "../horus/prompts/research.js";
import type * as horus_prompts_validator from "../horus/prompts/validator.js";
import type * as horus_queries from "../horus/queries.js";
import type * as horus_triggers from "../horus/triggers.js";
import type * as horus_types from "../horus/types.js";
import type * as horus_vectordb_embeddings from "../horus/vectordb/embeddings.js";
import type * as horus_vectordb_search from "../horus/vectordb/search.js";
import type * as horus_visualization_catalog from "../horus/visualization/catalog.js";
import type * as horus_visualization_evaluator from "../horus/visualization/evaluator.js";
import type * as horus_visualization_index from "../horus/visualization/index.js";
import type * as horus_visualization_types from "../horus/visualization/types.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_metrics_bilateral from "../lib/metrics/bilateral.js";
import type * as lib_metrics_classification from "../lib/metrics/classification.js";
import type * as lib_metrics_compute from "../lib/metrics/compute.js";
import type * as lib_metrics_computedParams from "../lib/metrics/computedParams.js";
import type * as lib_metrics_groundContact from "../lib/metrics/groundContact.js";
import type * as lib_metrics_helpers from "../lib/metrics/helpers.js";
import type * as lib_metrics_index from "../lib/metrics/index.js";
import type * as lib_metrics_opi from "../lib/metrics/opi.js";
import type * as lib_metrics_quaternionUtils from "../lib/metrics/quaternionUtils.js";
import type * as lib_metrics_smoothness from "../lib/metrics/smoothness.js";
import type * as lib_metrics_types from "../lib/metrics/types.js";
import type * as lwwConflicts from "../lwwConflicts.js";
import type * as migrations from "../migrations.js";
import type * as notifications from "../notifications.js";
import type * as recordingChunks from "../recordingChunks.js";
import type * as recordingMetrics from "../recordingMetrics.js";
import type * as recordingSessions from "../recordingSessions.js";
import type * as sync from "../sync.js";
import type * as tags from "../tags.js";
import type * as timestamps from "../timestamps.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  cache: typeof cache;
  cleanup: typeof cleanup;
  crons: typeof crons;
  dashboard: typeof dashboard;
  devices: typeof devices;
  electronAuth: typeof electronAuth;
  fetchById: typeof fetchById;
  "horus/actions": typeof horus_actions;
  "horus/agents/analysis": typeof horus_agents_analysis;
  "horus/agents/decomposition": typeof horus_agents_decomposition;
  "horus/agents/progress": typeof horus_agents_progress;
  "horus/agents/research": typeof horus_agents_research;
  "horus/agents/validator": typeof horus_agents_validator;
  "horus/index": typeof horus_index;
  "horus/llm/parser": typeof horus_llm_parser;
  "horus/llm/schemas": typeof horus_llm_schemas;
  "horus/llm/usage": typeof horus_llm_usage;
  "horus/llm/vertex": typeof horus_llm_vertex;
  "horus/metrics": typeof horus_metrics;
  "horus/mutations": typeof horus_mutations;
  "horus/orchestrator": typeof horus_orchestrator;
  "horus/prompts/analysis": typeof horus_prompts_analysis;
  "horus/prompts/decomposition": typeof horus_prompts_decomposition;
  "horus/prompts/index": typeof horus_prompts_index;
  "horus/prompts/progress": typeof horus_prompts_progress;
  "horus/prompts/research": typeof horus_prompts_research;
  "horus/prompts/validator": typeof horus_prompts_validator;
  "horus/queries": typeof horus_queries;
  "horus/triggers": typeof horus_triggers;
  "horus/types": typeof horus_types;
  "horus/vectordb/embeddings": typeof horus_vectordb_embeddings;
  "horus/vectordb/search": typeof horus_vectordb_search;
  "horus/visualization/catalog": typeof horus_visualization_catalog;
  "horus/visualization/evaluator": typeof horus_visualization_evaluator;
  "horus/visualization/index": typeof horus_visualization_index;
  "horus/visualization/types": typeof horus_visualization_types;
  http: typeof http;
  invites: typeof invites;
  "lib/auth": typeof lib_auth;
  "lib/functions": typeof lib_functions;
  "lib/metrics/bilateral": typeof lib_metrics_bilateral;
  "lib/metrics/classification": typeof lib_metrics_classification;
  "lib/metrics/compute": typeof lib_metrics_compute;
  "lib/metrics/computedParams": typeof lib_metrics_computedParams;
  "lib/metrics/groundContact": typeof lib_metrics_groundContact;
  "lib/metrics/helpers": typeof lib_metrics_helpers;
  "lib/metrics/index": typeof lib_metrics_index;
  "lib/metrics/opi": typeof lib_metrics_opi;
  "lib/metrics/quaternionUtils": typeof lib_metrics_quaternionUtils;
  "lib/metrics/smoothness": typeof lib_metrics_smoothness;
  "lib/metrics/types": typeof lib_metrics_types;
  lwwConflicts: typeof lwwConflicts;
  migrations: typeof migrations;
  notifications: typeof notifications;
  recordingChunks: typeof recordingChunks;
  recordingMetrics: typeof recordingMetrics;
  recordingSessions: typeof recordingSessions;
  sync: typeof sync;
  tags: typeof tags;
  timestamps: typeof timestamps;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
