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

import * as assert from 'assert';
import * as bunyan from 'bunyan';
import delay from 'delay';
import * as uuid from 'uuid';

import * as types from '../src/types/core';
import {ErrorsApiTransport} from './errors-transport';

const {Logging} = require('@google-cloud/logging');
const logging = new Logging();
import {LoggingBunyan} from '../src/index';

const UUID = uuid.v4();
function uniqueName(name: string) {
  return `${UUID}_${name}`;
}

const LOG_NAME = uniqueName('bunyan_log_system_tests');
const LOGGER_NAME = uniqueName('google-cloud-node-system-test');
const SERVICE = uniqueName('logging-bunyan-system-test');
const VERSION = uniqueName('none');

describe('LoggingBunyan', () => {
  const WRITE_CONSISTENCY_DELAY_MS = 90000;

  const loggingBunyan = new LoggingBunyan({
    logName: LOG_NAME,
    serviceContext: {service: SERVICE, version: VERSION}
  });
  const logger = bunyan.createLogger({
    name: LOGGER_NAME,
    streams: [loggingBunyan.stream('info')],
  });

  it('should properly write log entries', (done) => {
    const timestamp = new Date();
    // Type of circular.circular cannot be determined..
    // tslint:disable-next-line:no-any
    const circular: {circular?: any} = {};
    circular.circular = circular;

    const testData = [
      {
        args: ['first'],
        level: 'info',
        verify: (entry: types.StackdriverEntry) => {
          assert.strictEqual(
              (entry.data as types.StackdriverData).message, 'first');
          assert.strictEqual(
              (entry.data as types.StackdriverData).pid, process.pid);
        },
      },

      {
        args: [new Error('second')],
        level: 'error',
        verify: (entry: types.StackdriverEntry) => {
          assert(((entry.data as types.StackdriverData).message as string)
                     .startsWith('Error: second'));
          assert.strictEqual(
              (entry.data as types.StackdriverData).pid, process.pid);
        },
      },

      {
        args: [
          {
            test: circular,
          },
          'third',
        ],
        level: 'info',
        verify: (entry: types.StackdriverEntry) => {
          assert.strictEqual(
              (entry.data as types.StackdriverData).message, 'third');
          assert.strictEqual(
              (entry.data as types.StackdriverData).pid, process.pid);
          assert.deepStrictEqual((entry.data as types.StackdriverData).test, {
            circular: '[Circular]',
          });
        },
      },
    ];

    const earliest = {
      args: [
        {
          time: timestamp,
        },
        'earliest',
      ],
      level: 'info',
      verify: (entry: types.StackdriverEntry) => {
        assert.strictEqual(
            (entry.data as types.StackdriverData).message, 'earliest');
        assert.strictEqual(
            (entry.data as types.StackdriverData).pid, process.pid);
        assert.strictEqual(
            ((entry.metadata as types.StackdriverEntryMetadata).timestamp as
             Date)
                .toString(),
            timestamp.toString());
      },
    };

    // Forcibly insert a delay to cause 'third' to have a deterministically
    // earlier timestamp.
    setTimeout(() => {
      testData.forEach((test) => {
        // logger does not have index signature.
        // tslint:disable-next-line:no-any
        (logger as any)[test.level].apply(logger, test.args);
      });

      // `earliest` is sent last, but it should show up as the earliest entry.
      // logger does not have index signature.
      // tslint:disable-next-line:no-any
      (logger as any)[earliest.level].apply(logger, earliest.args);

      // insert into list as the earliest entry.
      // TODO: identify the correct type for testData and earliest
      // tslint:disable-next-line:no-any
      testData.unshift(earliest as any);
    }, 10);

    setTimeout(() => {
      const log = logging.log(LOG_NAME);

      log.getEntries(
          {
            pageSize: testData.length,
          },
          (err: Error, entries: types.StackdriverEntry[]) => {
            assert.ifError(err);
            assert.strictEqual(entries.length, testData.length);

            // Make sure entries are valid and are in the correct order.
            entries.reverse().forEach((entry, index) => {
              const test = testData[index];
              test.verify(entry);
            });

            done();
          });
    }, WRITE_CONSISTENCY_DELAY_MS);
  });

  describe('ErrorReporting', () => {
    const ERROR_REPORTING_DELAY_MS = 2 * 60 * 1000;
    const errorsTransport = new ErrorsApiTransport();

    beforeEach(async function() {
      this.timeout(2 * ERROR_REPORTING_DELAY_MS);
      await errorsTransport.deleteAllEvents();
      return delay(ERROR_REPORTING_DELAY_MS);
    });

    afterEach(async () => {
      await errorsTransport.deleteAllEvents();
    });

    it('reports errors when logging errors', async function() {
      this.timeout(2 * ERROR_REPORTING_DELAY_MS);
      const start = Date.now();
      const service =
          uniqueName('logging-bunyan-system-test-error-reporting-test');
      const message = uniqueName(`an error at ${start}`);
      // logger does not have index signature.
      // tslint:disable-next-line:no-any
      (logger as any)['error'].call(logger, new Error(message));
      const errors = await errorsTransport.pollForNewEvents(
          service, start, ERROR_REPORTING_DELAY_MS);
      assert.strictEqual(errors.length, 1);
      const errEvent = errors[0];
      assert.strictEqual(errEvent.serviceContext.service, service);
      assert(errEvent.message.startsWith(`Error: ${message}`));
    });
  });
});
