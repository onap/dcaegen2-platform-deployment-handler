/*
Copyright(c) 2017-2018 AT&T Intellectual Property. All rights reserved.

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

/* Deploy and undeploy using Cloudify blueprints */

const config = process.mainModule.exports.config;

/* Set delays between steps */
const DELAY_INSTALL_WORKFLOW = 30000;
const DELAY_RETRIEVE_OUTPUTS = 5000;
const DELAY_DELETE_DEPLOYMENT = 30000;
const DELAY_DELETE_BLUEPRINT = 10000;

const createError = require('./dispatcher-error').createDispatcherError;

/* Set up logging */
var logger = require("./logging").getLogger();

/* Set up the Cloudify low-level interface library */
var cfy = require("./cloudify.js");
/* Set config for interface library */
cfy.setAPIAddress(config.cloudify.url);
cfy.setCredentials(config.cloudify.user, config.cloudify.password);
cfy.setLogger(logger);




// Try to parse a string as JSON
var parseContent = function(input) {
	var res = {json: false, content: input};
	try {
		var parsed = JSON.parse(input);
		res.json = true;
		res.content = parsed;
	}
	catch (pe) {
		// Do nothing, just indicate it's not JSON and return content as is
	}
	return res;
};

// create a normalized representation of errors, whether they're a node.js Error or a Cloudify API error
var normalizeError = function (err) {
	var e;

	if (err instanceof Error) {
		/* node.js system error */
		e = createError("Error communicating with CM: " + err.message, 504, "system", 202, 'cloudify-manager');
	}
	else {
		// Try to populate error with information from a Cloudify API error
		// We expect to see err.body, which is a stringified JSON object
		// We can parse it and extract message and error_code
		var message = err.message || "unknown Cloudify Manager API error";
		var status = err.status || 502;
		var cfyCode = "UNKNOWN";
		var cfyMessage;

		if (err.body) {
			var p = parseContent(err.body);
			if (p.json) {
				cfyMessage =  p.content.message ? p.content.message : "unknown Cloudify API error";
				cfyCode = p.content.error_code ? p.content.error_code : "UNKNOWN";
			}
			else {
				// if there's a body and we can't parse it just attach it as the message
				cfyMessage = err.body;
			}
			message = "Status " + status + " from CM API -- error code: " + cfyCode + " -- message: " + cfyMessage;
		}

		/* Pass through 400-level status, recast 500-level */
		var returnStatus = (err.status > 499) ? 502 : err.status;
		e = createError(message, returnStatus, "api", 502, 'cloudify-manager');
	}

	return e;
};

// Augment the raw outputs from a deployment with the descriptions from the blueprint
var annotateOutputs = function (req, id, rawOutputs) {
	return new Promise(function(resolve, reject) {

		var outItems = Object.keys(rawOutputs);

		if (outItems.length < 1) {
			// No output items, so obviously no descriptions, just return empty object
			resolve({});
		}
		else {
			// Call Cloudify to get the descriptions
			cfy.getOutputDescriptions(req, id)
			.then(function(res) {
				// Assemble an outputs object with values from raw output and descriptions just obtained
				var p = parseContent(res.body);
				if (p.json && p.content.outputs) {
					var outs = {};
					outItems.forEach(function(i) {
						outs[i] = {value: rawOutputs[i]};
						if (p.content.outputs[i] && p.content.outputs[i].description) {
							outs[i].description = p.content.outputs[i].description;
						}
					});
					resolve(outs);
				}
				else {
					reject({code: "API_INVALID_RESPONSE", message: "Invalid response for output descriptions query"});
				}
			});
		}

	});
};

// Delay function--returns a promise that's resolved after 'dtime' milliseconds.`
var delay = function(dtime) {
	return new Promise(function(resolve, reject){
		setTimeout(resolve, dtime);
	});
};

// Go through the Cloudify API call sequence to upload blueprint, create deployment, and launch install workflow
// (but don't wait for the workflow to finish)
const launchBlueprint = function(req, id, blueprint, inputs) {
	logger.info(req.dcaeReqId, "deploymentId: " + id + " starting blueprint upload");
	// Upload blueprint
	return cfy.uploadBlueprint(req, id, blueprint)

	// Create deployment
	.then (function(result) {
		logger.info(req.dcaeReqId, "deploymentId: " + id + " blueprint uploaded");
		// Create deployment
		return cfy.createDeployment(req, id, id, inputs);
	})

	// Launch the workflow, but don't wait for it to complete
	.then(function(result){
		logger.info(req.dcaeReqId, "deploymentId: " + id + " deployment created");
		return delay(DELAY_INSTALL_WORKFLOW)
		.then(function(){
			return cfy.initiateWorkflowExecution(req, id, 'install');
		});
	})
	.catch(function(error) {
		logger.info(req.dcaeReqId, "Error: " + JSON.stringify(error) + " for launch blueprint for deploymentId " + id);
		throw normalizeError(error);
	});
};
exports.launchBlueprint = launchBlueprint;

