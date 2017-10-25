var bunyan = require('bunyan');
var loggingBunyan = require('@google-cloud/logging-bunyan')();

var logger = bunyan.createLogger({
  name: 'my-service',
  streams: [loggingBunyan.stream('info')],
});

logger.error('warp nacelles offline');
logger.info('shields at 99%');
