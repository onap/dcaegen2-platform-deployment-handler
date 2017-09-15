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

/**
 * handling policy updates
 */

"use strict";

const POLICY_UPDATE_OPERATION = "dcae.interfaces.policy.policy_update";

const config = process.mainModule.exports.config;
const createError = require('./dispatcher-error').createDispatcherError;
const logger = require('./logging').getLogger();

var cloudify = require("./cloudify.js");

// Set config for cloudify interface library
cloudify.setAPIAddress(config.cloudify.url);
cloudify.setCredentials(config.cloudify.user, config.cloudify.password);
cloudify.setLogger(logger);

/**
 * receive the policy-updated message from the policy-handler
 */
function policyUpdate(req, res, next) {
    var latest_policies = JSON.stringify((req.body && req.body.latest_policies) || {});
    logger.debug(req.dcaeReqId, "policyUpdate " + req.originalUrl + " " + latest_policies);
    /**
     * reply to and free up the policy_handler
     */
    res.json({});

    latest_policies = JSON.parse(latest_policies);
    /**
     * filter out the policies to what is deployed in components and needs updating (new policyVersion)
     */
    var policy_deployments = {};
    var policy_ids = {};

    cloudify.getNodeInstances(req, function(node_instances) {
        node_instances.forEach(node_instance => {
            if (!node_instance.runtime_properties || !node_instance.runtime_properties.policies) {
                return;
            }
            var deployment = policy_deployments[node_instance.deployment_id] || {
                "deployment_id": node_instance.deployment_id, "policies": {}, "component_ids": []
            };

            logger.debug(req.dcaeReqId, "have policy on node_instance: " + JSON.stringify(node_instance));
            var have_policies = false;
            Object.keys(node_instance.runtime_properties.policies).forEach(policy_id => {
                var deployed_policy = node_instance.runtime_properties.policies[policy_id];
                var latest_policy = latest_policies[policy_id];
                if (!latest_policy || !latest_policy.policy_body
                    || isNaN(latest_policy.policy_body.policyVersion)
                    || latest_policy.policy_body.policyVersion
                    === (deployed_policy.policy_body && deployed_policy.policy_body.policyVersion)) {
                    return;
                }
                have_policies = true;
                deployment.policies[policy_id] = latest_policy;
                policy_ids[policy_id] = true;
            });
            if (have_policies) {
                deployment.component_ids.push(node_instance.id);
                policy_deployments[deployment.deployment_id] = deployment;
            }
        });

        logger.debug(req.dcaeReqId, "collected policy_deployments to update " + JSON.stringify(policy_deployments));
    })
    .then(function(result) {
        logger.debug(req.dcaeReqId, "finished loading policy_deployments" + JSON.stringify(result));
        if (result.status !== 200) {
            const error_msg = "failed to retrieve component policies from cloudify " + result.message;
            logger.error(createError(error_msg, result.status, "api", 502, 'cloudify-manager'), req);
            logger.audit(req, result.status, error_msg);
            return;
        }

        var deployment_ids = Object.keys(policy_deployments);
        var policy_id_count = Object.keys(policy_ids).length;
        if (!deployment_ids.length) {
            const msg = "no updated policies to apply to deployments";
            logger.debug(req.dcaeReqId, msg);
            logger.audit(req, result.status, msg);
            return;
        }
        const msg = "going to apply updated policies[" + policy_id_count + "] to deployments " + deployment_ids.length;
        logger.debug(req.dcaeReqId, msg + ": " + JSON.stringify(deployment_ids));
        logger.audit(req, result.status, msg);
        deployment_ids.forEach(deployment_id => {
            var deployment = policy_deployments[deployment_id];
            deployment.policies = Object.keys(deployment.policies).map(policy_id => {
                return deployment.policies[policy_id];
            });

            logger.debug(req.dcaeReqId, "ready to execute-operation policy-update on deployment " + JSON.stringify(deployment));
            cloudify.executeOperation(req, deployment.deployment_id, POLICY_UPDATE_OPERATION,
                {'updated_policies': deployment.policies}, deployment.component_ids);
        });
    });
}

/**
 * retrieve all component-policies from cloudify
 */
function getComponentPoliciesFromCloudify(req, res, next) {
    logger.debug(req.dcaeReqId, "getComponentPoliciesFromCloudify " + req.originalUrl);
    var response = {"requestId": req.dcaeReqId};
    response.started = new Date();
    response.component_policies = [];
    response.component_ids = [];
    response.node_instances = [];

    cloudify.getNodeInstances(req, function(node_instances) {
        Array.prototype.push.apply(response.node_instances, node_instances);
        node_instances.forEach(node_instance => {
            if (!node_instance.runtime_properties || !node_instance.runtime_properties.policies) {
                return;
            }

            var policies_count = 0;
            Object.keys(node_instance.runtime_properties.policies).forEach(policy_id => {
                ++policies_count;
                var policy = node_instance.runtime_properties.policies[policy_id];
                policy.component_id = node_instance.id;
                policy.deployment_id = node_instance.deployment_id;
                response.component_policies.push(policy);
            });
            if (policies_count) {
                response.component_ids.push({
                    "component_id" : node_instance.id,
                    "policies_count" : policies_count
                });
            }
        });

        logger.debug(req.dcaeReqId, "collected " + response.component_ids.length
                    + " component_ids: " + JSON.stringify(response.component_ids)
                    + " component_policies: " + JSON.stringify(response.component_policies));
    })
    .then(function(result) {
        response.ended = new Date();
        response.status = result.status;
        response.message = result.message;
        logger.debug(req.dcaeReqId, result.message);
        if (result.status !== 200) {
            logger.error(createError(result.message, result.status, "api", 502, 'cloudify-manager'), req);
        }
        res.status(result.status).json(response);
        logger.audit(req, result.status, result.message);
    });
}

// ========================================================

const app = require('express')();
app.set('x-powered-by', false);
app.set('etag', false);
app.use(require('./middleware').checkType('application/json'));
app.use(require('body-parser').json({strict: true}));

app.post('/', policyUpdate);
app.get('/components', getComponentPoliciesFromCloudify);

module.exports = app;
