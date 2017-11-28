/**
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
import * as proxyquire from 'proxyquire';
import {LoggingBunyan} from '../src/index';

describe('logging-bunyan', () => {
  let fakeLogInstance: {entry?: () => void, write?: () => void} = {};
  let fakeLoggingOptions_: Options|null;
  let fakeLogName_: string|null;
  let fakeLogOptions_: Options;
  let fakeWritableOptions_: Options;

  function fakeLogging(options: Options) {
    fakeLoggingOptions_ = options;
    return {
      log(logName: string, options: Options) {
        fakeLogName_ = logName;
        fakeLogOptions_ = options;
        return fakeLogInstance;
      },
    };
  }

  function FakeWritable(options: Options) {
    fakeWritableOptions_ = options;
  }

  // Writable.write used 'any' in function signature.
  // tslint:disable-next-line:no-any
  FakeWritable.prototype.write =
      (chunk: {}, encoding: string, callback: Function) => {
        // Function cannot pass as type in setImmediate.
        // tslint:disable-next-line:no-any
        setImmediate(callback as any);
      };

  const fakeStream = {
    Writable: FakeWritable,
  };


  const loggingBunyanLib = proxyquire('../src/index.js', {
    '@google-cloud/logging': fakeLogging,
    stream: fakeStream,
  });
  const loggingBunyanCached = proxyquire('../src/index.js', {
    '@google-cloud/logging': fakeLogging,
    stream: fakeStream,
  });
  // loggingBunyan is loggingBunyan namespace which cannot be determined type.
  // tslint:disable-next-line:no-any
  let loggingBunyan: any;

  const OPTIONS = {
    logName: 'log-name',
    resource: {},
    serviceContext: {
      service: 'fake-service',
    },
  };

  const RECORD = {
    level: 30,
    time: '2012-06-19T21:34:19.906Z',
  };

  beforeEach(() => {
    fakeLogInstance = {};
    fakeLoggingOptions_ = null;
    fakeLogName_ = null;

    Object.assign(true, loggingBunyanLib.LoggingBunyan, loggingBunyanCached);
    loggingBunyan = new loggingBunyanLib.LoggingBunyan(OPTIONS);
  });

  describe('instantiation', () => {
    it('should be an object mode Writable', () => {
      assert(loggingBunyan instanceof FakeWritable);
      assert.deepStrictEqual(fakeWritableOptions_, {objectMode: true});
    });

    it('should localize the provided resource', () => {
      assert.strictEqual(loggingBunyan.resource, OPTIONS.resource);
    });

    it('should localize the provided service context', () => {
      assert.strictEqual(loggingBunyan.serviceContext, OPTIONS.serviceContext);
    });

    it('should localize Log instance using provided name', () => {
      assert.strictEqual(fakeLoggingOptions_, OPTIONS);
      assert.strictEqual(fakeLogName_, OPTIONS.logName);
    });

    it('should localize Log instance using default name, options', () => {
      const optionsWithoutLogName = Object.assign({}, OPTIONS);
      delete optionsWithoutLogName.logName;

      const loggingBunyan =
          new loggingBunyanLib.LoggingBunyan(optionsWithoutLogName);

      assert.strictEqual(fakeLoggingOptions_, optionsWithoutLogName);
      assert.strictEqual(fakeLogName_, 'bunyan_log');
      assert.deepStrictEqual(fakeLogOptions_, {removeCircular: true});
    });
  });

  describe('stream', () => {
    it('should return a properly formatted object', () => {
      const level = 'info';
      const stream = loggingBunyan.stream(level);

      assert.strictEqual(stream.level, level);
      assert.strictEqual(stream.type, 'raw');
      assert.strictEqual(stream.stream, loggingBunyan);
    });
  });

  describe('formatEntry_', () => {
    it('should throw an error if record is a string', () => {
      assert.throws(
          () => {
            loggingBunyan.formatEntry_('string record');
          },
          new RegExp(
              '@google-cloud/logging-bunyan only works as a raw bunyan stream type.'));
    });

    it('should properly create an entry', (done) => {
      loggingBunyan.stackdriverLog.entry =
          (entryMetadata: StackdriverEntryMetadata,
           record: StackdriverEntryMetadata) => {
            assert.deepEqual(entryMetadata, {
              resource: loggingBunyan.resource,
              timestamp: RECORD.time,
              severity: loggingBunyanLib.BUNYAN_TO_STACKDRIVER[RECORD.level],
            });
            assert.deepStrictEqual(record, RECORD);
            done();
          };

      loggingBunyan.formatEntry_(RECORD);
    });

    it('should rename the msg property to message', (done) => {
      const recordWithMsg = Object.assign({msg: 'msg'}, RECORD);
      const recordWithMessage = Object.assign({message: 'msg'}, RECORD);

      loggingBunyan.stackdriverLog.entry =
          (entryMetadata: StackdriverEntryMetadata,
           record: StackdriverEntryMetadata) => {
            assert.deepStrictEqual(record, recordWithMessage);
            done();
          };

      loggingBunyan.formatEntry_(recordWithMsg);
    });

    it('should inject the error stack as the message', (done) => {
      const record = Object.assign(
          {
            msg: 'msg',
            err: {
              stack: 'the stack',
            },
          },
          RECORD);
      const expectedRecord = Object.assign(
          {
            msg: 'msg',
            err: {
              stack: 'the stack',
            },
            message: 'the stack',
            serviceContext: OPTIONS.serviceContext,
          },
          RECORD);

      loggingBunyan.stackdriverLog.entry =
          (entryMetadata: StackdriverEntryMetadata,
           record_: StackdriverEntryMetadata) => {
            assert.deepStrictEqual(record_, expectedRecord);
            done();
          };

      loggingBunyan.formatEntry_(record);
    });

    it('should leave message property intact when present', (done) => {
      const record = Object.assign(
          {
            msg: 'msg',
            message: 'message',
            err: {
              stack: 'the stack',
            },
          },
          RECORD);

      loggingBunyan.stackdriverLog.entry =
          (entryMetadata: StackdriverEntryMetadata,
           record_: StackdriverEntryMetadata) => {
            assert.deepStrictEqual(record_, record);
            done();
          };

      loggingBunyan.formatEntry_(record);
    });

    it('should promote the httpRequest property to metadata', (done) => {
      const HTTP_REQUEST = {
        statusCode: 418,
      };
      const recordWithRequest = Object.assign(
          {
            httpRequest: HTTP_REQUEST,
          },
          RECORD);

      loggingBunyan.stackdriverLog.entry =
          (entryMetadata: StackdriverEntryMetadata,
           record: string|BunyanLogRecord) => {
            assert.deepStrictEqual(entryMetadata, {
              resource: loggingBunyan.resource,
              timestamp: RECORD.time,
              severity: loggingBunyanLib.BUNYAN_TO_STACKDRIVER[RECORD.level],
              httpRequest: HTTP_REQUEST,
            });
            assert.deepStrictEqual(record, RECORD);
            done();
          };

      loggingBunyan.formatEntry_(recordWithRequest);
    });

    it('should promote prefixed trace property to metadata', (done) => {
      const recordWithTrace = Object.assign({}, RECORD);
      // recordWithTrace does not have index signature.
      // tslint:disable-next-line:no-any
      (recordWithTrace as any)[loggingBunyanLib.LOGGING_TRACE_KEY] = 'trace1';

      loggingBunyan.stackdriverLog.entry =
          (entryMetadata: StackdriverEntryMetadata,
           record: string|BunyanLogRecord) => {
            assert.deepStrictEqual(entryMetadata, {
              resource: loggingBunyan.resource,
              timestamp: RECORD.time,
              severity: loggingBunyanLib.BUNYAN_TO_STACKDRIVER[RECORD.level],
              trace: 'trace1',
            });
            assert.deepStrictEqual(record, RECORD);
            done();
          };

      loggingBunyan.formatEntry_(recordWithTrace);
    });
  });

  describe('write', () => {
    const oldWritableWrite = FakeWritable.prototype.write;
    const oldTraceAgent = global._google_trace_agent;

    afterEach(() => {
      FakeWritable.prototype.write = oldWritableWrite;
      global._google_trace_agent = oldTraceAgent;
    });

    it('should not set trace property if trace unavailable', (done) => {
      global._google_trace_agent = undefined;

      FakeWritable.prototype.write = function(
          // Writable.write used 'any' in function signature.
          // tslint:disable-next-line:no-any
          record: any, encoding: string, callback: Function) {
        assert.deepStrictEqual(record, RECORD);
        assert.strictEqual(encoding, 'encoding');
        assert.strictEqual(callback, assert.ifError);
        assert.strictEqual(this, loggingBunyan);
        done();
      };

      loggingBunyan.write(RECORD, 'encoding', assert.ifError);
    });

    it('should set prefixed trace property if trace available', (done) => {
      global._google_trace_agent = {
        getCurrentContextId: () => {
          return 'trace1';
        },
        getWriterProjectId: () => {
          return 'project1';
        },
      };
      const recordWithoutTrace = Object.assign({}, RECORD);
      const recordWithTrace = Object.assign({}, RECORD);
      // recordWithTrace does not have index signature.
      // tslint:disable-next-line:no-any
      (recordWithTrace as any)[loggingBunyanLib.LOGGING_TRACE_KEY] =
          'projects/project1/traces/trace1';


      FakeWritable.prototype.write = function(
          // Writable.write used 'any' in function signature.
          // tslint:disable-next-line:no-any
          record: any, encoding: string, callback: Function) {
        // Check that trace field added to record before calling Writable.write
        assert.deepStrictEqual(record, recordWithTrace);

        // Check that the original record passed in was not mutated
        assert.deepStrictEqual(recordWithoutTrace, RECORD);

        assert.strictEqual(encoding, 'encoding');
        assert.strictEqual(callback, assert.ifError);
        assert.strictEqual(this, loggingBunyan);
        done();
      };

      loggingBunyan.write(recordWithoutTrace, 'encoding', assert.ifError);
    });

    it('should leave prefixed trace property as is if set', (done) => {
      const oldTraceAgent = global._google_trace_agent;
      global._google_trace_agent = {
        getCurrentContextId: () => {
          return 'trace-from-agent';
        },
        getWriterProjectId: () => {
          return 'project1';
        },
      };
      const recordWithTraceAlreadySet = Object.assign({}, RECORD);
      // recordWithTraceAlreadySet does not have index signature.
      // tslint:disable-next-line:no-any
      (recordWithTraceAlreadySet as any)[loggingBunyanLib.LOGGING_TRACE_KEY] =
          'trace1';


      FakeWritable.prototype.write = function(
          // Writable.write used 'any' in function signature.
          // tslint:disable-next-line:no-any
          record: any, encoding: string, callback: Function) {
        assert.deepStrictEqual(record, recordWithTraceAlreadySet);
        assert.strictEqual(encoding, '');
        assert.strictEqual(callback, assert.ifError);
        assert.strictEqual(this, loggingBunyan);
        done();
      };

      loggingBunyan.write(recordWithTraceAlreadySet, '', assert.ifError);

      global._google_trace_agent = oldTraceAgent;
    });
  });

  it('should not set prefixed trace property if trace unavailable', () => {
    FakeWritable.prototype.write = function(
        // Writable.write used 'any' in function signature.
        // tslint:disable-next-line:no-any
        record: any, encoding: string, callback: Function) {
      assert.deepStrictEqual(record, RECORD);
      assert.strictEqual(encoding, '');
      assert.strictEqual(callback, assert.ifError);
      assert.strictEqual(this, loggingBunyan);
    };
    const oldTraceAgent = global._google_trace_agent;

    global._google_trace_agent = {};
    loggingBunyan.write(RECORD, '', assert.ifError);

    global._google_trace_agent = {
      getCurrentContextId: () => {
        return null;
      },
      getWriterProjectId: () => {
        return null;
      },
    };
    loggingBunyan.write(RECORD, '', assert.ifError);
    global._google_trace_agent = {
      getCurrentContextId: () => {
        return null;
      },
      getWriterProjectId: () => {
        return 'project1';
      },
    };
    loggingBunyan.write(RECORD, '', assert.ifError);

    global._google_trace_agent = {
      getCurrentContextId: () => {
        return 'trace1';
      },
      getWriterProjectId: () => {
        return null;
      },
    };
    loggingBunyan.write(RECORD, '', assert.ifError);

    global._google_trace_agent = oldTraceAgent;
  });

  describe('_write', () => {
    beforeEach(() => {
      fakeLogInstance.entry = () => {};
      fakeLogInstance.write = () => {};
    });

    it('should format the record', (done) => {
      loggingBunyan.formatEntry_ = (record: string|BunyanLogRecord) => {
        assert.strictEqual(record, RECORD);
        done();
      };

      loggingBunyan._write(RECORD, '', assert.ifError);
    });

    it('should write the record to the log instance', (done) => {
      const entry = {};

      loggingBunyan.stackdriverLog.entry = () => {
        return entry;
      };

      loggingBunyan.stackdriverLog.write =
          // Writable.write used 'any' in function signature.
          // tslint:disable-next-line:no-any
          (entries: any, callback: Function) => {
            assert.strictEqual(entries, entry);
            callback();  // done()
          };

      loggingBunyan._write(RECORD, '', done);
    });
  });

  describe('_writev', () => {
    const RECORDS = [{chunk: RECORD}, {chunk: RECORD}];
    beforeEach(() => {
      fakeLogInstance.entry = () => {};
      fakeLogInstance.write = () => {};
    });

    it('should format the records', (done) => {
      let numFormatted = 0;
      loggingBunyan.formatEntry_ = (record: string|BunyanLogRecord) => {
        assert.strictEqual(record, RECORD);
        if (++numFormatted === RECORDS.length) {
          done();
        }
      };

      loggingBunyan._writev(RECORDS, assert.ifError);
    });

    it('should write the records to the log instance', (done) => {
      const entry = {};

      loggingBunyan.stackdriverLog.entry = () => {
        return entry;
      };

      loggingBunyan.stackdriverLog.write =
          // Writable.write used 'any' in function signature.
          // tslint:disable-next-line:no-any
          (entries: any, callback: Function) => {
            assert.deepStrictEqual(entries, [entry, entry]);
            callback();  // done()
          };

      loggingBunyan._writev(RECORDS, done);
    });
  });

  describe('BUNYAN_TO_STACKDRIVER', () => {
    it('should correctly map to Stackdriver Logging levels', () => {
      const bunyanToStackdriver: Map<number, string> = new Map([
        [60, 'CRITICAL'],
        [50, 'ERROR'],
        [40, 'WARNING'],
        [30, 'INFO'],
        [20, 'DEBUG'],
        [10, 'DEBUG'],
      ]);
      assert.deepEqual(
          loggingBunyanLib.BUNYAN_TO_STACKDRIVER, bunyanToStackdriver);
    });
  });
});
