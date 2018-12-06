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

/**
 * handling policy updates
 */

"use strict";

const POLICY_UPDATE_OPERATION = "dcae.interfaces.policy.policy_update";

const config = process.mainModule.exports.config;
const createError = require('./dispatcher-error').createDispatcherError;
const logger = require('./logging').getLogger();

const cloudify = require("./cloudify.js");

// Set config for cloudify interface library
cloudify.setAPIAddress(config.cloudify.url);
cloudify.setCredentials(config.cloudify.user, config.cloudify.password);
cloudify.setLogger(logger);

/**
 * send the policy-update execute-operation to cloudify per deployment
 */
const update_policies_on_deployments = function(result, req, policy_update) {
    logger.info(req.dcaeReqId, "finished loading policy_deployments" + JSON.stringify(result));
    if (result.status !== 200) {
        const error_msg = "failed to retrieve component policies from cloudify " + result.message;
        logger.error(createError(error_msg, result.status, "api", 502, 'cloudify-manager'), req);
        logger.audit(req, result.status, error_msg);
        return;
    }

    const deployment_ids = Object.keys(policy_update.policy_deployments);
    if (!deployment_ids.length) {
        const audit_msg = "no updated policies to apply to deployments";
        logger.debug(req.dcaeReqId, audit_msg);
        logger.audit(req, result.status, audit_msg);
        return;
    }
    const audit_msg = "going to apply updated policies[" + Object.keys(policy_update.updated_policy_ids).length
                    + "] and added policies[" + Object.keys(policy_update.added_policy_ids).length
                    + "] and removed policies[" + Object.keys(policy_update.removed_policy_ids).length
                    + "] to deployments[" + deployment_ids.length + "]";
    logger.info(req.dcaeReqId, audit_msg + ": " + JSON.stringify(deployment_ids));
    logger.audit(req, result.status, audit_msg);
    deployment_ids.forEach(deployment_id => {
        const deployment = policy_update.policy_deployments[deployment_id];
        deployment.updated_policies = Object.keys(deployment.updated_policies).map(policy_id => {
            return deployment.updated_policies[policy_id];
        });
        deployment.removed_policy_ids = Object.keys(deployment.removed_policy_ids);

        logger.info(req.dcaeReqId, "ready to execute-operation policy-update on deployment " + JSON.stringify(deployment));
        cloudify.executeOperation(req, deployment.deployment_id, POLICY_UPDATE_OPERATION,
            {
                'updated_policies': deployment.updated_policies,
                'added_policies': deployment.added_policies,
                'removed_policies': deployment.removed_policy_ids
            },
            deployment.node_instance_ids
        );
    });
};


/**
 * receive the policy-updated message from the policy-handler and send to cloudify
 *   - redesigned data-flow 2018 - R3 Casablanca
 */
