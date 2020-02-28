/*
Copyright(c) 2017-2020 AT&T Intellectual Property. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.

You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and limitations under the License.
*/

"use strict";

const os = require('os');

const log4js = require('log4js');
log4js.configure('etc/log4js.json');

const auditLogger = log4js.getLogger('audit');
const errorLogger = log4js.getLogger('error');
const metricsLogger = log4js.getLogger('metrics');
const debugLogger = log4js.getLogger('debug');

/* Audit log fields */
const AUDIT_BEGIN  = 0;
const AUDIT_END = 1;
const AUDIT_REQID = 2;
const AUDIT_SVCINST = 3;
const AUDIT_THREAD = 4;
const AUDIT_SRVNAME = 5;
const AUDIT_SVCNAME = 6;
const AUDIT_PARTNER = 7;
const AUDIT_STATUSCODE = 8;
const AUDIT_RESPCODE = 9;
const AUDIT_RESPDESC = 10;
const AUDIT_INSTUUID = 11;
const AUDIT_CATLOGLEVEL = 12;
const AUDIT_SEVERITY = 13;
const AUDIT_SRVIP = 14;
const AUDIT_ELAPSED = 15;
const AUDIT_SERVER = 16;
const AUDIT_CLIENTIP = 17;
const AUDIT_CLASSNAME = 18;
const AUDIT_UNUSED = 19;
const AUDIT_PROCESSKEY = 20;
const AUDIT_CUSTOM1 = 21;
const AUDIT_CUSTOM2 = 22;
const AUDIT_CUSTOM3 = 23;
const AUDIT_CUSTOM4 = 24;
const AUDIT_DETAILMSG = 25;
const AUDIT_NFIELDS = 26;

/* Error log fields */
const ERROR_TIMESTAMP = 0;
const ERROR_REQID = 1;
const ERROR_THREAD = 2;
const ERROR_SVCNAME = 3;
const ERROR_PARTNER = 4;
const ERROR_TGTENTITY = 5;
const ERROR_TGTSVC = 6;
const ERROR_CATEGORY = 7;
const ERROR_CODE = 8;
const ERROR_DESCRIPTION = 9;
const ERROR_MESSAGE = 10;
const ERROR_NFIELDS = 11;

/* Error code -> description mapping */
const descriptions = {

		201: 'Inventory communication error',
		202: 'Cloudify Manager communication error',

		501: 'Inventory API error',
		502: 'Cloudify Manager API error',

		551: 'HTTP(S) Server initialization error',
		552: 'Dispatcher start-up error',
		553: 'Execute workflow on deployment error',

		999: 'Unknown error'
};

/* Metrics log fields */
const METRICS_BEGIN = 0;
const METRICS_END = 1;
const METRICS_REQID = 2;
const METRICS_SVCINST= 3;
const METRICS_THREAD = 4;
const METRICS_SRVNAME = 5;
const METRICS_SVCNAME = 6;
const METRICS_PARTNER = 7;
const METRICS_TGTENTITY = 8;
const METRICS_TGTSVC = 9;
const METRICS_STATUSCODE = 10;
const METRICS_RESPCODE = 11;
const METRICS_RESPDESC = 12;
const METRICS_INSTUUID = 13;
const METRICS_CATLOGLEVEL = 14;
const METRICS_SEVERITY = 15;
const METRICS_SRVIP = 16;
const METRICS_ELAPSED = 17;
const METRICS_SERVER = 18;
const METRICS_CLIENTIP = 19;
const METRICS_CLASSNAME = 20;
const METRICS_UNUSED = 21;
const METRICS_PROCESSKEY = 22;
const METRICS_TGTVIRTENTITY = 23;
const METRICS_CUSTOM1 = 24;
const METRICS_CUSTOM2 = 25;
const METRICS_CUSTOM3 = 26;
const METRICS_CUSTOM4 = 27;
const METRICS_DETAILMSG = 28;
const METRICS_NFIELDS = 29;

/* Debug log fields */
const DEBUG_TIMESTAMP = 0;
const DEBUG_REQID = 1;
const DEBUG_INFO = 2;
const DEBUG_EOR = 3;
const DEBUG_NFIELDS = 4;
const DEBUG_MARKER = '^';


/*  Format audit record for an incoming API request */
const formatAuditRecord = function(req, status, extra) {
	var rec = new Array(AUDIT_NFIELDS);
	const end = new Date();
	rec[AUDIT_INSTUUID] = (process.mainModule.exports.config || {}).server_instance_uuid || "";
	rec[AUDIT_END] = end.toISOString();
	rec[AUDIT_BEGIN] = req.startTime.toISOString();
	rec[AUDIT_REQID] = req.dcaeReqId;
	rec[AUDIT_SRVNAME] = req.hostname; 			// Use the value from the Host header
	rec[AUDIT_SVCNAME] = req.method + ' ' + req.originalUrl;	// Method and URL identify the operation being performed
	rec[AUDIT_STATUSCODE] = (status < 300 ) ? "COMPLETE" : "ERROR";
	rec[AUDIT_RESPCODE] = status;   // Use the HTTP status code--does not match the table in the logging spec, but makes more sense
	rec[AUDIT_CATLOGLEVEL] = "INFO";   // The audit records are informational, regardless of the outcome of the operation
	rec[AUDIT_SRVIP] = req.socket.address().address;
	rec[AUDIT_ELAPSED] = end - req.startTime;
	rec[AUDIT_SERVER] = req.hostname;  // From the Host header, again
	rec[AUDIT_CLIENTIP] = req.connection.remoteAddress;

	if (extra) {
		rec[AUDIT_DETAILMSG]= extra.replace(/\n/g, " ");		/* Collapse multi-line extra data to a single line */
	}
	return rec.join('|');
};

