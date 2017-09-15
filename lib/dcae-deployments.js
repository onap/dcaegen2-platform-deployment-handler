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

/* Handle the /dcae-deployments API */

"use strict";

/* Set this code up as a "sub-app"--lets us get the mountpoint for creating links */
const app = require('express')();
app.set('x-powered-by', false);
app.set('etag', false);

const bodyParser = require('body-parser');
const deploy = require('./deploy');
const middleware = require('./middleware');
const inv = require('./inventory');
const log = require('./logging').getLogger();

/* Pick up config exported by main */
const config = process.mainModule.exports.config;
const inventory = inv({url: config.inventory.url});

/* Set up middleware stack for initial processing of request */
app.use(middleware.checkType('application/json'));		// Validate type
app.use(bodyParser.json({strict: true}));				// Parse body as JSON


/* Return a promise for a blueprint for the given service type ID */
const getBlueprint = function(serviceTypeId) {
	return inventory.getBlueprintByType(serviceTypeId)
	.then(function (blueprintInfo) {
		if (!blueprintInfo.blueprint) {
			var e = new Error("No service type with ID " + serviceTypeId);
			e.status = 404;
			throw e;
		}
		return blueprintInfo;
	})	
};

/* Generate self and status links object for responses */
const createLinks = function(req, deploymentId, executionId) {
	var baseURL = req.protocol + '://' + req.get('Host') + req.app.mountpath + '/' + deploymentId;
    return {
    	self: baseURL,
		status: baseURL + '/operation/' + executionId
	};	
};

/* Generate a success response body for PUT and DELETE operations */
const createResponse = function(req, result) {
	return {
		requestId: req.dcaeReqId,
		links: createLinks(req, result.deploymentId, result.executionId)
	};
};

/* Look up running (or in process of deploying) instances of the given service type */
app.get('/', function (req, res, next) {
	var services = []
	
	
	var searchTerm = {};

	req.query['serviceTypeId'] && (searchTerm = {typeId: req.query['serviceTypeId']});
	
	inventory.getServicesByType(searchTerm)
	.then(function (result) {
		var deployments = result.map(function(service){
			return {
				href: req.protocol + '://' + req.get('Host') + req.app.mountpath + '/' + service.deploymentId
			};
		})
		res.status(200).json({requestId: req.dcaeReqId, deployments: deployments});
		log.audit(req, 200);
	})
	.catch(next);   /* Let the error handler send response and log the error */
});

/* Accept an incoming deployment request */
app.put('/:deploymentId', function(req, res, next) {
	
	log.debug(req.dcaeReqId, "body: " + JSON.stringify(req.body));
	
	/* Make sure there's a serviceTypeId in the body */
	if (!req.body['serviceTypeId']) {
		var e = new Error ('Missing required parameter serviceTypeId');
		e.status = 400;
		throw e;
	}
	
	/* Make sure the deploymentId doesn't already exist */
	inventory.verifyUniqueDeploymentId(req.params['deploymentId'])

	/* Get the blueprint for this service type */
	.then(function(res) {
		return getBlueprint(req.body['serviceTypeId']);
	})
	
	/* Add this new service instance to inventory 
	 * Easier to remove from inventory if deployment fails than vice versa 
	 * Also lets client check for deployed/deploying instances if client wants to limit number of instances
	 */
	.then(function (blueprintInfo) {
		req.dcaeBlueprint = blueprintInfo.blueprint;
		return inventory.addService(req.params['deploymentId'], blueprintInfo.typeId, "dummyVnfId", "dummyVnfType", "dummyLocation");
	})
	
	/* Upload blueprint, create deployment and start install workflow (but don't wait for completion */
	.then (function() {
		req.dcaeAddedToInventory = true;
		return deploy.launchBlueprint(req.params['deploymentId'], req.dcaeBlueprint, req.body['inputs']);
	})
	
	/* Send the HTTP response indicating workflow has started */
	.then(function(result) {
		res.status(202).json(createResponse(req, result));
		log.audit(req, 202, "Execution ID: " + result.executionId);
		return result;
	})
	
	/* Finish deployment--wait for the install workflow to complete, retrieve and annotate outputs */
	.then(function(result) {
		return deploy.finishInstallation(result.deploymentId, result.executionId);
	})
	
	/* Log completion in audit log */
	.then (function(result) {
		log.audit(req, 200, "Deployed id: " + req.params['deploymentId']);
	})
	
	/* All errors show up here */
	.catch(function(error) {	
				
		/* If we haven't already sent a response, let the error handler send response and log the error */
		if (!res.headersSent) {
	
			/* If we made an inventory entry, remove it */
			if (req.dcaeAddedToInventory) {
				inventory.deleteService(req.params['deploymentId'])
				.catch(function(error) {
					log.error(error, req);
				});
			}
			
			next(error);
		}
		else {
			/* Already sent the response, so just log error */
			/* Don't remove from inventory, because there is a deployment on CM that might need to be removed */
			error.message = "Error deploying deploymentId " + req.params['deploymentId'] + ": " + error.message
			log.error(error, req);
			log.audit(req, 500, error.message);
		}		

	});
});

/* Delete a running service instance */
app.delete('/:deploymentId', function(req, res, next) {
	
	/* Launch the uninstall workflow */
	deploy.launchUninstall(req.params['deploymentId'])
	
	/* Delete the service from inventory */
	.then(function(result) {
		return inventory.deleteService(req.params['deploymentId'])
		.then (function() {
			return result;
		});
	})
	
	/* Send the HTTP response indicating workflow has started */
	.then(function(result) {
		res.status(202).send(createResponse(req, result));
		log.audit(req, 202, "ExecutionId: " + result.executionId);
		return result;
	})
	
	/* Finish the delete processing--wait for the uninstall to complete, delete deployment, delete blueprint */
	.then(function(result) {
		return deploy.finishUninstall(result.deploymentId, result.executionId);
	})
	
	/* Log completion in audit log */
	.then(function(result) {
		log.audit(req, 200, "Undeployed id: " + req.params['deploymentId']);		
	})
	
	/* All errors show up here */
	.catch(function(error) {
		/* If we haven't already sent a response, give it to the error handler to send response */
		if (!res.headersSent) {	
			next(error);
		}
		else {
			/* Error happened after we sent the response--log it */
			error.message = "Error undeploying deploymentId " + req.params['deploymentId'] + ": " + error.message
			log.error(error, req);
			log.audit(req, 500, error.message);
		}
	});
});

/* Get the status of a workflow execution */
app.get('/:deploymentId/operation/:executionId', function(req, res, next){
	deploy.getExecutionStatus(req.params['executionId'])
	
	/* Send success response */
	.then(function(result) {
		result.requestId = req.dcaeReqId;
		result.links = createLinks(req, req.params['deploymentId'], req.params['executionId']);
		res.status(200).json(result);
		log.audit(req, 200,  "Workflow type: " + result.operationType + " -- execution status: " + result.status);
	})
	
	.catch(next);		/* Let the error handler send the response and log the error */
	
});

module.exports = app;