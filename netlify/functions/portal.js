const serverless = require('serverless-http');
const app = require('../../server');

exports.handler = serverless(app, {
  basePath: '/.netlify/functions/portal',
  binary: ['image/png'],
});
