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

/* Low-level routines for using the Cloudify Manager REST API */

"use strict";

const CLOUDIFY = "cloudify-manager";
const FINISHED = [ "terminated", "cancelled", "failed" ];
const DEPLOYMENT_CREATION_FINISHED = [ "terminated" ];
const RETRY_INTERVAL = 5000;   // Every 5 seconds
const MAX_TRIES = 720;        // Up to 1 hour
const DEP_CREATION_STATUS_RETRY_INTERVAL = 30000;   // Every 30 seconds
const DEP_CREATION_STATUS_MAX_TRIES = 10;        // Up to 5 minutes
const DEFAULT_TENANT = "default_tenant";
const doRequest = require('./promise_request').doRequest;
const repeat = require('./repeat');
const admzip = require('adm-zip');
const createError = require('./dispatcher-error').createDispatcherError;

var cfyAPI = null;
var cfyAuth = null;
var logger = null;

// class to queue up the execute operations on deployments
var ExeQueue = function ExeQueue(){
    this.deployments = {};
};
ExeQueue.prototype.isDeploymentBusy = function(deployment_id) {return !!this.deployments[deployment_id];};
ExeQueue.prototype.removeDeployment = function(deployment_id) {
    if (!!this.deployments[deployment_id]) {
        delete this.deployments[deployment_id];
    }
};
ExeQueue.prototype.queueUpExecution = function(mainReq, deployment_id, workflow_id, parameters) {
    this.deployments[deployment_id] = this.deployments[deployment_id] || {"deployment_id":deployment_id, "exe_queue": []};
    this.deployments[deployment_id].exe_queue.push({"mainReq": mainReq, "workflow_id": workflow_id, "parameters": parameters});
};
ExeQueue.prototype.setExecutionId = function(deployment_id, execution_id) {
    var depl = this.deployments[deployment_id];
    if (!depl) {return;}
    depl.execution_id = execution_id;
};
ExeQueue.prototype.nextExecution = function(deployment_id) {
    var depl = this.deployments[deployment_id];
    if (!depl) {return;}
    if (depl.execution_id) {
        delete depl.execution_id;
        depl.exe_queue.shift();
        if (!depl.exe_queue.length) {
            delete this.deployments[deployment_id];
            return;
        }
    }
    return depl.exe_queue[0];
};
const exeQueue = new ExeQueue();
exports.exeQueue = exeQueue;

// Get current status of a workflow execution
const getExecutionStatus = function(req, execution_id) {
    var reqOptions = {
        method : "GET",
        uri : cfyAPI + "/executions/" + execution_id
    };

    addAuthToOptions(reqOptions, req);

    return doRequest(req, reqOptions, null, CLOUDIFY);
};

// Get current status of a deployment creation
const getDeploymentCreationStatus = function(req, deployment_id) {
    var reqOptions = {
        method : "GET",
        uri : cfyAPI + "/executions?deployment_id=" + deployment_id + "&workflow_id=create_deployment_environment&_include=id,status"
    };
    addAuthToOptions(reqOptions);
    
    return doRequest(req, reqOptions, null, CLOUDIFY);
};