// Finish installation launched with launchBlueprint
const finishInstallation = function(req, deploymentId, executionId) {
	logger.info(req.dcaeReqId, "finishInstallation: " + deploymentId + " -- executionId: " + executionId);
	return cfy.getWorkflowResult(req, executionId)
	.then (function(result){
		logger.info(req.dcaeReqId, "deploymentId: " + deploymentId + " install workflow successfully executed");
		// Retrieve the outputs from the deployment, as specified in the blueprint
		return delay(DELAY_RETRIEVE_OUTPUTS).then(function() {
			return cfy.getOutputs(req, deploymentId);
		});
	})
	.then(function(result) {
	    // We have the raw outputs from the deployment but not annotated with the descriptions
		var rawOutputs = {};
		if (result.body) {
			var p = parseContent(result.body);
			if (p.json) {
				if (p.content.outputs) {
					rawOutputs = p.content.outputs;
				}
			}
		}
		logger.info(req.dcaeReqId, "output retrieval result for " + deploymentId + ": " + JSON.stringify(result));
		return annotateOutputs(req, deploymentId, rawOutputs);
	})
	.catch(function(err) {
		logger.info(req.dcaeReqId, "Error finishing install workflow: " + err + " -- " + JSON.stringify(err));
		throw normalizeError(err);
	});
};
exports.finishInstallation = finishInstallation;

// Initiate uninstall workflow against a deployment, but don't wait for workflow to finish
const launchUninstall = function(req, deploymentId) {
	logger.info(req.dcaeReqId, "deploymentId: " + deploymentId + " starting uninstall workflow");
	// Run uninstall workflow
	return cfy.initiateWorkflowExecution(req, deploymentId, 'uninstall')
	.then(function(result) {
		return result;
	})
	.catch(function(err) {
		logger.info(req.dcaeReqId, "Error initiating uninstall workflow: " + err + " -- " + JSON.stringify(err));
		throw normalizeError(err);
	});
};
exports.launchUninstall = launchUninstall;

const finishUninstall = function(req, deploymentId, executionId) {
	logger.info(req.dcaeReqId, "finishUninstall: " + deploymentId + " -- executionId: " + executionId);
	return cfy.getWorkflowResult(req, executionId)
	.then (function(result){
		logger.info(req.dcaeReqId, "deploymentId: " + deploymentId + " uninstall workflow successfully executed");
		// Delete the deployment
		return delay(DELAY_DELETE_DEPLOYMENT).then(function() {
			return cfy.deleteDeployment(req, deploymentId);
		});
	})
	.then (function(result){
		logger.info(req.dcaeReqId, "deploymentId: " + deploymentId + " deployment deleted");
		// Delete the blueprint
		return delay(DELAY_DELETE_BLUEPRINT).then(function() {
			return cfy.deleteBlueprint(req, deploymentId);
		});
	})
	.then (function(result){
		return result;
	})
	.catch (function(err){
		throw normalizeError(err);
	});

};
exports.finishUninstall = finishUninstall;

// Get the status of a workflow execution
exports.getExecutionStatus = function (req, exid) {
	return cfy.getWorkflowExecutionStatus(req, exid)
	.then(function(res){

		var result = {
			operationType: res.json.workflow_id
		};

		// Map execution status
		if (res.json.status === "terminated") {
			result.status = "succeeded";
		}
		else if (res.json.status === "failed") {
			result.status = "failed";
		}
		else if (res.json.status === "cancelled" || res.stats === "canceled") {
			result.status = "canceled";
		}
		else {
			result.status = "processing";
		}

		if (res.json.error) {
			result.error = res.json.error;
		}
		logger.info(req.dcaeReqId, "getExecutionStatus result: " + JSON.stringify(result));
		return result;
	})
	.catch(function(error) {
		throw normalizeError(error);
	});
};

// Go through the Cloudify API call sequence to do a deployment
exports.deployBlueprint = function(req, id, blueprint, inputs) {

    // Upload blueprint, create deployment, and initiate install workflow
	return launchBlueprint(req, id, blueprint, inputs)

	// Wait for the workflow to complete
	.then(

	// launchBlueprint promise fulfilled -- finish installation
	function(result){
		return finishInstallation(req, result.deploymentId, result.executionId); // Will throw normalized error if it fails
	},

	// launchBlueprint promise rejected -- report error
	function(err) {
		throw normalizeError(err);
	});
};

// Go through the Cloudify API call sequence to do an undeployment of a previously deployed blueprint
exports.undeployDeployment = function(req, id) {
	logger.info(req.dcaeReqId, "deploymentId: " + id + " starting uninstall workflow");

	// Run launch uninstall workflow
	return launchUninstall(req, id)

	// launchUninstall promise fulfilled -- finish uninstall
	.then (function(result){
		return finishUninstall(req, result.deploymentId, result.executionId);  // Will throw normalized error if it fails
	},

	// launchUninstall promise rejected -- report error
	function(err){
		throw normalizeError(err);
	});
};