function update_policies(req, res) {
    const policy_update = {
        latest_policies : JSON.stringify((req.body && req.body.latest_policies) || {}),
        removed_policies : JSON.stringify((req.body && req.body.removed_policies) || {}),
        policy_filter_matches : JSON.stringify((req.body && req.body.policy_filter_matches) || {}),
        policy_matches_by_filter : {},
        policy_deployments : {},
        updated_policy_ids : {},
        added_policy_ids : {},
        removed_policy_ids : {}
    };

    logger.info(req.dcaeReqId, "update_policies "
               + req.method + ' ' + req.protocol + '://' + req.get('host') + req.originalUrl
               + " latest_policies: " + policy_update.latest_policies
               + " removed_policies: " + policy_update.removed_policies
               + " policy_filter_matches: " + policy_update.policy_filter_matches
               );
    /**
     * reply to and free up the policy_handler
     */
    const response = {"requestID": req.dcaeReqId};
    response.started = new Date();
    response.server_instance_uuid = process.mainModule.exports.config.server_instance_uuid;
    res.json(response);

    policy_update.latest_policies = JSON.parse(policy_update.latest_policies);
    policy_update.removed_policies = JSON.parse(policy_update.removed_policies);
    policy_update.policy_filter_matches = JSON.parse(policy_update.policy_filter_matches);

    Object.keys(policy_update.policy_filter_matches).forEach(policy_id => {
        Object.keys(policy_update.policy_filter_matches[policy_id]).forEach(policy_filter_id => {
            var policy_ids_by_filter = policy_update.policy_matches_by_filter[policy_filter_id];
            if (!policy_ids_by_filter) {
                policy_ids_by_filter = policy_update.policy_matches_by_filter[policy_filter_id] = {};
            }
            policy_ids_by_filter[policy_id] = true;
        });
    });

    const is_policy_update_in_filters = function(policy_id, policy_filters) {
        if (!policy_id || !policy_filters) {return null;}

        const policy_update_filters = policy_update.policy_filter_matches[policy_id];
        if (!policy_update_filters) {return null;}

        return Object.keys(policy_update_filters).some(policy_filter_id =>
            !!policy_filters[policy_filter_id]);
    };

    /**
     * filter out the policies to what is deployed in components and needs updating (new policyVersion)
     */
    const collect_policy_deployments = function collect_policy_deployments(node_instances) {
        node_instances.forEach(node_instance => {
            if (!node_instance.runtime_properties
            || (!node_instance.runtime_properties.policies
                && !node_instance.runtime_properties.policy_filters)) {
                return;
            }
            logger.info(req.dcaeReqId, "checking policies on node_instance: " + JSON.stringify(node_instance));

            const deployment = policy_update.policy_deployments[node_instance.deployment_id] || {
                "deployment_id": node_instance.deployment_id,
                "updated_policies": {},
                "added_policies": {},
                "removed_policy_ids": {},
                "node_instance_ids": [],
                "is_deployment_busy": cloudify.exeQueue.isDeploymentBusy(node_instance.deployment_id)
            };

            var have_policies = false;
            const deployed_policies = node_instance.runtime_properties.policies || {};
            const deployed_policy_filters = node_instance.runtime_properties.policy_filters;

            Object.keys(deployed_policies).forEach(policy_id => {
                const deployed_policy = deployed_policies[policy_id];
                if ((deployed_policy.policy_body || deployment.is_deployment_busy)
                && (policy_update.removed_policies[policy_id]
                    || (!deployed_policy.policy_persistent
                      && false === is_policy_update_in_filters(policy_id, deployed_policy_filters)))) {
                    have_policies = true;
                    deployment.removed_policy_ids[policy_id] = true;
                    policy_update.removed_policy_ids[policy_id] = true;
                    logger.info(req.dcaeReqId, "going to remove policy " + policy_id + " from node_instance: " + JSON.stringify(node_instance));
                    return;
                }

                const latest_policy = policy_update.latest_policies[policy_id];
                if (!latest_policy || !latest_policy.policy_body
                || isNaN(latest_policy.policy_body.policyVersion)) {return;}

                if (!deployment.is_deployment_busy && latest_policy.policy_body.policyVersion
                === (deployed_policy.policy_body && deployed_policy.policy_body.policyVersion)) {return;}

                have_policies = true;
                deployment.updated_policies[policy_id] = latest_policy;
                policy_update.updated_policy_ids[policy_id] = true;
                logger.info(req.dcaeReqId, "going to update policy " + policy_id + " on node_instance: " + JSON.stringify(node_instance));
            });

            Object.keys(deployed_policy_filters || {}).forEach(policy_filter_id => {
                Object.keys(policy_update.policy_matches_by_filter[policy_filter_id] || {}).forEach(policy_id => {
                    if (!deployment.is_deployment_busy && deployed_policies[policy_id]) {return;}

                    const latest_policy = policy_update.latest_policies[policy_id];
                    const policy_body = latest_policy && latest_policy.policy_body;
                    if (!policy_body || isNaN(policy_body.policyVersion)) {return;}

                    have_policies = true;
                    deployment.added_policies[policy_filter_id] = deployment.added_policies[policy_filter_id] || {
                        "policy_filter_id" : policy_filter_id,
                        "policies" : {}
                    };

                    deployment.added_policies[policy_filter_id].policies[policy_id] = latest_policy;
                    policy_update.added_policy_ids[policy_id] = true;
                    logger.info(req.dcaeReqId, "going to add policy " + JSON.stringify(latest_policy)
                        + " per policy_filter_id " + policy_filter_id
                        + " on node_instance: " + JSON.stringify(node_instance));
                });
            });

            if (have_policies) {
                deployment.node_instance_ids.push(node_instance.id);
                policy_update.policy_deployments[deployment.deployment_id] = deployment;
            }
        });

        logger.info(req.dcaeReqId, "collected policy_deployments to update " + JSON.stringify(policy_update.policy_deployments));
    };

    cloudify.getNodeInstances(req, collect_policy_deployments)
            .then(result => {update_policies_on_deployments(result, req, policy_update);});
}

/**
 * retrieve the unique set of policies and policy-filters from cloudify
 */
