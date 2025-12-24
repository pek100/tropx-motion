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
import type * as electronAuth from "../electronAuth.js";
import type * as fetchById from "../fetchById.js";
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
  electronAuth: typeof electronAuth;
  fetchById: typeof fetchById;
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
