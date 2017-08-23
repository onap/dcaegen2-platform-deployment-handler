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

/* Low-level routines for using the Cloudify Manager REST API */

"use strict";

const admzip = require('adm-zip');

const repeat = require('./repeat');
const req = require('./promise_request');
const doRequest = req.doRequest;

var cfyAPI = null;
var cfyAuth = null;
var logger = null;


// Delay function--returns a promise that's resolved after 'dtime'
// milliseconds.`
var delay = function(dtime) {
	return new Promise(function(resolve, reject) {
		setTimeout(resolve, dtime);
	});
};

// Get current status of a workflow execution
// Function for getting execution info
const getExecutionStatus = function(executionId) {
	var reqOptions = {
		method : "GET",
		uri : cfyAPI + "/executions/" + executionId
	};
    if (cfyAuth) {
        reqOptions.auth = cfyAuth;
    } 
	return doRequest(reqOptions);
};

// Poll for the result of a workflow execution
var getWorkflowResult = function(execution_id) {
	var finished = [ "terminated", "cancelled", "failed" ];
	var retryInterval = 15000;   // Every 15 seconds
	var maxTries = 240;           // Up to an hour

	logger.debug(null, "Getting workflow result for execution id: " + execution_id);

	// Function for testing if workflow is finished
	// Expects the result of getExecStatus
	var checkStatus = function(res) {
		logger.debug(null, "Checking result: " + JSON.stringify(res) + " ==> " + (res.json && res.json.status && finished.indexOf(res.json.status) < 0));
		return res.json && res.json.status && finished.indexOf(res.json.status) < 0;
	};
	
	// Create execution status checker function
	var getExecStatus = function() { return getExecutionStatus(execution_id);};

	return repeat.repeatWhile(getExecStatus, checkStatus, maxTries, retryInterval)
	.then(
	
	/* Handle fulfilled promise from repeatWhile */
	function(res) {
		
		logger.debug(null, 'workflow result: ' + JSON.stringify(res));
	
		/* Successful completion */
		if (res.json && res.json.status && res.json.status === 'terminated') {
			return res;
		}
		
		/* If we get here, we don't have a success and we're going to throw something */
		
		var error = {};
		
		/* We expect a JSON object with a status */
		if (res.json && res.json.status) {
					
			/* Failure -- we need to return something that looks like the CM API failures */
			if (res.json.status === 'failed') {
				error.body = 'workflow failed: ' + execution_id + ' -- ' + (res.json.error ? JSON.stringify(res.json.error) : 'no error information');
			}
			
			/* Cancellation -- don't really expect this */
			else if (res.json.status === 'canceled' || res.json.status === 'cancelled') {
				error.body = 'workflow canceled: ' + execution_id;	
			}
			
			/* Don't expect anything else -- but if we get it, it's not a success! */
			else {
				error.body = 'workflow--unexpected status ' + res.json.status + ' for ' + execution_id;
			}
		}
		
        /* The body of the response from the API call to get execution status is not what we expect at all */
		else {
			error.body = 'workflow--unexpected result body getting execution status from CM for ' + execution_id;
		}
		
		throw error;
	},
	
	/* Handle rejection of promise from repeatWhile--don't use a catch because it would catch the error thrown above */
	function(err) {
		/* repeatWhile could fail and we get here because:
		 *    -- repeatWhile explicitly rejects the promise because it has exhausted the retries
		 *    -- repeatWhile propagates a system error (e.g., network problem) trying to access the API
		 *    -- repeatWhile propagates a rejected promise due to a bad HTTP response status
		 *  These should all get normalized in deploy.js--so we just rethrow the error.
		 */

		throw err; 
		
	});
};

//Initiate a workflow execution against a deployment
const initiateWorkflowExecution = function(dpid, workflow) {
	// Set up the HTTP POST request
	var reqOptions = {
		method : "POST",
		uri : cfyAPI + "/executions",
		headers : {
			"Content-Type" : "application/json",
			"Accept" : "*/*"
		}
	};
    if (cfyAuth) {
        reqOptions.auth = cfyAuth;
    }
	var body = {
		deployment_id : dpid,
		workflow_id : workflow
	};

	// Make the POST request
	return doRequest(reqOptions, JSON.stringify(body))
	.then(function(result) {
		logger.debug(null, "Result from POSTing workflow execution start: "	+ JSON.stringify(result));
		if (result.json && result.json.id) {
			return {deploymentId: dpid, workflowType: workflow, executionId: result.json.id};
		}
		else {
			logger.debug(null,"Did not get expected JSON body from POST to start workflow");
			var err = new Error("POST to start workflow got success response but no body");
			err.status = err.code = 502;
		}		
	});	
};