function get_policies_from_cloudify(req, res, next) {
    logger.info(req.dcaeReqId, "get_policies_from_cloudify " + req.originalUrl);
    const response = {"requestID": req.dcaeReqId};
    response.started = new Date();
    response.server_instance_uuid = process.mainModule.exports.config.server_instance_uuid;
    response.policies = {};
    response.policy_filters = {};

    cloudify.getNodeInstances(req, function(node_instances) {
        node_instances.forEach(node_instance => {
            if (!node_instance.runtime_properties) {return;}
            const pending_update = cloudify.exeQueue.isDeploymentBusy(node_instance.deployment_id);

            if (node_instance.runtime_properties.policies) {
                Object.keys(node_instance.runtime_properties.policies).forEach(policy_id => {
                    const deployed_policy = response.policies[policy_id] || {
                        "policy_id": policy_id,
                        "policy_versions": {}
                    };
                    const policy = node_instance.runtime_properties.policies[policy_id];
                    if (policy.policy_body && policy.policy_body.policyVersion) {
                        deployed_policy.policy_versions[policy.policy_body.policyVersion] = true;
                    }
                    deployed_policy.pending_update = deployed_policy.pending_update || pending_update;
                    response.policies[policy_id] = deployed_policy;
                });
            }
            if (node_instance.runtime_properties.policy_filters) {
                Object.keys(node_instance.runtime_properties.policy_filters).forEach(policy_filter_id => {
                    node_instance.runtime_properties.policy_filters[policy_filter_id].pending_update = pending_update;
                });
                Object.assign(response.policy_filters, node_instance.runtime_properties.policy_filters);
            }
        });

        logger.info(req.dcaeReqId, "deployed policies: " + JSON.stringify(response.policies)
                                 + " policy_filters: " + JSON.stringify(response.policy_filters)
        );
    })
    .then(function(result) {
        response.ended = new Date();
        response.status = result.status;
        response.message = result.message
                         + " deployed policies[" + Object.keys(response.policies).length
                         + "] policy_filters[" + Object.keys(response.policy_filters).length + "]";
        logger.info(req.dcaeReqId, "response status " + response.status
                                 + " body: " + JSON.stringify(response));
        if (response.status !== 200) {
            logger.error(createError(response.message, response.status, "api", 502, 'cloudify-manager'), req);
        }
        res.status(response.status).json(response);
        logger.audit(req, response.status, response.message);
    });
}


/**
 * retrieve all component-policies from cloudify
 */
function getComponentPoliciesFromCloudify(req, res, next) {
    logger.info(req.dcaeReqId, "getComponentPoliciesFromCloudify " + req.originalUrl);
    const response = {"requestID": req.dcaeReqId};
    response.started = new Date();
    response.server_instance_uuid = process.mainModule.exports.config.server_instance_uuid;
    response.node_instance_ids = [];
    response.component_policies = [];
    response.component_policy_filters = [];
    response.node_instances = [];

    cloudify.getNodeInstances(req, function(node_instances) {
        Array.prototype.push.apply(response.node_instances, node_instances);
        node_instances.forEach(node_instance => {
            if (!node_instance.runtime_properties
            || (!node_instance.runtime_properties.policies
             && !node_instance.runtime_properties.policy_filters)) {
                return;
            }

            var policies_count = 0;
            var policy_filters_count = 0;
            if (node_instance.runtime_properties.policies) {
                Object.keys(node_instance.runtime_properties.policies).forEach(policy_id => {
                    ++policies_count;
                    const policy = node_instance.runtime_properties.policies[policy_id];
                    policy.component_id = node_instance.id;
                    policy.deployment_id = node_instance.deployment_id;
                    response.component_policies.push(policy);
                });
            }
            if (node_instance.runtime_properties.policy_filters) {
                Object.keys(node_instance.runtime_properties.policy_filters).forEach(policy_filter => {
                    ++policy_filters_count;
                    policy_filter = node_instance.runtime_properties.policy_filters[policy_filter];
                    policy_filter.component_id = node_instance.id;
                    policy_filter.deployment_id = node_instance.deployment_id;
                    response.component_policy_filters.push(policy_filter);
                });
            }
            if (policies_count + policy_filters_count) {
                response.node_instance_ids.push({
                    "node_instance_id" : node_instance.id,
                    "deployment_id" : node_instance.deployment_id,
                    "policies_count" : policies_count,
                    "policy_filters_count" : policy_filters_count
                });
            }
        });

        logger.info(req.dcaeReqId, "collected " + response.node_instance_ids.length
                    + " node_instance_ids: " + JSON.stringify(response.node_instance_ids)
                    + " component_policies: " + JSON.stringify(response.component_policies)
                    + " component_policy_filters: " + JSON.stringify(response.component_policy_filters)
        );
    })
    .then(function(result) {
        response.ended = new Date();
        response.status = result.status;
        response.message = result.message
        response.message = result.message
                         + " collected[" + response.node_instance_ids.length
                         + "] node_instance_ids[" + Object.keys(response.node_instance_ids).length
                         + "] component_policies[" + Object.keys(response.component_policies).length
                         + "] component_policy_filters[" + Object.keys(response.component_policy_filters).length + "]";

        logger.info(req.dcaeReqId, "response status " + response.status
                                 + " body: " + JSON.stringify(response));
        if (response.status !== 200) {
            logger.error(createError(response.message, response.status, "api", 502, 'cloudify-manager'), req);
        }
        res.status(response.status).json(response);
        logger.audit(req, response.status, response.message);
    });
}

// ========================================================

const app = require('express')();
app.set('x-powered-by', false);
app.set('etag', false);
app.use(require('./middleware').checkType('application/json'));
app.use(require('body-parser').json({strict: true, limit: '150mb'}));
app.use(function(req, res, next) {
	logger.info(req.dcaeReqId,
		"new req: " + req.method + " " + req.originalUrl +
		" from: " + req.ip + " body: " + JSON.stringify(req.body)
	);
	next();
});

app.get('/', get_policies_from_cloudify);
app.put('/', update_policies);

app.get('/components', getComponentPoliciesFromCloudify);

module.exports = app;