/*  Format metrics record for internal processing */
/*  opInfo has:
 * 		startTime -- operation start time in millis
 *      complete -- true if operation completed successfully, false if failed
 *      respCode -- response code received from downstream system, if any
 *      respDesc -- response description received from downstream system, if any
 *      targetEntity -- name or identifier of downstream system used for subrequest, if any
 *      targetRequest -- request made to downstream system, if any
 */
const formatMetricsRecord = function(req, opInfo, extra) {
	var rec = new Array(METRICS_NFIELDS);
	const end = new Date();
	rec[METRICS_INSTUUID] = (process.mainModule.exports.config || {}).server_instance_uuid || "";
	rec[METRICS_END] = end.toISOString();
	rec[METRICS_BEGIN] = opInfo.startTime.toISOString();

	/* If reporting on a suboperation invoked as a result of an incoming request, capture info about that request */
	if (req) {
		rec[METRICS_REQID] = req.dcaeReqId;
		rec[METRICS_SRVNAME] = req.hostname;    // Use name from the host header
		rec[METRICS_SVCNAME] = req.method + ' ' + req.originalUrl;	 // Method and URL identify the operation being performed
		/* Defense: some clients will pass in a req that's incomplete */
		if (req.connection) {rec[METRICS_CLIENTIP] = req.connection.remoteAddress;}
		if (req.socket) {rec[METRICS_SRVIP] = req.socket.address().address;}
	}
	else {
		/* No incoming request */
		rec[METRICS_REQID] = 'no incoming request';
		rec[METRICS_SRVNAME] = os.hostname();
		rec[METRICS_SVCNAME] = 'no incoming request';
	}

	rec[METRICS_TGTENTITY] = opInfo.targetEntity;
	rec[METRICS_TGTSVC] = opInfo.targetService;
	rec[METRICS_STATUSCODE] =  opInfo.complete ? "COMPLETE" : "ERROR";
	rec[METRICS_RESPCODE] = opInfo.respCode;
	rec[METRICS_CATLOGLEVEL] = "INFO";   // The audit records are informational, regardless of the outcome of the operation

	rec[METRICS_ELAPSED] = end - opInfo.startTime;
	rec[METRICS_SERVER] = rec[METRICS_SRVNAME];

	if (extra) {
		rec[METRICS_DETAILMSG]= extra.replace(/\n/g, " ");		/* Collapse multi-line extra data to a single line */
	}
	return rec.join('|');
};

/* Format error log record */
const formatErrorRecord = function(category, code, detail, req, target) {
	var rec = new Array(ERROR_NFIELDS);

	/* Common fields */
	rec[ERROR_TIMESTAMP] = (new Date()).toISOString();
	rec[ERROR_CATEGORY] = category;
	rec[ERROR_CODE] = code;
	rec[ERROR_DESCRIPTION] = descriptions[code] || 'no description available';

	/* Log error detail in a single line if provided */
	if (detail) {
		rec[ERROR_MESSAGE] = detail.replace(/\n/g, " ");
	}

	/* Fields available if the error happened during processing of an incoming API request */
	if (req) {
		rec[ERROR_REQID] = req.dcaeReqId;
		rec[ERROR_SVCNAME] = req.method + ' ' + req.originalUrl;    // Method and URL identify the operation being performed
		rec[ERROR_PARTNER] = req.connection.remoteAddress;  	// We don't have the partner's name, but we know the remote IP address
	}

	/* Include information about the target entity/service if available */
	if (target) {
		rec[ERROR_TGTENTITY] = target.entity || '';
		rec[ERROR_TGTSVC] = target.service || '';
	}
	return rec.join('|');
};

/* Format debug log record */
const formatDebugRecord = function(reqId, msg) {
	var rec = new Array(DEBUG_NFIELDS);

	rec[DEBUG_TIMESTAMP] = new Date().toISOString();
	rec[DEBUG_REQID] = reqId || '';
	rec[DEBUG_INFO] = msg;
	rec[DEBUG_EOR] = DEBUG_MARKER;

	return rec.join('|');

};

exports.getLogger = function() {
	return {

		audit:  function(req, status, extra) {
			auditLogger.info(formatAuditRecord(req, status, extra));
		},

		error: function(error, req) {
			errorLogger.error(formatErrorRecord("ERROR", error.logCode, error.message, req, {entity: error.target}));
		},

		warn: function(error, req) {
			errorLogger.error(formatErrorRecord("WARN", error.logCode, error.message, req, {entity: error.target}));
		},

		metrics: function(req, opInfo, extra) {
			metricsLogger.info(formatMetricsRecord(req, opInfo, extra));
		},

		info: function(reqId, msg) {
			debugLogger.info(formatDebugRecord(reqId, msg));
		},

		debug: function(reqId, msg) {
			debugLogger.debug(formatDebugRecord(reqId, msg));
		}
	};
};

exports.setLevel = function(level) {
	level = (level || 'debug').toLowerCase();
	debugLogger.level = level;
};
