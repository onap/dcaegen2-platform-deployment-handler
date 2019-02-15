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

/* Routines related to accessing DCAE inventory */

"use strict";
const INVENTORY = "inventory";

const doRequest = require('./promise_request').doRequest;
const createError = require('./dispatcher-error').createDispatcherError;

const INV_SERV_TYPES = '/dcae-service-types';
const INV_SERVICES = '/dcae-services';
const INV_SERVICE_HEALTH = '/servicehealth';

/*
 * Common error handling for inventory API calls
 */
const invError = function(err) {
    if (err.status && err.status === 404) {
        /* Map 404 to an empty list */
        return [];
    }
    else {
        var newErr;
        var message;
        if (err.status) {
            /* Got a response from inventory indicating an error */
            message = "Error response " + err.status + " from DCAE inventory: " + err.body;
            newErr = createError(message, 502, "api", 501, "dcae-inventory");
        }
        else {
            /* Problem connecting to inventory */
            message = "Error communicating with inventory: " + err.message;
            newErr = createError(message, 504, "system", 201, "dcae-inventory");
        }
        throw newErr;
    }
};

module.exports = function(options) {
    const url = options.url;

    return {
        /* Add a DCAE service to the inventory. Done after a deployment.*/
        addService: function(req, deploymentId, serviceType, vnfId, vnfType, vnfLocation, outputs) {

            /* Create the service description */
            var serviceDescription =
                {
                    "vnfId" : vnfId,
                    "vnfType" : vnfType,
                    "vnfLocation" : vnfLocation,
                    "typeId" : serviceType,
                    "deploymentRef" : deploymentId
                };

                // TODO create 'components' array using 'outputs'--for now, a dummy
                serviceDescription.components = [
                    {
                        componentType: "dummy_component",
                        componentId: "/components/dummy",
                        componentSource: "DCAEController",
                        shareable: 0
                    }
                ];

            const reqOptions = {
                method : "PUT",
                uri : url + INV_SERVICES + "/" + deploymentId,
                json: serviceDescription
            };

            return doRequest(req, reqOptions, null, INVENTORY);
        },

        /* Remove a DCAE service from the inventory. Done after an undeployment.  */
        deleteService: function(req, serviceId) {
            return doRequest(req, {method: "DELETE", uri: url + INV_SERVICES + "/" + serviceId}, null, INVENTORY);
        },

        /* Find running/deploying instances of services (with a given type name, if specified) */
        getServicesByType: function(req, query) {
            var options = {
                method: 'GET',
                uri: url + INV_SERVICES,
                qs: query
            };

            return doRequest(req, options, null, INVENTORY)
                .then (function (result) {
                    var services = [];
                    var content = JSON.parse(result.body);
                    if(content.items) {
                        /* Pick out the fields we want */
                        services = content.items.map(function(i) { return { deploymentId: i.deploymentRef, serviceTypeId: i.typeId};});
                    }
                    return services;
                })
                .catch(invError);
        },

        /* Find a blueprint given the service type ID -- return blueprint and type ID */
        getBlueprintByType: function(req, serviceTypeId) {
            return doRequest(req, {
                method: "GET",
                uri: url + INV_SERV_TYPES + '/' + serviceTypeId
            }, null, INVENTORY)
                .then (function(result) {
                    var blueprintInfo = {};
                    var content = JSON.parse(result.body);
                    blueprintInfo.blueprint = content.blueprintTemplate;
                    blueprintInfo.typeId = content.typeId;

                    return blueprintInfo;
                })
                .catch(invError);
        },

        /*
        * Verify that the specified deployment ID does not already have
        * an entry in inventory.   This is needed to enforce the rule that
        * creating a second instance of a deployment under the
        * same ID as an existing deployment is not permitted.
        * The function checks for a service in inventory using the
        * deployment ID as service name.  If it doesn't exist, the function
        * resolves its promise.  If it *does* exist, then it throws an error.
        */
        verifyUniqueDeploymentId: function(req, deploymentId) {
            return doRequest(req, {
                method: "GET",
                uri: url + INV_SERVICES + "/" + deploymentId
            }, null, INVENTORY)

            /* Successful lookup -- the deployment exists, so throw an error */
            .then(function(res) {
                throw createError("Deployment " + deploymentId + " already exists", 409, "api", 501);
            },

            /* Error from the lookup -- either deployment ID doesn't exist or some other problem */
            function (err) {

                /* Inventory returns a 404 if it does not find the deployment ID */
                if (err.status === 404) {
                    return true;
                }

                /* Some other error -- it really is an error and we can't continue */
                else {
                    return invError(err);
                }
            });
        },

        /*
        * Check if inventory service is healthy using inventory's service check api
        */

        isServiceHealthy: function(req) {
            return doRequest(req, {
                method: "GET",
                uri: url + INV_SERVICE_HEALTH
            }, null, INVENTORY)

            .then(function(res) {
                if ( res.status == 200 ) {
                    return true;
                }
                else {
                   return false;
                }
            },
            function (err) {
                return invError(err);
            });
        }
    };
};
