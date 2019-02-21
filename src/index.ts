/*!
 * Copyright 2017 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Writable} from 'stream';
import * as express from './middleware/express';

// Export the express middleware as 'express'.
export {express};

const {Logging} = require('@google-cloud/logging');

import * as types from './types/core';

// Map of Stackdriver logging levels.
const BUNYAN_TO_STACKDRIVER: Map<number, string> = new Map([
  [60, 'CRITICAL'],
  [50, 'ERROR'],
  [40, 'WARNING'],
  [30, 'INFO'],
  [20, 'DEBUG'],
  [10, 'DEBUG'],
]);

/**
 * Key to use in the Bunyan payload to allow users to indicate a trace for the
 * request, and to store as an intermediate value on the log entry before it
 * gets written to the Stackdriver logging API.
 */
export const LOGGING_TRACE_KEY = 'logging.googleapis.com/trace';

/**
 * Gets the current fully qualified trace ID when available from the
 * @google-cloud/trace-agent library in the LogEntry.trace field format of:
 * "projects/[PROJECT-ID]/traces/[TRACE-ID]".
 */
function getCurrentTraceFromAgent() {
  const agent = global._google_trace_agent;
  if (!agent || !agent.getCurrentContextId || !agent.getWriterProjectId) {
    return null;
  }

  const traceId = agent.getCurrentContextId();
  if (!traceId) {
    return null;
  }

  const traceProjectId = agent.getWriterProjectId();
  if (!traceProjectId) {
    return null;
  }

  return `projects/${traceProjectId}/traces/${traceId}`;
}

/**
 * This module provides support for streaming your Bunyan logs to
 * [Stackdriver Logging](https://cloud.google.com/logging).
 *
 * @class
 *
 * @param {object} [options]
 * @param {string} [options.logName] The name of the log that will receive
 *     messages written to this bunyan stream. Default: `bunyan_Log`.
 * @param {object} [options.resource] The monitored resource that the log
 *     stream corresponds to. On Google Cloud Platform, this is detected
 *     automatically, but you may optionally specify a specific monitored
 *     resource. For more information, see the
 *     [official documentation]{@link
 * https://cloud.google.com/logging/docs/api/reference/rest/v2/MonitoredResource}
 * @param {object} [options.serviceContext] For logged errors, we provide this
 *     as the service context. For more information see
 *     [this guide]{@link
 * https://cloud.google.com/error-reporting/docs/formatting-error-messages} and
 * the [official documentation]{@link
 * https://cloud.google.com/error-reporting/reference/rest/v1beta1/ServiceContext}.
 * @param {string} [options.serviceContext.service] An identifier of the
 *     service, such as the name of the executable, job, or Google App Engine
 *     service name.
 * @param {string} [options.serviceContext.version] Represents the version of
 *     the service.
 * @param {string} [options.projectId] The project ID from the Google Cloud
 *     Console, e.g. 'grape-spaceship-123'. We will also check the environment
 *     variable `GCLOUD_PROJECT` for your project ID. If your app is running in
 *     an environment which supports {@link
 * https://cloud.google.com/docs/authentication/production#providing_credentials_to_your_application
 * Application Default Credentials}, your project ID will be detected
 * automatically.
 * @param {string} [options.keyFilename] Full path to the a .json, .pem, or .p12
 *     key downloaded from the Google Cloud Console. If you provide a path
 *     to a JSON file, the `projectId` option above is not necessary. NOTE: .pem
 *     and .p12 require you to specify the `email` option as well.
 * @param {string} [options.email] Account email address. Required when using a
 *     .pem or .p12 keyFilename.
 * @param {object} [options.credentials] Credentials object.
 * @param {string} [options.credentials.client_email]
 * @param {string} [options.credentials.private_key]
 * @param {boolean} [options.autoRetry=true] Automatically retry requests if the
 *     response is related to rate limits or certain intermittent server errors.
 *     We will exponentially backoff subsequent requests by default.
 * @param {number} [options.maxRetries=3] Maximum number of automatic retries
 *     attempted before returning the error.
 * @param {constructor} [options.promise] Custom promise module to use instead
 *     of native Promises.
 *
 * @example <caption>Import the client library</caption>
 * const {LoggingBunyan} = require('@google-cloud/logging-bunyan');
 *
 * @example <caption>Create a client that uses <a
 * href="https://cloud.google.com/docs/authentication/production#providing_credentials_to_your_application">Application
 * Default Credentials (ADC)</a>:</caption> const loggingBunyan = new
 * LoggingBunyan();
 *
 * @example <caption>Create a client with <a
 * href="https://cloud.google.com/docs/authentication/production#obtaining_and_providing_service_account_credentials_manually">explicit
 * credentials</a>:</caption> const loggingBunyan = new LoggingBunyan({
 *   projectId: 'your-project-id',
 *   keyFilename: '/path/to/keyfile.json'
 * });
 *
 * @example <caption>include:samples/quickstart.js</caption>
 * region_tag:logging_bunyan_quickstart
 * Full quickstart example:
 *
 */
export class LoggingBunyan extends Writable {
  private logName: string;
  private resource: types.MonitoredResource|undefined;
  private serviceContext?: types.ServiceContext;
  stackdriverLog:
      types.StackdriverLog;  // TODO: add type for @google-cloud/logging
  constructor(options?: types.Options) {
    options = options || {};
    super({objectMode: true});
    this.logName = options.logName || 'bunyan_log';
    this.resource = options.resource;
    this.serviceContext = options.serviceContext;
    this.stackdriverLog = (new Logging(options)).log(this.logName, {
      removeCircular: true,
    });

    // serviceContext.service is required by the Error Reporting
    // API.  Without it, errors that are logged with level 'error'
    // or higher will not be displayed in the Error Reporting
    // console.
    //
    // As a result, if serviceContext is specified, it is required
    // that serviceContext.service is specified.
    if (this.serviceContext && !this.serviceContext.service) {
      throw new Error(
          `If 'serviceContext' is specified then ` +
          `'serviceContext.service' is required.`);
    }
  }

