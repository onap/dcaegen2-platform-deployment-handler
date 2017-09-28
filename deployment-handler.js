/*
Copyright(c) 2017 AT&T Intellectual Property. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.

You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and limitations under the License.
 */

/* Deployment handler main  */

"use strict";

const API_VERSION = "4.1.0";

const fs = require('fs');
const util = require('util');
const http = require('http');
const https = require('https');
const express = require('express');
const conf = require('./lib/config');
const createError = require('./lib/dispatcher-error').createDispatcherError;

/* Paths for API routes */
const INFO_PATH = "/";
const DEPLOYMENTS_PATH = "/dcae-deployments";
const POLICY_PATH = "/policy";
const SWAGGER_UI_PATH = "/swagger-ui";

const app = express();

const set_app = function() {
	/* Set up the application */
	app.set('x-powered-by', false);
	app.set('etag', false);

	/* Give each request a unique request ID */
	app.use(require('./lib/middleware').assignId);

	/* If authentication is set up, check it */
	app.use(require('./lib/auth').checkAuth);

	/* Set up API routes */
	app.use(INFO_PATH, require('./lib/info'));
	app.use(DEPLOYMENTS_PATH, require('./lib/dcae-deployments'));
	app.use(POLICY_PATH, require('./lib/policy'));
	app.use(SWAGGER_UI_PATH, require('./lib/swagger-ui'));

	/* Set up error handling */
	app.use(require('./lib/middleware').handleErrors);
}

const start = function(config) {

	const startTime = new Date();

	/*
	 * Set log level--config will supply a default of "INFO" if not explicitly
	 * set in config.json
	 */
	logging.setLevel(config.logLevel);

	/* Set up exported configuration */
	config.apiVersion = API_VERSION;
	config.apiLinks = {
		"info" : INFO_PATH,
		"deployments": DEPLOYMENTS_PATH,
		"policy": POLICY_PATH,
		"swagger-ui": SWAGGER_UI_PATH
	};
	exports.config = config;

	log.debug(null, "Configuration: " + JSON.stringify(config));

	set_app();

	/* Start the server */
	var	server = null;
	var	usingTLS = false;
	try {
		if (config.ssl && config.ssl.pfx && config.ssl.passphrase
				&& config.ssl.pfx.length > 0) {
			/*
			 * Check for non-zero pfx length--DCAE config will deliver an empty
			 * pfx if no cert available for the host.
			 */
			server = https.createServer({
				pfx : config.ssl.pfx,
				passphrase : config.ssl.passphrase
			}, app);
			usingTLS = true;
		}
		else {
			server = http.createServer(app);
		}
	}
	catch (e) {
		throw (createError('Could not create http(s) server--exiting: '
				+ e.message, 500, 'system', 551));
	}

	server.setTimeout(0);

	server.listen(config.listenPort, config.listenHost, function(err) {
		var	addr = server.address();
		var msg = ("Deployment-handler version " + config.version + " listening on "
				+ addr.address + ":" + addr.port + " pid: " + process.pid
				+ (usingTLS ? " " : " not ") + "using TLS (HTTPS)");
		log.metrics(null, {startTime: startTime, complete: true}, msg);
	});

	/* Set up handling for terminate signal */
	process.on('SIGTERM', function() {
		var startTime = new Date();
		log.metrics(null, {startTime: startTime, complete: true}, "Deployment Handler API shutting down.")
		server.close(function() {
			log.metrics(null, {startTime: startTime, complete: true}, "Deployment Handler API server shut down.")
		});
	});

	/* Log actual exit */
	/*
	 * logging is asynchronous, so we will see another beforeExit event
	 * after it completes.
	 */
	var	loggedExit = false;
	process.on('beforeExit', function() {
		if (!loggedExit) {
			loggedExit = true;
			log.metrics(null, {startTime: startTime, complete: true}, "Deployment Handler process exiting.")
		}
	});
};

/* Set up logging */
const logging = require('./lib/logging');
const log = logging.getLogger();

/* Get configuration and start */
conf.configure()
.then(start)
.catch(function(e) {
	log.error(e.logCode ? e : createError(
			'Deployment-handler exiting due to start-up problem: ' + e.message, 500,
			'system', 552));
	console.error("Deployment-handler exiting due to startup problem: " + e.message);
});

module.exports.app = app;
module.exports.set_app = set_app;
