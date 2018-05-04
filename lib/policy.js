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
 * receive the policy-updated message from the policy-handler
 */
function policyUpdate(req, res, next) {

    const policy_update = {
        catch_up : req.body && req.body.catch_up,
        latest_policies : JSON.stringify((req.body && req.body.latest_policies) || {}),
        removed_policies : JSON.stringify((req.body && req.body.removed_policies) || {}),
        errored_policies : JSON.stringify((req.body && req.body.errored_policies) || {}),
        errored_scopes : JSON.stringify((req.body && req.body.errored_scopes) || []),
        scope_prefixes : JSON.stringify((req.body && req.body.scope_prefixes) || []),
        policy_deployments : {},
        updated_policy_ids : {},
        added_policy_ids : {},
        removed_policy_ids : {}
    };

    logger.info(req.dcaeReqId, "policyUpdate "
                + req.method + ' ' + req.protocol + '://' + req.get('host') + req.originalUrl
                + " catch_up: " + policy_update.catch_up
                + " latest_policies: " + policy_update.latest_policies
                + " removed_policies: " + policy_update.removed_policies
                + " errored_policies: " + policy_update.errored_policies
                + " errored_scopes: " + policy_update.errored_scopes
                + " scope_prefixes: " + policy_update.scope_prefixes
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
    policy_update.errored_policies = JSON.parse(policy_update.errored_policies);
    policy_update.errored_scopes = JSON.parse(policy_update.errored_scopes);
    policy_update.scope_prefixes = JSON.parse(policy_update.scope_prefixes);

    const is_policy_in_scopes = function(policy_id) {
        return policy_update.scope_prefixes.some(scope_prefix => {
            return policy_id.startsWith(scope_prefix);
        });
    };

    const is_policy_in_errored_scopes = function(policy_id) {
        return policy_update.errored_scopes.some(errored_scope => {
            return policy_id.startsWith(errored_scope);
        });
    };
    /**
     * filter out the policies to what is deployed in components and needs updating (new policyVersion)
     */
    const collect_policy_deployments = function(node_instances) {
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

            Object.keys(deployed_policies).forEach(policy_id => {
                const deployed_policy = deployed_policies[policy_id];
                const latest_policy = policy_update.latest_policies[policy_id];
                if (policy_update.removed_policies[policy_id]
                  || (policy_update.catch_up
                    && (deployed_policy.policy_body || deployment.is_deployment_busy)
                    && !latest_policy
                    && !policy_update.errored_policies[policy_id]
                    && !is_policy_in_errored_scopes(policy_id)
                    && is_policy_in_scopes(policy_id))) {
                    have_policies = true;
                    deployment.removed_policy_ids[policy_id] = true;
                    policy_update.removed_policy_ids[policy_id] = true;
                    logger.info(req.dcaeReqId, "going to remove policy " + policy_id + " from node_instance: " + JSON.stringify(node_instance));
                    return;
                }

                if (!latest_policy || !latest_policy.policy_body
                || isNaN(latest_policy.policy_body.policyVersion)) {return;}

                if (!deployment.is_deployment_busy && latest_policy.policy_body.policyVersion
                === (deployed_policy.policy_body && deployed_policy.policy_body.policyVersion)) {return;}

                have_policies = true;
                deployment.updated_policies[policy_id] = latest_policy;
                policy_update.updated_policy_ids[policy_id] = true;
                logger.info(req.dcaeReqId, "going to update policy " + policy_id + " on node_instance: " + JSON.stringify(node_instance));
            });

            const policy_filters = node_instance.runtime_properties.policy_filters || {};
            const policy_filter_ids = Object.keys(policy_filters);
            if (policy_filter_ids.length) {
                logger.info(req.dcaeReqId, "matching latest policies to policy_filters[" + policy_filter_ids.length + "] on node_instance: " + JSON.stringify(node_instance));
                try {
                    Object.keys(policy_update.latest_policies).forEach(policy_id => {
                        if (!deployment.is_deployment_busy && deployed_policies[policy_id]) {return;}

                        const latest_policy = policy_update.latest_policies[policy_id];
                        const policy_body = latest_policy && latest_policy.policy_body;
                        if (!policy_body || isNaN(policy_body.policyVersion)) {return;}
                        const policy_name = policy_body.policyName;
                        if (!policy_name) {return;}
                        const matching_conditions = policy_body.matchingConditions || {};

                        logger.debug(req.dcaeReqId, "matching policy " + JSON.stringify(latest_policy));
                        policy_filter_ids.some(policy_filter_id => {
                            const policy_filter = policy_filters[policy_filter_id].policy_filter;
                            if (!policy_filter || !policy_filter.policyName) {return false;}

                            logger.debug(req.dcaeReqId, "matching to policy_filter " + JSON.stringify(policy_filter));

                            if (!!policy_filter.onapName
                            && policy_filter.onapName !== matching_conditions.ONAPName) {
                                logger.debug(req.dcaeReqId, "not match policy_filter_id " + policy_filter_id
                                    + " by ONAPName: "
                                    + policy_filter.onapName + " !== " + matching_conditions.ONAPName);
                                return false;
                            }
                            if (!!policy_filter.configName
                            && policy_filter.configName !== matching_conditions.ConfigName) {
                                logger.debug(req.dcaeReqId, "not match policy_filter_id " + policy_filter_id
                                    + " by configName: "
                                    + policy_filter.configName + " !== " + matching_conditions.ConfigName);
                                return false;
                            }

                            if (policy_filter.configAttributes
                            && !Object.keys(policy_filter.configAttributes).every(filter_key => {
                                    return (matching_conditions.hasOwnProperty(filter_key)
                                        && policy_filter.configAttributes[filter_key]
                                       === matching_conditions[filter_key]);
                                })) {
                                logger.debug(req.dcaeReqId, "not match policy_filter_id " + policy_filter_id
                                    + " by configAttributes: "
                                    + JSON.stringify(policy_filter.configAttributes) + " !== " + JSON.stringify(matching_conditions));
                                return false;
                            }

                            if (policy_filter.policyName !== policy_id && policy_filter.policyName !== policy_name) {
                                const match_policy_name = new RegExp(policy_filter.policyName);
                                if (!match_policy_name.test(policy_name)) {
                                    logger.debug(req.dcaeReqId, "not match policy_filter_id " + policy_filter_id
                                        + " by policyName: "
                                        + policy_filter.policyName + " versus " + policy_name);
                                    return false;
                                }
                            }

                            have_policies = true;
                            if (!deployment.added_policies[policy_filter_id]) {
                                deployment.added_policies[policy_filter_id] = {
                                    "policy_filter_id" : policy_filter_id,
                                    "policies" : {}
                                };
                            }
                            deployment.added_policies[policy_filter_id].policies[policy_id] = latest_policy;
                            policy_update.added_policy_ids[policy_id] = true;
                            logger.info(req.dcaeReqId, "going to add policy " + JSON.stringify(latest_policy)
                                + " per policy_filter_id " + policy_filter_id
                                + " on node_instance: " + JSON.stringify(node_instance));
                            return true;
                        });
                    });
                } catch (e) {
                    const error_msg = "error on matching policy to filter " + (e.message || "")
                        + " " + (e.stack || "").replace(/\n/g, " ")
                    logger.error(createError(error_msg, 500, "api", 553, 'deployment-handler'), req);
                }
            }

            if (have_policies) {
                deployment.node_instance_ids.push(node_instance.id);
                policy_update.policy_deployments[deployment.deployment_id] = deployment;
            }
        });

        logger.info(req.dcaeReqId, "collected policy_deployments to update " + JSON.stringify(policy_update.policy_deployments));
    };

    const update_policies_on_deployments = function(result) {
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

    cloudify.getNodeInstances(req, collect_policy_deployments).then(update_policies_on_deployments);
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
        response.message = result.message;
        logger.info(req.dcaeReqId, result.message);
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
app.use(function(req, res, next) {
	logger.info(req.dcaeReqId,
		"new req: " + req.method + " " + req.originalUrl +
		" from: " + req.ip + " body: " + JSON.stringify(req.body)
	);
	next();
});

app.post('/', policyUpdate);
app.get('/components', getComponentPoliciesFromCloudify);

module.exports = app;