// Poll for the result of a workflow execution until it's done
const getWorkflowResult = function(mainReq, execution_id) {
	/* Defense: Some callers do not supply mainReq */
	mainReq = mainReq || {};
    logger.info(mainReq.dcaeReqId, "Getting workflow result for execution id: " + execution_id);

    // Function for testing if workflow is finished
    // Expects the result of getExecStatus
    var checkStatus = function(res) {
        logger.info(mainReq.dcaeReqId, "Checking result: " + JSON.stringify(res) + " ==> " + (res.json && res.json.status && FINISHED.indexOf(res.json.status) < 0));
        return res.json && res.json.status && FINISHED.indexOf(res.json.status) < 0;
    };

    // Create execution status checker function
    var getExecStatus = function() {return getExecutionStatus(mainReq, execution_id);};

    return repeat.repeatWhile(getExecStatus, checkStatus, MAX_TRIES, RETRY_INTERVAL)
    .then(

    /* Handle fulfilled promise from repeatWhile */
    function(res) {

        logger.info(mainReq.dcaeReqId, 'workflow result: ' + JSON.stringify(res));

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

// bare start of a workflow execution against a deployment
const startWorkflowExecution = function(mainReq, deployment_id, workflow_id, parameters) {
	/* Defense: Some callers do not supply mainReq */
	mainReq = mainReq || {};
    // Set up the HTTP POST request
    var reqOptions = {
        method : "POST",
        uri : cfyAPI + "/executions",
        headers : {
            "Content-Type" : "application/json",
            "Accept" : "*/*"
        }
    };

    addAuthToOptions(reqOptions, mainReq);

    var body = {
        "deployment_id" : deployment_id,
        "workflow_id" : workflow_id
    };
    if (parameters) {body.parameters = parameters;}

    // Make the POST request
    return doRequest(mainReq, reqOptions, JSON.stringify(body), CLOUDIFY);
};

//Initiate a workflow execution against a deployment
const initiateWorkflowExecution = function(req, deployment_id, workflow_id, parameters) {
    return startWorkflowExecution(req, deployment_id, workflow_id, parameters)
    .then(function(result) {
        logger.info(req.dcaeReqId, "Result from POSTing workflow execution start: "	+ JSON.stringify(result));
        if (result.json && result.json.id) {
            return {deploymentId: deployment_id, workflowType: workflow_id, executionId: result.json.id};
        }
        logger.info(req.dcaeReqId,"Did not get expected JSON body from POST to start workflow");
        var err = new Error("POST to start workflow got success response but no body");
        err.status = err.code = 502;
        throw err;
    });
};

// Poll for the deployment creation status
const getDeploymentCreationResult = function(mainReq, deployment_id) {
    /* Defense: Some callers do not supply mainReq */
    mainReq = mainReq || {};
    logger.info(mainReq.dcaeReqId, "Getting status for deployment id: " + deployment_id);

    // Function for testing if deployment creation is complete
    // Expects the result of getDepCrStatus
    var checkDepStatus = function(cloudify_response) {
        cloudify_response = cloudify_response && cloudify_response.json;
        logger.info(mainReq.dcaeReqId, "Checking Deployment creation result: " + JSON.stringify(cloudify_response) + " ==> " +
            (cloudify_response.items.length == 1 && DEPLOYMENT_CREATION_FINISHED.indexOf(cloudify_response.items[0].status) < 0));
        return cloudify_response.items.length == 1 && DEPLOYMENT_CREATION_FINISHED.indexOf(cloudify_response.items[0].status) < 0;
    };

    // Create deployment creation status checker function
    var getDepCrStatus = function() {return getDeploymentCreationStatus(mainReq, deployment_id);};

    return repeat.repeatWhile(getDepCrStatus, checkDepStatus, DEP_CREATION_STATUS_MAX_TRIES, DEP_CREATION_STATUS_RETRY_INTERVAL)
        .then(

            /* Handle fulfilled promise from repeatWhile */
            function(res) {

                logger.info(mainReq.dcaeReqId, 'Deployment creation result: ' + JSON.stringify(res));

                /* Successful completion */
                if (res.json && res.json.items.length == 1 && res.json.items[0].status === 'terminated') {
                    logger.info(mainReq.dcaeReqId, 'Deployment creation completed for deployment_id: ' + deployment_id);
                    return res;
                }

                /* If we get here, we don't have a success and we're going to throw something */

                var error = {};

                /* We expect a JSON object with a status */
                if (res.json && res.json.items.length == 1 && res.json.items[0].status) {

                    /* Failure -- we need to return something that looks like the CM API failures */
                    if (res.json.items[0].status === 'failed') {
                        error.body = 'Deployment creation failed: ' + deployment_id + ' -- ' + (res.json.error ? JSON.stringify(res.json.error) : 'no error information');
                    }

                    /* Cancellation -- don't really expect this */
                    else if (res.json.items[0].status === 'canceled' || res.json.status === 'cancelled') {
                        error.body = 'Deployment creation canceled: ' + deployment_id;
                    }

                    /* Don't expect anything else -- but if we get it, it's not a success! */
                    else {
                        error.body = 'Deployment creation--unexpected status ' + res.json.items[0].status + ' for ' + deployment_id;
                    }
                }

                /* The body of the response from the API call to get execution status is not what we expect at all */
                else {
                    error.body = 'Deployment creation--unexpected result body getting execution status from CM for ' + deployment_id;
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

// Uploads a blueprint via the Cloudify API
exports.uploadBlueprint = function(req, bpid, blueprint) {
    logger.info(req.dcaeReqId, "uploadBlueprint " + bpid);

    // Cloudify API wants a gzipped tar of a directory, not the blueprint text
    const zip = new admzip();
    zip.addFile('work/', new Buffer(0));
    zip.addFile('work/blueprint.yaml', new Buffer(blueprint, 'utf8'));
    const zip_buffer = zip.toBuffer();

    // Set up the HTTP PUT request
    const reqOptions = {
        method : "PUT",
        uri : cfyAPI + "/blueprints/" + bpid,
        headers : {
            "Content-Type" : "application/octet-stream",
            "Accept" : "*/*"
        }
    };
    addAuthToOptions(reqOptions, req);

    // Initiate PUT request and return the promise for a result
    return doRequest(req, reqOptions, zip_buffer, CLOUDIFY);
};

// Creates a deployment from a blueprint
exports.createDeployment = function(req, dpid, bpid, inputs) {

    // Set up the HTTP PUT request
    var reqOptions = {
        method : "PUT",
        uri : cfyAPI + "/deployments/" + dpid,
        headers : {
            "Content-Type" : "application/json",
            "Accept" : "*/*"
        }
    };
    addAuthToOptions(reqOptions, req);

    var body = {
        blueprint_id : bpid
    };
    if (inputs) {
        body.inputs = inputs;
    }

    // Make the PUT request to create the deployment
    return doRequest(req, reqOptions, JSON.stringify(body), CLOUDIFY);
};

// Initiate a workflow execution against a deployment
exports.initiateWorkflowExecution = initiateWorkflowExecution;

// Get the status of a workflow execution
exports.getWorkflowExecutionStatus = getExecutionStatus;

// Return a promise for the final result of a workflow execution
exports.getWorkflowResult = getWorkflowResult;

// Executes a workflow against a deployment and returns a promise for final result
exports.executeWorkflow = function(req, deployment_id, workflow_id, parameters) {
    return initiateWorkflowExecution(req, deployment_id, workflow_id, parameters)

    // Wait for the result
    .then (function(result) {
        logger.info(req.dcaeReqId, "Result from initiating workflow: " + JSON.stringify(result));
        return getWorkflowResult(req, result.executionId);
    });
};

// Return a promise for the final result of a deployment creation
exports.getDeploymentCreationResult = getDeploymentCreationResult;

// Get the status of a deployment creation
exports.getDeploymentCreationStatus = getDeploymentCreationStatus;

// Retrieves outputs for a deployment
exports.getOutputs = function(req, dpid) {
    var reqOptions = {
        method : "GET",
        uri : cfyAPI + "/deployments/" + dpid + "/outputs",
        headers : {
            "Accept" : "*/*"
        }
    };

    addAuthToOptions(reqOptions, req);

    return doRequest(req, reqOptions, null, CLOUDIFY);
};

// Get the output descriptions for a deployment
exports.getOutputDescriptions = function(req, dpid) {
    var reqOptions = {
        method : "GET",
        uri : cfyAPI + "/deployments/" + dpid + "?include=outputs",
        headers : {
            "Accept" : "*/*"
        }
    };

    addAuthToOptions(reqOptions, req);

    return doRequest(req, reqOptions, null, CLOUDIFY);
};

// Deletes a deployment
exports.deleteDeployment = function(req, dpid) {
    var reqOptions = {
        method : "DELETE",
        uri : cfyAPI + "/deployments/" + dpid
    };

    addAuthToOptions(reqOptions, req);

    return doRequest(req, reqOptions, null, CLOUDIFY);
};

// Deletes a blueprint
exports.deleteBlueprint = function(req, bpid) {
    var reqOptions = {
        method : "DELETE",
        uri : cfyAPI + "/blueprints/" + bpid
    };

    addAuthToOptions(reqOptions, req);

    return doRequest(req, reqOptions, null, CLOUDIFY);
};

// Allow client to set the Cloudify API root address
exports.setAPIAddress = function(addr) {
    cfyAPI = cfyAPI || addr;
};

// Allow client to set Cloudify credentials
exports.setCredentials = function(user, password) {
    cfyAuth = cfyAuth || (user + ':' + password);
};

function addAuthToOptions(reqOptions, req) {

    if (!!cfyAuth && cfyAuth !== "undefined:undefined") {
        reqOptions.auth = cfyAuth;
    }
    reqOptions.headers = reqOptions.headers || {};
    reqOptions.headers.Tenant = req.query.cfy_tenant_name || DEFAULT_TENANT;

    logger.debug(req.dcaeReqId, "Calling " + reqOptions.uri + " with Tenant: " + reqOptions.headers.Tenant );

}

// Set a logger
exports.setLogger = function(log) {
    logger = logger || log;
};

exports.getNodeInstances = function (mainReq, on_next_node_instances, offset) {
    offset = offset || 0;
    var reqOptions = {
        method : "GET",
        uri : cfyAPI + "/node-instances?_include=id,deployment_id,runtime_properties&_offset=" + offset
    };

    addAuthToOptions(reqOptions, mainReq);

    logger.info(mainReq.dcaeReqId, "getNodeInstances: " + JSON.stringify(reqOptions));
    return doRequest(mainReq, reqOptions, null, CLOUDIFY)
        .then(function(cloudify_response) {
            logger.info(mainReq.dcaeReqId, "getNodeInstances response: " + JSON.stringify(cloudify_response));
            var response = {};
            cloudify_response = cloudify_response && cloudify_response.json;
            if (!cloudify_response || !Array.isArray(cloudify_response.items)) {
                response.status = 500;
                response.message = 'unexpected response from cloudify ' + JSON.stringify(cloudify_response);
                return response;
            }
            if (!cloudify_response.items.length) {
                response.status = 200;
                response.message = 'got no more node_instances';
                return response;
            }
            logger.info(mainReq.dcaeReqId, 'getNodeInstances got node_instances ' + cloudify_response.items.length);
            if (typeof on_next_node_instances === 'function') {
                on_next_node_instances(cloudify_response.items);
            }
            if (!cloudify_response.metadata || !cloudify_response.metadata.pagination) {
                response.status = 500;
                response.message = 'unexpected response from cloudify ' + JSON.stringify(cloudify_response);
                return response;
            }
            offset += cloudify_response.items.length;
            if (offset >= cloudify_response.metadata.pagination.total) {
                response.status = 200;
                response.message = 'got all node_instances ' + offset + "/" + cloudify_response.metadata.pagination.total;
                return response;
            }
            return exports.getNodeInstances(mainReq, on_next_node_instances, offset);
        })
        .catch(function(error) {
            return {
                "status" : error.status || 500,
                "message": "getNodeInstances cloudify error: " + JSON.stringify(error)
            };
        });
};

const runQueuedExecution = function(mainReq, deployment_id, workflow_id, parameters, waitedCount) {
    mainReq = mainReq || {};
    var execution_id;
    const exe_deployment_str = " deployment_id " + deployment_id + " to " + workflow_id
                             + " with params(" + JSON.stringify(parameters || {}) + ")";
    startWorkflowExecution(mainReq, deployment_id, workflow_id, parameters)
    .then(function(result) {
        logger.info(mainReq.dcaeReqId, "result of start the execution for" + exe_deployment_str + ": " + JSON.stringify(result));
        execution_id = result.json && result.json.id;
        if (!execution_id) {
            throw createError("failed to start execution - no execution_id for" + exe_deployment_str,
                553, "api", 553, CLOUDIFY);
        }
        exeQueue.setExecutionId(deployment_id, execution_id);
        return getWorkflowResult(mainReq, execution_id);
    })
    .then(function(result) {
        logger.info(mainReq.dcaeReqId, 'successfully finished execution: ' + execution_id + " for" + exe_deployment_str);
        var nextExecution = exeQueue.nextExecution(deployment_id);
        if (nextExecution) {
            logger.info(nextExecution.mainReq.dcaeReqId, "next execution for deployment_id " + deployment_id
                + " to " + nextExecution.workflow_id
                + " with params(" + JSON.stringify(nextExecution.parameters || {}) + ")");
            runQueuedExecution(nextExecution.mainReq, deployment_id, nextExecution.workflow_id, nextExecution.parameters);
        }
    })
    .catch(function(result) {
        if (result.status === 400 && result.json && result.json.error_code === "existing_running_execution_error") {
            waitedCount = waitedCount || 0;
            if (waitedCount >= MAX_TRIES) {
                logger.error(createError("gave up on waiting for" + exe_deployment_str, 553, "api", 553, CLOUDIFY), mainReq);
                exeQueue.removeDeployment(deployment_id);
                return;
            }
            ++waitedCount;
            logger.warn(createError("runQueuedExecution sleeping " + waitedCount
                       + " on " + exe_deployment_str, 553, "api", 553, CLOUDIFY), mainReq);
            setTimeout(function() {runQueuedExecution(mainReq, deployment_id, workflow_id, parameters, waitedCount);}, RETRY_INTERVAL);
            return;
        }
        exeQueue.removeDeployment(deployment_id);
        if (result.status === 404 && result.json && result.json.error_code === "not_found_error") {
            logger.error(createError("deployment not found for" + exe_deployment_str
                + " cloudify response: " + JSON.stringify(result), 553, "api", 553, CLOUDIFY), mainReq);
            return;
        }
        if (result instanceof Error) {
            logger.error(result, mainReq);
            return;
        }
        logger.error(createError("execute operation error " + (result.message || result.body || JSON.stringify(result))
            + " on " + exe_deployment_str, 553, "api", 553, CLOUDIFY), mainReq);
    });
};

exports.executeOperation = function (mainReq, deployment_id, operation, operation_kwargs, node_instance_ids) {
    const workflow_id = "execute_operation";
    const parameters = {
        'operation': operation,
        'operation_kwargs': operation_kwargs,
        'node_instance_ids': node_instance_ids,
        'allow_kwargs_override': true
    };

    if (exeQueue.isDeploymentBusy(deployment_id)) {
        exeQueue.queueUpExecution(mainReq, deployment_id, workflow_id, parameters);
        logger.info(mainReq.dcaeReqId, "deployment busy - queue up execution for deployment_id " + deployment_id
                    + " to " + workflow_id + " with params(" + JSON.stringify(parameters || {}) + ")");
        return;
    }
    exeQueue.queueUpExecution(mainReq, deployment_id, workflow_id, parameters);
    runQueuedExecution(mainReq, deployment_id, workflow_id, parameters);
};
