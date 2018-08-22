/**
 * Copyright 2018 Google LLC. All Rights Reserved.
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

import * as check from 'post-install-check';

const TS_CODE_ARRAY: check.CodeSample[] = [
  {
    code: `import * as loggingBunyan from '@google-cloud/logging-bunyan';
new loggingBunyan.LoggingBunyan();`,
    description: 'imports the module using * syntax',
    dependencies: [],
    devDependencies: []
  },
  {
    code: `import {LoggingBunyan} from '@google-cloud/logging-bunyan';
new LoggingBunyan();`,
    description: 'imports the module with {} syntax',
    dependencies: [],
    devDependencies: []
  },
  {
    code: `import {LoggingBunyan} from '@google-cloud/logging-bunyan';
new LoggingBunyan({
  serviceContext: {
    service: 'some service'
  }
});`,
    description: 'imports the module and starts with a partial `serviceContext`',
    dependencies: [],
    devDependencies: []
  },
  {
    code: `import {LoggingBunyan} from '@google-cloud/logging-bunyan';
new LoggingBunyan({
  projectId: 'some-project',
  serviceContext: {
    service: 'Some service',
    version: 'Some version'
  }
});`,
    description:
        'imports the module and starts with a complete `serviceContext`',
    dependencies: [],
    devDependencies: []
  }
];

const JS_CODE_ARRAY: check.CodeSample[] = [
  {
    code:
        `const LoggingBunyan = require('@google-cloud/logging-bunyan').LoggingBunyan;
new LoggingBunyan();`,
    description: 'requires the module using Node 4+ syntax',
    dependencies: [],
    devDependencies: []
  },
  {
    code:
        `const LoggingBunyan = require('@google-cloud/logging-bunyan').LoggingBunyan;
new LoggingBunyan({
  serviceContext: {
    service: 'some service'
  }
});`,
    description:
        'requires the module and starts with a partial `serviceContext`',
    dependencies: [],
    devDependencies: []
  },
  {
    code:
        `const LoggingBunyan = require('@google-cloud/logging-bunyan').LoggingBunyan;
new LoggingBunyan({
  projectId: 'some-project',
  serviceContext: {
    service: 'Some service',
    version: 'Some version'
  }
});`,
    description:
        'requires the module and starts with a complete `serviceContext`',
    dependencies: [],
    devDependencies: []
  }
];

check.testInstallation(TS_CODE_ARRAY, JS_CODE_ARRAY, {timeout: 2 * 60 * 1000});
