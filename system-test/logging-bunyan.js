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

var assert = require('assert');
var bunyan = require('bunyan');

var logging = require('@google-cloud/logging')();
var loggingBunyan = require('../')();

describe('LoggingBunyan', function() {
  var WRITE_CONSISTENCY_DELAY_MS = 90000;

  var logger = bunyan.createLogger({
    name: 'google-cloud-node-system-test',
    streams: [loggingBunyan.stream('info')],
  });

  it('should properly write log entries', function(done) {
    var timestamp = new Date();
    var circular = {};
    circular.circular = circular;

    var testData = [
      {
        args: ['first'],
        level: 'info',
        verify: function(entry) {
          assert.strictEqual(entry.data.message, 'first');
          assert.strictEqual(entry.data.pid, process.pid);
        },
      },

      {
        args: [new Error('second')],
        level: 'error',
        verify: function(entry) {
          assert(entry.data.message.startsWith('Error: second'));
          assert.strictEqual(entry.data.pid, process.pid);
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
        verify: function(entry) {
          assert.strictEqual(entry.data.message, 'third');
          assert.strictEqual(entry.data.pid, process.pid);
          assert.deepStrictEqual(entry.data.test, {
            circular: '[Circular]',
          });
        },
      },
    ];

    var earliest = {
      args: [
        {
          time: timestamp,
        },
        'earliest',
      ],
      level: 'info',
      verify: function(entry) {
        assert.strictEqual(entry.data.message, 'earliest');
        assert.strictEqual(entry.data.pid, process.pid);
        assert.strictEqual(
          entry.metadata.timestamp.toString(),
          timestamp.toString()
        );
      },
    };

    // Forcibly insert a delay to cause 'third' to have a deterministically
    // earlier timestamp.
    setTimeout(function() {
      testData.forEach(function(test) {
        logger[test.level].apply(logger, test.args);
      });

      // `earliest` is sent last, but it should show up as the earliest entry.
      logger[earliest.level].apply(logger, earliest.args);

      // insert into list as the earliest entry.
      testData.unshift(earliest);
    }, 10);

    setTimeout(function() {
      var log = logging.log('bunyan_log');

      log.getEntries(
        {
          pageSize: testData.length,
        },
        function(err, entries) {
          assert.ifError(err);
          assert.strictEqual(entries.length, testData.length);

          // Make sure entries are valid and are in the correct order.
          entries.reverse().forEach(function(entry, index) {
            var test = testData[index];
            test.verify(entry);
          });

          done();
        }
      );
    }, WRITE_CONSISTENCY_DELAY_MS);
  });
});
