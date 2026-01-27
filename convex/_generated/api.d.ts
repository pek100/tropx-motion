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
import type * as horus_chat from "../horus/chat.js";
import type * as horus_correlation from "../horus/correlation.js";
import type * as horus_crossAnalysis_index from "../horus/crossAnalysis/index.js";
import type * as horus_crossAnalysis_mutations from "../horus/crossAnalysis/mutations.js";
import type * as horus_crossAnalysis_queries from "../horus/crossAnalysis/queries.js";
import type * as horus_crossAnalysis_types from "../horus/crossAnalysis/types.js";
import type * as horus_index from "../horus/index.js";
import type * as horus_llm_schemas from "../horus/llm/schemas.js";
import type * as horus_llm_usage from "../horus/llm/usage.js";
import type * as horus_llm_vertex from "../horus/llm/vertex.js";
import type * as horus_metricTags from "../horus/metricTags.js";
import type * as horus_metrics from "../horus/metrics.js";
import type * as horus_mutations from "../horus/mutations.js";
import type * as horus_orchestrator from "../horus/orchestrator.js";
import type * as horus_queries from "../horus/queries.js";
import type * as horus_triggers from "../horus/triggers.js";
import type * as horus_types from "../horus/types.js";
import type * as horus_userQuery from "../horus/userQuery.js";
import type * as horus_v2_actions from "../horus/v2/actions.js";
import type * as horus_v2_agents_analysis from "../horus/v2/agents/analysis.js";
import type * as horus_v2_agents_crossAnalysis from "../horus/v2/agents/crossAnalysis.js";
import type * as horus_v2_agents_research from "../horus/v2/agents/research.js";
import type * as horus_v2_index from "../horus/v2/index.js";
import type * as horus_v2_mutations from "../horus/v2/mutations.js";
import type * as horus_v2_orchestrator from "../horus/v2/orchestrator.js";
import type * as horus_v2_prompts_analysis from "../horus/v2/prompts/analysis.js";
import type * as horus_v2_prompts_crossAnalysis from "../horus/v2/prompts/crossAnalysis.js";
import type * as horus_v2_prompts_research from "../horus/v2/prompts/research.js";
import type * as horus_v2_queries from "../horus/v2/queries.js";
import type * as horus_v2_search_web from "../horus/v2/search/web.js";
import type * as horus_v2_types from "../horus/v2/types.js";
import type * as horus_v2_utils from "../horus/v2/utils.js";
import type * as horus_v2_validation from "../horus/v2/validation.js";
import type * as horus_validation_blockValidator from "../horus/validation/blockValidator.js";
import type * as horus_vectordb_analysisSearch from "../horus/vectordb/analysisSearch.js";
import type * as horus_vectordb_embeddings from "../horus/vectordb/embeddings.js";
import type * as horus_vectordb_index from "../horus/vectordb/index.js";
import type * as horus_vectordb_metricsVector from "../horus/vectordb/metricsVector.js";
import type * as horus_vectordb_search from "../horus/vectordb/search.js";
import type * as horus_visualization_catalog from "../horus/visualization/catalog.js";
import type * as horus_visualization_evaluator from "../horus/visualization/evaluator.js";
import type * as horus_visualization_index from "../horus/visualization/index.js";
import type * as horus_visualization_types from "../horus/visualization/types.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_cascade from "../lib/cascade.js";
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
import type * as lib_relationships from "../lib/relationships.js";
import type * as lwwConflicts from "../lwwConflicts.js";
import type * as migrations from "../migrations.js";
import type * as notes from "../notes.js";
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
  "horus/chat": typeof horus_chat;
  "horus/correlation": typeof horus_correlation;
  "horus/crossAnalysis/index": typeof horus_crossAnalysis_index;
  "horus/crossAnalysis/mutations": typeof horus_crossAnalysis_mutations;
  "horus/crossAnalysis/queries": typeof horus_crossAnalysis_queries;
  "horus/crossAnalysis/types": typeof horus_crossAnalysis_types;
  "horus/index": typeof horus_index;
  "horus/llm/schemas": typeof horus_llm_schemas;
  "horus/llm/usage": typeof horus_llm_usage;
  "horus/llm/vertex": typeof horus_llm_vertex;
  "horus/metricTags": typeof horus_metricTags;
  "horus/metrics": typeof horus_metrics;
  "horus/mutations": typeof horus_mutations;
  "horus/orchestrator": typeof horus_orchestrator;
  "horus/queries": typeof horus_queries;
  "horus/triggers": typeof horus_triggers;
  "horus/types": typeof horus_types;
  "horus/userQuery": typeof horus_userQuery;
  "horus/v2/actions": typeof horus_v2_actions;
  "horus/v2/agents/analysis": typeof horus_v2_agents_analysis;
  "horus/v2/agents/crossAnalysis": typeof horus_v2_agents_crossAnalysis;
  "horus/v2/agents/research": typeof horus_v2_agents_research;
  "horus/v2/index": typeof horus_v2_index;
  "horus/v2/mutations": typeof horus_v2_mutations;
  "horus/v2/orchestrator": typeof horus_v2_orchestrator;
  "horus/v2/prompts/analysis": typeof horus_v2_prompts_analysis;
  "horus/v2/prompts/crossAnalysis": typeof horus_v2_prompts_crossAnalysis;
  "horus/v2/prompts/research": typeof horus_v2_prompts_research;
  "horus/v2/queries": typeof horus_v2_queries;
  "horus/v2/search/web": typeof horus_v2_search_web;
  "horus/v2/types": typeof horus_v2_types;
  "horus/v2/utils": typeof horus_v2_utils;
  "horus/v2/validation": typeof horus_v2_validation;
  "horus/validation/blockValidator": typeof horus_validation_blockValidator;
  "horus/vectordb/analysisSearch": typeof horus_vectordb_analysisSearch;
  "horus/vectordb/embeddings": typeof horus_vectordb_embeddings;
  "horus/vectordb/index": typeof horus_vectordb_index;
  "horus/vectordb/metricsVector": typeof horus_vectordb_metricsVector;
  "horus/vectordb/search": typeof horus_vectordb_search;
  "horus/visualization/catalog": typeof horus_visualization_catalog;
  "horus/visualization/evaluator": typeof horus_visualization_evaluator;
  "horus/visualization/index": typeof horus_visualization_index;
  "horus/visualization/types": typeof horus_visualization_types;
  http: typeof http;
  invites: typeof invites;
  "lib/auth": typeof lib_auth;
  "lib/cascade": typeof lib_cascade;
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
  "lib/relationships": typeof lib_relationships;
  lwwConflicts: typeof lwwConflicts;
  migrations: typeof migrations;
  notes: typeof notes;
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
