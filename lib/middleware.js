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

/* Middleware modules  */

"use strict";

const utils = require('./utils');
const log = require('./logging').getLogger();

/* Assign a request ID and start time to each incoming request */
exports.assignId = function(req, res, next) {
	/* Use request ID from header if available, otherwise generate one */
	req.startTime = new Date();
	req.dcaeReqId = req.get('X-ECOMP-RequestID') ||  utils.generateId();
	next();
};


/* Error handler -- send error with JSON body */
exports.handleErrors = function(err, req, res, next) {
	var status = err.status || 500;
	var msg = err.message || err.body || 'unknown error'
	res.status(status).type('application/json').send({status: status, message: msg });
	log.audit(req, status, msg);

	if (status >= 500) {
		log.error(err, req);
	}
};

/* Make sure Content-Type is correct for POST and PUT */
exports.checkType = function(type){
	return function(req, res, next) {
		const ctype = req.header('content-type');
		const method = req.method.toLowerCase();
		/* Content-Type matters only for POST and PUT */
		if (ctype === type || ['post','put'].indexOf(method) < 0) {
			next();
		}
		else {
			var err = new Error ('Content-Type must be \'' + type +'\'');
			err.status = 415;
			next (err);
		}	
	};
};

/* Check that a JSON body has a set of properties */
exports.checkProps = function(props) {
	return function (req, res, next) {
		const missing = props.filter(function(p){return !utils.hasProperty(req.body,p);});
		if (missing.length > 0) {
			var err = new Error ('Request missing required properties: ' + missing.join(','));
			err.status = 400;
			next(err);
		}
		else {
			next();
		}	
	};
};


