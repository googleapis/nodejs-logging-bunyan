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

'use strict';

import * as extend from 'extend';
import * as util from 'util';
import {Writable} from 'stream';
const logging = require('@google-cloud/logging');
// var Writable = require('stream').Writable;

// Map of Stackdriver logging levels.
const BUNYAN_TO_STACKDRIVER: {[key: number]: string} = {
  60: 'CRITICAL',
  50: 'ERROR',
  40: 'WARNING',
  30: 'INFO',
  20: 'DEBUG',
  10: 'DEBUG',
};

/*!
 * Key to use in the Bunyan payload to allow users to indicate a trace for the
 * request, and to store as an intermediate value on the log entry before it
 * gets written to the Stackdriver logging API.
 */
export const LOGGING_TRACE_KEY = 'logging.googleapis.com/trace';

/*!
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

export class LoggingBunyan extends Writable {
  private logName: string;
  private resource: MonitoredResource|undefined;
  private serviceContext: ServiceContext|undefined;
  private stackdriverLog:
      StackdriverLog;  // TODO: add type for @google-cloud/logging
  constructor(options: Options) {
    if (new.target !== LoggingBunyan) {
      return new LoggingBunyan(options);
    }
    options = options || {};
    super({objectMode: true});
    this.logName = options.logName || 'bunyan_log';
    this.resource = options.resource;
    this.serviceContext = options.serviceContext;
    this.stackdriverLog = logging(options).log(this.logName, {
      removeCircular: true,
    });
  }

  /**
   * @param {string|number} level A bunyan logging level. Log entries at or
   * above this level will be routed to Stackdriver Logging.
   *
   * @example
   * const logger = bunyan.createLogger({
   *   name: 'my-service',
   *   streams: [
   *     loggingBunyan.stream('info')
   *   ]
   */
  stream(level: string|
         number): {level: string|number, type: string, stream: {}} {
    return {
      level,
      type: 'raw',
      stream: this,
    };
  }

  /**
   * Format a bunyan record into a Stackdriver log entry.
   *
   * @param {object} record - Bunyan log record.
   *
   * @private
   */
  formatEntry_(record: string|BunyanLogRecord) {
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

    const entryMetadata: StackdriverEntryMetadata = {
      resource: this.resource,
      timestamp: record.time,
      // BUNYAN_TO_STACKDRIVER does not have index signature.
      // tslint:disable-next-line:no-any
      severity: (BUNYAN_TO_STACKDRIVER as any)[record.level as string],
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

    // record does not have index signature.
    // tslint:disable-next-line:no-any
    if ((record as any)[LOGGING_TRACE_KEY]) {
      // tslint:disable-next-line:no-any
      entryMetadata.trace = (record as any)[LOGGING_TRACE_KEY];
      // tslint:disable-next-line:no-any
      delete (record as any)[LOGGING_TRACE_KEY];
    }

    return this.stackdriverLog.entry(entryMetadata, record);
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
  // Writable.write used 'any' in function signature.
  // tslint:disable-next-line:no-any
  write(record: any, callback?: Function): boolean;
  // tslint:disable-next-line:no-any
  write(record: any, encoding?: string, callback?: Function): boolean;
  // tslint:disable-next-line:no-any
  write(...args: any[]): boolean {
    let record = args[0];
    let encoding: string|null = null;
    let callback: Function;
    if (typeof args[1] === 'string') {
      encoding = args[1];
      callback = args[2];
    } else {
      callback = args[1];
    }
    record = extend({}, record);
    // record does not have index signature.
    // tslint:disable-next-line:no-any
    if (!(record as any)[LOGGING_TRACE_KEY]) {
      const trace = getCurrentTraceFromAgent();
      if (trace) {
        // tslint:disable-next-line:no-any
        (record as any)[LOGGING_TRACE_KEY] = trace;
      }
    }
    if (encoding !== null) {
      return super.write.call(this, record, encoding, callback);
    } else {
      return super.write.call(this, record, callback);
    }
  }

  /**
   * Relay a log entry to the logging agent. This is called by bunyan through
   * Writable#write.
   *
   * @param {object} record - Bunyan log record.
   *
   * @private
   */
  _write(record: BunyanLogRecord, encoding?: string, callback?: Function) {
    const entry = this.formatEntry_(record);
    this.stackdriverLog.write(entry, callback);
  }

  /**
   * Relay an array of log entries to the logging agent. This is called by
   * bunyan through Writable#write.
   *
   * @param {object[]} records - Array of WritableStream WriteReq objects.
   *
   * @private
   */
  // Writable._writev used 'any' in function signature.
  _writev(chunks: BunyanLogRecord[], callback?: Function) {
    // tslint:disable-next-line:no-any
    const entries = chunks.map((request: any) => {
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
