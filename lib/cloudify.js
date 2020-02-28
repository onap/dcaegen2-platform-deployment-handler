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

/* Low-level routines for using the Cloudify Manager REST API */

"use strict";

const CLOUDIFY = "cloudify-manager";
const FINISHED = [ "terminated", "cancelled", "canceled", "failed" ];
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
exports.getExecutionStatus = function(req, execution_id) {
    const reqOptions = {
        method : "GET",
        uri : cfyAPI + "/executions/" + execution_id
    };

    addAuthToOptions(reqOptions, req);

    return doRequest(req, reqOptions, null, CLOUDIFY);
};

// Get current status of a deployment creation
const getDeploymentCreationStatus = function(req, deployment_id) {
    const reqOptions = {
        method : "GET",
        uri : cfyAPI + "/executions?deployment_id=" + deployment_id + "&workflow_id=create_deployment_environment&_include=id,status"
    };
    addAuthToOptions(reqOptions, req);

    return doRequest(req, reqOptions, null, CLOUDIFY);
};

// Poll for the result of a workflow execution until it's done
// Return a promise for the final result of a workflow execution
exports.waitForWorkflowExecution = function(mainReq, execution_id) {
	/* Defense: Some callers do not supply mainReq */
	mainReq = mainReq || {};
    const log_title = "execution_id(" + execution_id + "): workflow execution";
    logger.info(mainReq.dcaeReqId, log_title + ": waiting for completion");

    const getStatus = function(res) {return res && res.json && res.json.status;};

    return repeat.repeatWhile(function() {return exports.getExecutionStatus(mainReq, execution_id);},
                              function(res) {return checkExecutionRunning(mainReq, res, log_title, getStatus);},
                              MAX_TRIES, RETRY_INTERVAL)
        .then(function (res) {return onFinishedExecution(mainReq, res, log_title, getStatus);},
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
    const reqOptions = {
        method : "POST",
        uri : cfyAPI + "/executions",
        headers : {
            "Content-Type" : "application/json",
            "Accept" : "*/*"
        }
    };

    addAuthToOptions(reqOptions, mainReq);

    const body = {
        "deployment_id" : deployment_id,
        "workflow_id" : workflow_id
    };

    if ( workflow_id === 'uninstall' ) {
        body.force = (mainReq.query.force_uninstall === 'true') || false;
        parameters = {"ignore_failure":"true"}
    }

    if (parameters) {body.parameters = parameters;}

    // Make the POST request
    return doRequest(mainReq, reqOptions, JSON.stringify(body), CLOUDIFY);
};

//Initiate a workflow execution against a deployment
exports.initiateWorkflowExecution = function(req, deployment_id, workflow_id, parameters) {
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

// Function for testing if workflow execution or deployment creation has finished or still running
// Expects the result of getExecStatus
const checkExecutionRunning = function(mainReq, res, log_title, getStatus) {
    const still_running = !FINISHED.includes(getStatus(res));
    logger.info(mainReq.dcaeReqId, log_title + ": checking status: " + JSON.stringify(res) + " ==> " + still_running);
    return still_running;
};

const onFinishedExecution = function(mainReq, res, log_title, getStatus) {
    logger.info(mainReq.dcaeReqId, log_title + " result: " + JSON.stringify(res));
    const status = getStatus(res);
    /* Successful completion */
    if (status === 'terminated') {
        logger.info(mainReq.dcaeReqId, log_title + ' completed');
        return res;
    }
    /* If we get here, we don't have a success and we're going to throw something */
    const error = { "body": log_title + " " + status };
    /* We expect a JSON object with a status */
    if (status) {
        /* Failure -- we need to return something that looks like the CM API failures */
        if (status === 'failed') {
            error.body += ' -- ' + (res.json.error ? JSON.stringify(res.json.error) : 'no error information');
        }
        /* Cancellation -- don't really expect this */
        else if (status === 'canceled' || status === 'cancelled') { }
        /* Don't expect anything else -- but if we get it, it's not a success! */
        else {
            error.body += ' -- unexpected status';
        }
    }
    /* The body of the response from the API call to get execution status is not what we expect at all */
    else {
        error.body += ' -- unexpected result body from Cloudify Manager';
    }
    throw error;
};

// Poll for the deployment creation status
const waitForDeploymentCreation = function(mainReq, deployment_id) {
    /* Defense: Some callers do not supply mainReq */
    mainReq = mainReq || {};
    const log_title = "deployment_id(" + deployment_id + "): deployment creation";
    logger.info(mainReq.dcaeReqId, log_title + ": waiting for completion");

    const getStatus = function(res) {
        return res && res.json && Array.isArray(res.json.items)
            && res.json.items.length == 1 && res.json.items[0].status;
    };

    return repeat.repeatWhile(function() {return getDeploymentCreationStatus(mainReq, deployment_id);},
                              function(res) {return checkExecutionRunning(mainReq, res, log_title, getStatus);},
                              DEP_CREATION_STATUS_MAX_TRIES, DEP_CREATION_STATUS_RETRY_INTERVAL)
        .then(function (res) {return onFinishedExecution(mainReq, res, log_title, getStatus);},
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
    zip.addFile('work/blueprint.yaml', Buffer.from(blueprint, 'utf8'));
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
    const reqOptions = {
        method : "PUT",
        uri : cfyAPI + "/deployments/" + dpid,
        headers : {
            "Content-Type" : "application/json",
            "Accept" : "*/*"
        }
    };
    addAuthToOptions(reqOptions, req);

    const body = {
        blueprint_id : bpid
    };
    if (inputs) {
        body.inputs = inputs;
    }

    // Make the PUT request to create the deployment
    return doRequest(req, reqOptions, JSON.stringify(body), CLOUDIFY);
};

// Executes a workflow against a deployment and returns a promise for final result
exports.executeWorkflow = function(req, deployment_id, workflow_id, parameters) {
    return exports.initiateWorkflowExecution(req, deployment_id, workflow_id, parameters)

    // Wait for the result
    .then (function(result) {
        logger.info(req.dcaeReqId, "Result from initiating workflow: " + JSON.stringify(result));
        return exports.waitForWorkflowExecution(req, result.executionId);
    });
};

// Return a promise for the final result of a deployment update
exports.waitForDeploymentCreation = waitForDeploymentCreation;

// Retrieves outputs for a deployment
exports.getOutputs = function(req, dpid) {
    const reqOptions = {
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
    const reqOptions = {
        method : "GET",
        uri : cfyAPI + "/deployments/" + dpid + "?include=outputs",
        headers : {
            "Accept" : "*/*"
        }
    };

    addAuthToOptions(reqOptions, req);

    return doRequest(req, reqOptions, null, CLOUDIFY);
};

exports.getCfyStatus = function(req) {
    const reqOptions = {
        method : "GET",
        uri : cfyAPI + "/status"
    };
    addAuthToOptions(reqOptions, req);

    return doRequest(req, reqOptions, null, CLOUDIFY);
};

// Deletes a deployment
exports.deleteDeployment = function(req, dpid) {
    const reqOptions = {
        method : "DELETE",
        uri : cfyAPI + "/deployments/" + dpid
    };

    addAuthToOptions(reqOptions, req);

    return doRequest(req, reqOptions, null, CLOUDIFY);
};

// Deletes a blueprint
exports.deleteBlueprint = function(req, bpid) {
    const reqOptions = {
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
    const reqOptions = {
        method : "GET",
        uri : cfyAPI + "/node-instances?_include=id,deployment_id,runtime_properties&_sort=id&_size=1000&_offset=" + offset
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
        return exports.waitForWorkflowExecution(mainReq, execution_id);
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