// Uploads a blueprint via the Cloudify API
exports.uploadBlueprint = function(bpid, blueprint) {
	
	// Cloudify API wants a gzipped tar of a directory, not the blueprint text
	var zip = new admzip();
	zip.addFile('work/', new Buffer(0));
	zip.addFile('work/blueprint.yaml', new Buffer(blueprint, 'utf8'));
	var src = (zip.toBuffer());
	
	// Set up the HTTP PUT request
	var reqOptions = {
			method : "PUT",
			uri : cfyAPI + "/blueprints/" + bpid,
			headers : {
				"Content-Type" : "application/octet-stream",
				"Accept" : "*/*"
			}
	};

	if (cfyAuth) {
		reqOptions.auth = cfyAuth;
	}
	// Initiate PUT request and return the promise for a result
	return doRequest(reqOptions, src);
};

// Creates a deployment from a blueprint
exports.createDeployment = function(dpid, bpid, inputs) {

	// Set up the HTTP PUT request
	var reqOptions = {
		method : "PUT",
		uri : cfyAPI + "/deployments/" + dpid,
		headers : {
			"Content-Type" : "application/json",
			"Accept" : "*/*"
		}
	};

    if (cfyAuth) {
        reqOptions.auth = cfyAuth;
    }
	var body = {
		blueprint_id : bpid
	};
	if (inputs) {
		body.inputs = inputs;
	}

	// Make the PUT request to create the deployment
	return doRequest(reqOptions, JSON.stringify(body));
};

// Initiate a workflow execution against a deployment
exports.initiateWorkflowExecution = initiateWorkflowExecution;

// Get the status of a workflow execution
exports.getWorkflowExecutionStatus = getExecutionStatus;

// Return a promise for the final result of a workflow execution
exports.getWorkflowResult = getWorkflowResult;

// Executes a workflow against a deployment and returns a promise for  final result
exports.executeWorkflow = function(dpid, workflow) {

	// Initiate the workflow
	return initiateWorkflowExecution(dpid, workflow)
	
	// Wait for the result
	.then (function(result) {
		logger.debug(null, "Result from initiating workflow: " + JSON.stringify(result));
		return getWorkflowResult(result.executionId);
	});
};

// Wait for workflow to complete and get result
exports.getWorkflowResult = getWorkflowResult;

// Retrieves outputs for a deployment
exports.getOutputs = function(dpid) {
	var reqOptions = {
		method : "GET",
		uri : cfyAPI + "/deployments/" + dpid + "/outputs",
		headers : {
			"Accept" : "*/*"
		}
	};
    if (cfyAuth) {
        reqOptions.auth = cfyAuth;
    }

	return doRequest(reqOptions);
};

// Get the output descriptions for a deployment
exports.getOutputDescriptions = function(dpid) {
	var reqOptions = {
		method : "GET",
		uri : cfyAPI + "/deployments/" + dpid + "?include=outputs",
		headers : {
			"Accept" : "*/*"
		}
	};
    if (cfyAuth) {
        reqOptions.auth = cfyAuth;
    }

	return doRequest(reqOptions);
};

// Deletes a deployment
exports.deleteDeployment = function(dpid) {
	var reqOptions = {
		method : "DELETE",
		uri : cfyAPI + "/deployments/" + dpid
	};
    if (cfyAuth) {
        reqOptions.auth = cfyAuth;
    }

	return doRequest(reqOptions);
};

// Deletes a blueprint
exports.deleteBlueprint = function(bpid) {
	var reqOptions = {
		method : "DELETE",
		uri : cfyAPI + "/blueprints/" + bpid
	};
    if (cfyAuth) {
        reqOptions.auth = cfyAuth;
    }

	return doRequest(reqOptions);
};

// Allow client to set the Cloudify API root address
exports.setAPIAddress = function(addr) {
	cfyAPI = addr;
};

// Allow client to set Cloudify credentials 
exports.setCredentials = function(user, password) {
    cfyAuth = user + ':' + password;
};

// Set a logger
exports.setLogger = function(log) {
	logger = log;
};