  /**
   * Convenience method that Builds a bunyan stream object that you can put in
   * the bunyan streams list.
   */
  stream(level: types.LogLevel): types.StreamResponse {
    return {level, type: 'raw', stream: this as Writable};
  }

  /**
   * Format a bunyan record into a Stackdriver log entry.
   */
  private formatEntry_(record: string|types.BunyanLogRecord) {
    if (typeof record === 'string') {
      throw new Error(
          '@google-cloud/logging-bunyan only works as a raw bunyan stream type.');
    }
    // Stackdriver Log Viewer picks up the summary line from the 'message' field
    // of the payload. Unless the user has provided a 'message' property also,
    // move the 'msg' to 'message'.
    if (!record.message) {
      // If this is an error, report the full stack trace. This allows
      // Stackdriver Error Reporting to pick up errors automatically (for
      // severity 'error' or higher). In this case we leave the 'msg' property
      // intact.
      // https://cloud.google.com/error-reporting/docs/formatting-error-messages
      //
      if (record.err && record.err.stack) {
        record.message = record.err.stack;
        record.serviceContext = this.serviceContext;
      } else if (record.msg) {
        // Simply rename `msg` to `message`.
        record.message = record.msg;
        delete record.msg;
      }
    }

    const entryMetadata: types.StackdriverEntryMetadata = {
      resource: this.resource,
      timestamp: record.time,
      severity: BUNYAN_TO_STACKDRIVER.get(Number(record.level))
    };

    // If the record contains a httpRequest property, provide it on the entry
    // metadata. This allows Stackdriver to use request log formatting.
    // https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry#HttpRequest
    // Note that the httpRequest field must properly validate as a HttpRequest
    // proto message, or the log entry would be rejected by the API. We do no
    // validation here.
    if (record.httpRequest) {
      entryMetadata.httpRequest = record.httpRequest;
      delete record.httpRequest;
    }

    // If the record contains a labels property, promote it to the entry
    // metadata.
    // https://cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry
    const proper = LoggingBunyan.properLabels(record.labels);
    if (record.labels && proper) {
      entryMetadata.labels = record.labels;
      delete record.labels;
    }

    if (record[LOGGING_TRACE_KEY]) {
      entryMetadata.trace = record[LOGGING_TRACE_KEY];
      delete record[LOGGING_TRACE_KEY];
    }

    return this.stackdriverLog.entry(entryMetadata, record);
  }

  // tslint:disable-next-line:no-any
  static properLabels(labels: any) {
    if (typeof labels !== 'object') return false;
    for (const prop in labels) {
      if (typeof labels[prop] !== 'string') {
        return false;
      }
    }
    return true;
  }

  /**
   * Intercept log entries as they are written so we can attempt to add the
   * trace ID in the same continuation as the function that wrote the log,
   * because the trace agent currently uses continuation local storage for the
   * trace context.
   *
   * By the time the Writable stream buffer gets flushed and _write gets called
   * we may well be in a different continuation.
   */
  write(record: types.BunyanLogRecord, callback?: Function): boolean;
  write(record: types.BunyanLogRecord, encoding?: string, callback?: Function):
      boolean;
  // Writable.write used 'any' in function signature.
  // tslint:disable-next-line:no-any
  write(...args: any[]): boolean {
    let record = args[0];
    let encoding: string|null = null;
    type Callback = (error: Error|null|undefined) => void;
    let callback: Callback|string;
    if (typeof args[1] === 'string') {
      encoding = args[1];
      callback = args[2];
    } else {
      callback = args[1];
    }
    record = Object.assign({}, record);
    if (!record[LOGGING_TRACE_KEY]) {
      const trace = getCurrentTraceFromAgent();
      if (trace) {
        record[LOGGING_TRACE_KEY] = trace;
      }
    }
    if (encoding !== null) {
      return super.write.call(this, record, encoding, callback as Callback);
    } else {
      return super.write.call(this, record, callback as string);
    }
  }

  /**
   * Relay a log entry to the logging agent. This is called by bunyan through
   * Writable#write.
   */
  _write(
      record: types.BunyanLogRecord, encoding?: string, callback?: Function) {
    const entry = this.formatEntry_(record);
    this.stackdriverLog.write(entry, callback);
  }

  /**
   * Relay an array of log entries to the logging agent. This is called by
   * bunyan through Writable#write.
   */
  // Writable._write used 'any' in function signature.
  _writev(
      chunks: Array<{
        // tslint:disable-next-line:no-any
        chunk: any; encoding: string;
      }>,
      callback?: Function) {
    const entries = chunks.map((request: {
                                 // tslint:disable-next-line:no-any
                                 chunk: any; encoding: string;
                               }) => {
      return this.formatEntry_(request.chunk);
    });

    this.stackdriverLog.write(entries, callback);
  }
}

module.exports.BUNYAN_TO_STACKDRIVER = BUNYAN_TO_STACKDRIVER;

/**
 * Value: `logging.googleapis.com/trace`
 *
 * @name LoggingBunyan.LOGGING_TRACE_KEY
 * @type {string}
 */
module.exports.LOGGING_TRACE_KEY = LOGGING_TRACE_KEY;