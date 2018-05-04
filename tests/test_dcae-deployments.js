/*
Copyright(c) 2018 AT&T Intellectual Property. All rights reserved.

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

const nock = require('nock')
    , chai = require('chai')
    , chaiHttp = require('chai-http')
    , expect = chai.expect
    , assert = chai.assert;

chai.use(chaiHttp);

const dh = require('./mock_deployment_handler');
const utils = require('./mock_utils');

const INV_PATH_DCAE_SERVICES = "/dcae-services";
const INV_PATH_DCAE_SERVICE_TYPES = "/dcae-service-types/";
const INV_PARAM_TYPE_ID = "?typeId=";

const I_DONT_KNOW = "i-dont-know";
const DEPLOYMENT_ID_JFL = "dep-jfl-000";
const DEPLOYMENT_ID_JFL_1 = "dep-jfl-001";
const EXISTING_DEPLOYMENT_ID = "deployment-CL-2229";
const INV_EXISTING_SERVICE_TYPE = "86615fc1-aed9-4aa2-9e4b-abdaccbe63de";

const Inventory = {
    resp_empty: {"links":{"previousLink":null,"nextLink":null},"totalCount":0,"items":[]},
    resp_services: function(deployment_id, service_type, totalCount) {
        service_type = service_type || "f93264ee-348c-44f6-af3d-15b157bba735";
        const res = {
            "links": {
                "previousLink": null,
                "nextLink": {
                    "rel": "next",
                    "href": dh.INVENTORY_URL + INV_PATH_DCAE_SERVICES
                    + (service_type && "/" + INV_PARAM_TYPE_ID + service_type + "&offset=25") || "/?offset=25"
                }
            },
            "totalCount": totalCount || 190,
            "items": []
        };
        Array.from(Array(totalCount || 1), (_, idx) => idx).forEach(index => {
            const dpl_id = deployment_id + ((index && "_" + index) || "");
            res.items.push({
                "serviceId": dpl_id,
                "selfLink": {
                    "rel": "self",
                    "href": dh.INVENTORY_URL + INV_PATH_DCAE_SERVICES + "/" + dpl_id
                },
                "created": 1503668339483,
                "modified": 1503668339483,
                "typeLink": {
                    "rel": "type",
                    "href": dh.INVENTORY_URL + INV_PATH_DCAE_SERVICE_TYPES + service_type
                },
                "vnfId": "dummyVnfId",
                "vnfLink": null,
                "vnfType": "dummyVnfType",
                "vnfLocation": "dummyLocation",
                "deploymentRef": dpl_id,
                "components": [{
                    "componentId": "/components/dummy",
                    "componentLink": null,
                    "created": 1489768104449,
                    "modified": 1508260526203,
                    "componentType": "dummyComponent",
                    "componentSource": "DCAEController",
                    "status": null,
                    "location": null,
                    "shareable": 0
                }]
            });
        });
        return res;
    },
    resp_not_found_service: function(service_id) {
        return {
            "code": 1,
            "type": "error",
            "message": "DCAEService not found: " + service_id
        };
    },
    resp_existing_blueprint: function(service_type) {
        return {
            "owner": "dcaeorch",
            "typeName": "svc-type-000",
            "typeVersion": 1,
            "blueprintTemplate": "--- \r\ntosca_definitions_version: cloudify_dsl_1_3\r\nimports: \r\n  - \"http://www.getcloudify.org/spec/cloudify/3.4/types.yaml\"\r\n  - \"https://nexus.onap.org/service/local/repositories/raw/content/org.onap.dcaegen2.platform.plugins/R2/dockerplugin/3.2.0/dockerplugin_types.yaml\"\r\n  - \"https://nexus.onap.org/service/local/repositories/raw/content/org.onap.dcaegen2.platform.plugins/R2/relationshipplugin/1.0.0/relationshipplugin_types.yaml\"\r\n  - \"https://nexus.onap.org/service/local/repositories/raw/content/org.onap.dcaegen2.platform.plugins/R2/dcaepolicyplugin/2.3.0/dcaepolicyplugin_types.yaml\"\r\ninputs: \r\n  aaiEnrichmentHost: \r\n    default: none\r\n    type: string\r\n  aaiEnrichmentPort: \r\n    default: 8443\r\n    type: string\r\n  cbs_host: \r\n    default: config-binding-service.dcae\r\n    type: string\r\n  cbs_port: \r\n    default: \"10000\"\r\n    type: string\r\n  consul_host: \r\n    default: consul-server.onap-consul\r\n    type: string\r\n  consul_port: \r\n    default: \"8500\"\r\n    type: string\r\n  dh_location_id: \r\n    default: zone1\r\n    type: string\r\n  dh_override: \r\n    default: component_dockerhost\r\n    type: string\r\n  dmaap_host: \r\n    default: dmaap.onap-message-router\r\n    type: string\r\n  dmaap_port: \r\n    default: 3904\r\n    type: string\r\n  enableAAIEnrichment: \r\n    default: false\r\n    type: string\r\n  enableRedisCaching: \r\n    default: false\r\n    type: string\r\n  external_port: \r\n    default: \"32014\"\r\n    description: \"Port for CDAPgui to be exposed\"\r\n    type: string\r\n  policy_id: \r\n    default: none\r\n    type: string\r\n  redisHosts: \r\n    type: string\r\n  tag_version: \r\n    default: \"nexus3.onap.org:10001/onap//onap/org.onap.dcaegen2.deployments.tca-cdap-container:1.0.0\"\r\n    type: string\r\nnode_templates: \r\n  docker_service_host: \r\n    properties: \r\n      docker_host_override: \r\n        get_input: dh_override\r\n      location_id: \r\n        get_input: dh_location_id\r\n    type: dcae.nodes.SelectedDockerHost\r\n  tca_docker: \r\n    interfaces: \r\n      cloudify.interfaces.lifecycle: \r\n        start: \r\n          inputs: \r\n            envs: \r\n              AAIHOST: \r\n                get_input: aaiEnrichmentHost\r\n              AAIPORT: \r\n                get_input: aaiEnrichmentPort\r\n              CBS_HOST: \r\n                get_input: cbs_host\r\n              CBS_PORT: \r\n                get_input: cbs_port\r\n              CONFIG_BINDING_SERVICE: config_binding_service\r\n              CONSUL_HOST: \r\n                get_input: consul_host\r\n              CONSUL_PORT: \r\n                get_input: consul_port\r\n              DMAAPHOST: \r\n                get_input: dmaap_host\r\n              DMAAPPORT: \r\n                get_input: dmaap_port\r\n              DMAAPPUBTOPIC: unauthenticated.DCAE_CL_OUTPUT\r\n              DMAAPSUBTOPIC: unauthenticated.SEC_MEASUREMENT_OUTPUT\r\n#              SERVICE_11011_IGNORE: \"true\"\r\n              SERVICE_11015_IGNORE: \"true\"\r\n            ports:\r\n              - concat: [\"11011:\", { get_input: external_port }]                       \r\n        stop: \r\n          inputs: \r\n            cleanup_image: true\r\n    properties: \r\n      application_config: \r\n        app_config: \r\n          appDescription: \"DCAE Analytics Threshold Crossing Alert Application\"\r\n          appName: dcae-tca\r\n          tcaAlertsAbatementTableName: TCAAlertsAbatementTable\r\n          tcaAlertsAbatementTableTTLSeconds: \"1728000\"\r\n          tcaSubscriberOutputStreamName: TCASubscriberOutputStream\r\n          tcaVESAlertsTableName: TCAVESAlertsTable\r\n          tcaVESAlertsTableTTLSeconds: \"1728000\"\r\n          tcaVESMessageStatusTableName: TCAVESMessageStatusTable\r\n          tcaVESMessageStatusTableTTLSeconds: \"86400\"\r\n          thresholdCalculatorFlowletInstances: \"2\"\r\n        app_preferences: \r\n          aaiEnrichmentHost: \r\n            get_input: aaiEnrichmentHost\r\n          aaiEnrichmentIgnoreSSLCertificateErrors: \"true\"\r\n          aaiEnrichmentPortNumber: \"8443\"\r\n          aaiEnrichmentProtocol: https\r\n          aaiEnrichmentUserName: DCAE\r\n          aaiEnrichmentUserPassword: DCAE\r\n          aaiVMEnrichmentAPIPath: /aai/v11/search/nodes-query\r\n          aaiVNFEnrichmentAPIPath: /aai/v11/network/generic-vnfs/generic-vnf\r\n          enableAAIEnrichment: \r\n            get_input: enableAAIEnrichment\r\n          enableAlertCEFFormat: \"false\"\r\n          enableRedisCaching: \r\n            get_input: enableRedisCaching\r\n          publisherContentType: application/json\r\n          publisherHostName: \r\n            get_input: dmaap_host\r\n          publisherHostPort: \r\n            get_input: dmaap_port\r\n          publisherMaxBatchSize: \"1\"\r\n          publisherMaxRecoveryQueueSize: \"100000\"\r\n          publisherPollingInterval: \"20000\"\r\n          publisherProtocol: http\r\n          publisherTopicName: unauthenticated.DCAE_CL_OUTPUT\r\n          redisHosts: \r\n            get_input: redisHosts\r\n          subscriberConsumerGroup: OpenDCAE-c12\r\n          subscriberConsumerId: c12\r\n          subscriberContentType: application/json\r\n          subscriberHostName: \r\n            get_input: dmaap_host\r\n          subscriberHostPort: \r\n            get_input: dmaap_port\r\n          subscriberMessageLimit: \"-1\"\r\n          subscriberPollingInterval: \"30000\"\r\n          subscriberProtocol: http\r\n          subscriberTimeoutMS: \"-1\"\r\n          subscriberTopicName: unauthenticated.SEC_MEASUREMENT_OUTPUT\r\n          tca_policy: \"{\\\"domain\\\":\\\"measurementsForVfScaling\\\",\\\"metricsPerEventName\\\":[{\\\"eventName\\\":\\\"vFirewallBroadcastPackets\\\",\\\"controlLoopSchemaType\\\":\\\"VNF\\\",\\\"policyScope\\\":\\\"DCAE\\\",\\\"policyName\\\":\\\"DCAE.Config_tca-hi-lo\\\",\\\"policyVersion\\\":\\\"v0.0.1\\\",\\\"thresholds\\\":[{\\\"closedLoopControlName\\\":\\\"ControlLoop-vFirewall-d0a1dfc6-94f5-4fd4-a5b5-4630b438850a\\\",\\\"version\\\":\\\"1.0.2\\\",\\\"fieldPath\\\":\\\"$.event.measurementsForVfScalingFields.vNicUsageArray[*].receivedTotalPacketsDelta\\\",\\\"thresholdValue\\\":300,\\\"direction\\\":\\\"LESS_OR_EQUAL\\\",\\\"severity\\\":\\\"MAJOR\\\",\\\"closedLoopEventStatus\\\":\\\"ONSET\\\"},{\\\"closedLoopControlName\\\":\\\"ControlLoop-vFirewall-d0a1dfc6-94f5-4fd4-a5b5-4630b438850a\\\",\\\"version\\\":\\\"1.0.2\\\",\\\"fieldPath\\\":\\\"$.event.measurementsForVfScalingFields.vNicUsageArray[*].receivedTotalPacketsDelta\\\",\\\"thresholdValue\\\":700,\\\"direction\\\":\\\"GREATER_OR_EQUAL\\\",\\\"severity\\\":\\\"CRITICAL\\\",\\\"closedLoopEventStatus\\\":\\\"ONSET\\\"}]},{\\\"eventName\\\":\\\"vLoadBalancer\\\",\\\"controlLoopSchemaType\\\":\\\"VM\\\",\\\"policyScope\\\":\\\"DCAE\\\",\\\"policyName\\\":\\\"DCAE.Config_tca-hi-lo\\\",\\\"policyVersion\\\":\\\"v0.0.1\\\",\\\"thresholds\\\":[{\\\"closedLoopControlName\\\":\\\"ControlLoop-vDNS-6f37f56d-a87d-4b85-b6a9-cc953cf779b3\\\",\\\"version\\\":\\\"1.0.2\\\",\\\"fieldPath\\\":\\\"$.event.measurementsForVfScalingFields.vNicUsageArray[*].receivedTotalPacketsDelta\\\",\\\"thresholdValue\\\":300,\\\"direction\\\":\\\"GREATER_OR_EQUAL\\\",\\\"severity\\\":\\\"CRITICAL\\\",\\\"closedLoopEventStatus\\\":\\\"ONSET\\\"}]},{\\\"eventName\\\":\\\"Measurement_vGMUX\\\",\\\"controlLoopSchemaType\\\":\\\"VNF\\\",\\\"policyScope\\\":\\\"DCAE\\\",\\\"policyName\\\":\\\"DCAE.Config_tca-hi-lo\\\",\\\"policyVersion\\\":\\\"v0.0.1\\\",\\\"thresholds\\\":[{\\\"closedLoopControlName\\\":\\\"ControlLoop-vCPE-48f0c2c3-a172-4192-9ae3-052274181b6e\\\",\\\"version\\\":\\\"1.0.2\\\",\\\"fieldPath\\\":\\\"$.event.measurementsForVfScalingFields.additionalMeasurements[*].arrayOfFields[0].value\\\",\\\"thresholdValue\\\":0,\\\"direction\\\":\\\"EQUAL\\\",\\\"severity\\\":\\\"MAJOR\\\",\\\"closedLoopEventStatus\\\":\\\"ABATED\\\"},{\\\"closedLoopControlName\\\":\\\"ControlLoop-vCPE-48f0c2c3-a172-4192-9ae3-052274181b6e\\\",\\\"version\\\":\\\"1.0.2\\\",\\\"fieldPath\\\":\\\"$.event.measurementsForVfScalingFields.additionalMeasurements[*].arrayOfFields[0].value\\\",\\\"thresholdValue\\\":0,\\\"direction\\\":\\\"GREATER\\\",\\\"severity\\\":\\\"CRITICAL\\\",\\\"closedLoopEventStatus\\\":\\\"ONSET\\\"}]}]}\"\r\n      docker_config: \r\n        healthcheck: \r\n          endpoint: /\r\n          interval: 15s\r\n          timeout: 1s\r\n          type: http\r\n      image: \r\n        get_input: tag_version\r\n      service_component_type: dcaegen2-analytics_tca\r\n    relationships: \r\n      - \r\n        target: docker_service_host\r\n        type: dcae.relationships.component_contained_in\r\n      - \r\n        target: tca_policy\r\n        type: cloudify.relationships.depends_on\r\n    type: dcae.nodes.DockerContainerForComponentsUsingDmaap\r\n  tca_policy: \r\n    properties: \r\n      policy_id: \r\n        get_input: policy_id\r\n    type: dcae.nodes.policy\r\n",
            "serviceIds": null,
            "vnfTypes": ["TESTVNF000"],
            "serviceLocations": null,
            "asdcServiceId": null,
            "asdcResourceId": null,
            "asdcServiceURL": null,
            "typeId": service_type,
            "selfLink": {
                "rel": "self",
                "href": dh.INVENTORY_URL + INV_PATH_DCAE_SERVICE_TYPES + service_type
            },
            "created": 1500910967567,
            "deactivated": null
        };
    },
    resp_put_service: function(deployment_id, service_type) {
        return {
            "serviceId": deployment_id,
            "selfLink": {
                "rel": "self",
                "href": dh.INVENTORY_URL + INV_PATH_DCAE_SERVICES + "/" + deployment_id
            },
            "created": 1516376798582,
            "modified": 1516376798582,
            "typeLink": {
                "rel": "type",
                "href": dh.INVENTORY_URL + INV_PATH_DCAE_SERVICE_TYPES + service_type
            },
            "vnfId": "dummyVnfId",
            "vnfLink": null,
            "vnfType": "dummyVnfType",
            "vnfLocation": "dummyLocation",
            "deploymentRef": deployment_id,
            "components": [{
                "componentId": "/components/dummy",
                "componentLink": null,
                "created": 1489768104449,
                "modified": 1516376798582,
                "componentType": "dummy_component",
                "componentSource": "DCAEController",
                "status": null,
                "location": null,
                "shareable": 0
            }]
        };
    }
};

const Cloudify = {
    resp_blueprint: function(deployment_id) {
        return {
            "main_file_name": "blueprint.yaml",
            "description": null,
            "created_at": "2018-01-19 15:46:47.037084",
            "updated_at": "2018-01-19 15:46:47.037084",
            "plan": {},
            "id": deployment_id
        };
    },
    resp_deploy: function(deployment_id, blueprint_id, inputs) {
        return {
            "inputs": (inputs && JSON.parse(JSON.stringify(inputs)) || null),
            "description": null,
            "created_at": "2018-01-19 15:46:47.037084",
            "updated_at": "2018-01-19 15:46:47.037084",
            "id": deployment_id,
            "blueprint_id": blueprint_id || deployment_id
        };
    },
    resp_execution: function(deployment_id, blueprint_id, execution_id, terminated, workflow_id) {
        return {
            "status": (terminated && "terminated") || "pending",
            "created_at": "2018-01-19 15:51:21.866227",
            "workflow_id": workflow_id || "install",
            "is_system_workflow": false,
            "parameters": {},
            "blueprint_id": blueprint_id || deployment_id,
            "deployment_id": deployment_id,
            "error": "",
            "id": execution_id
        };
    },
    resp_outputs: function(deployment_id) {
        return {"outputs": {}, "deployment_id": deployment_id};
    }
};

function test_get_dcae_deployments(dh_server) {
    const req_path = "/dcae-deployments";
    const test_txt = "GET " + req_path;
    describe(test_txt, () => {
        it('GET all the dcae-deployments from inventory', function() {
            const action_timer = new utils.ActionTimer();
            console.log(action_timer.step, test_txt);

            const inv_resp = Inventory.resp_services(EXISTING_DEPLOYMENT_ID);
            nock(dh.INVENTORY_URL).get(INV_PATH_DCAE_SERVICES)
                .reply(200, function(uri) {
                    console.log(action_timer.step, "get", dh.INVENTORY_URL, uri);
                    return JSON.stringify(inv_resp);
                });

            return chai.request(dh_server.app).get(req_path)
                .then(function(res) {
                    console.log(action_timer.step, "res for", test_txt, res.text);
                    expect(res).to.have.status(200);
                    expect(res).to.be.json;

                    assert.containsAllKeys(res.body, {"requestId": "", "deployments": []});
                    assert.isString(res.body.requestId);
                    assert.isArray(res.body.deployments);
                    assert.lengthOf(res.body.deployments, inv_resp.items.length);
                    assert.containsAllKeys(res.body.deployments[0], {"href":null});
                    assert.match(res.body.deployments[0].href,
                        new RegExp("^http:[/][/]127.0.0.1:[0-9]+[/]dcae-deployments[/]" + EXISTING_DEPLOYMENT_ID));
                })
                .catch(function(err) {
                    console.error(action_timer.step, "err for", test_txt, err);
                    throw err;
                });
        });
    });
}

function test_get_dcae_deployments_service_type_unknown(dh_server) {
    const req_path = "/dcae-deployments?serviceTypeId=" + I_DONT_KNOW;
    const test_txt = "GET " + req_path;
    describe(test_txt, () => {
        it('GET nothing for unknown service-type from inventory', function() {
            const action_timer = new utils.ActionTimer();
            console.log(action_timer.step, test_txt);
            nock(dh.INVENTORY_URL).get(INV_PATH_DCAE_SERVICES + INV_PARAM_TYPE_ID + I_DONT_KNOW)
                .reply(200, function(uri) {
                        console.log(action_timer.step, "get", dh.INVENTORY_URL, uri);
                        return JSON.stringify(Inventory.resp_empty);
                    }
                );

            return chai.request(dh_server.app).get(req_path)
                .then(function(res) {
                    console.log(action_timer.step, "res for", test_txt, res.text);
                    expect(res).to.have.status(200);
                    expect(res).to.be.json;

                    assert.containsAllKeys(res.body, {"requestId": "", "deployments": []});
                    assert.isString(res.body.requestId);
                    assert.isArray(res.body.deployments);
                    assert.lengthOf(res.body.deployments, 0);
                })
                .catch(function(err) {
                    console.error(action_timer.step, "err for", test_txt, err);
                    throw err;
                });
        });
    });
}

function create_main_message(service_type_id, include_inputs) {
    var msg = {"serviceTypeId": service_type_id};
    if (include_inputs) {
        msg.inputs= {
            "dcae_service_location" : "loc00",
            "dcae_target_type" : "type000",
            "dcae_target_name" : "target000"
        };
    }
    return msg;
}

function test_put_dcae_deployments_i_dont_know(dh_server) {
    const req_path = "/dcae-deployments/" + I_DONT_KNOW;
    const message = create_main_message(I_DONT_KNOW);
    const test_txt = "PUT " + req_path + ": " + JSON.stringify(message);
    describe(test_txt, () => {
        it('Fail to deploy i-dont-know service', function(done) {
            const action_timer = new utils.ActionTimer();
            console.log(action_timer.step, test_txt);
            nock(dh.INVENTORY_URL).get(INV_PATH_DCAE_SERVICES + "/" + I_DONT_KNOW)
                .reply(404, function(uri) {
                        console.log(action_timer.step, "get", dh.INVENTORY_URL, uri);
                        return JSON.stringify(Inventory.resp_not_found_service(I_DONT_KNOW));
                    });
            nock(dh.INVENTORY_URL).get(INV_PATH_DCAE_SERVICE_TYPES + I_DONT_KNOW)
                .reply(404, function(uri) {
                        console.log(action_timer.step, "get", dh.INVENTORY_URL, uri);
                        return "<html> <head><title>Error 404 Not Found</title></head><body></body> </html>";
                    });

            chai.request(dh_server.app).put(req_path)
                .set('content-type', 'application/json')
                .send(message)
                .end(function(err, res) {
                    console.log(action_timer.step, "res for", test_txt, res.text);
                    expect(res).to.have.status(404);
                    expect(res.body).to.have.property('message');
                    expect(res.body.message).to.be.equal("No service type with ID " + I_DONT_KNOW);
                    done();
                });
        });
    });
}

function test_put_dcae_deployments_missing_input_error(dh_server) {
    const req_path = "/dcae-deployments/" + DEPLOYMENT_ID_JFL;
    const message = create_main_message(INV_EXISTING_SERVICE_TYPE);
    const test_txt = "PUT " + req_path + ": " + JSON.stringify(message);
    describe(test_txt, () => {
        it('Fail to deploy service - missing_input', function(done) {
            const action_timer = new utils.ActionTimer();
            console.log(action_timer.step, test_txt);

            nock(dh.INVENTORY_URL).get(INV_PATH_DCAE_SERVICES + "/" + DEPLOYMENT_ID_JFL)
                .reply(404, function(uri) {
                        console.log(action_timer.step, "get", dh.INVENTORY_URL, uri);
                        return JSON.stringify(Inventory.resp_not_found_service(DEPLOYMENT_ID_JFL));
                    });
            nock(dh.INVENTORY_URL).get(INV_PATH_DCAE_SERVICE_TYPES + INV_EXISTING_SERVICE_TYPE)
                .reply(200, function(uri) {
                        console.log(action_timer.step, "get", dh.INVENTORY_URL, uri);
                        return JSON.stringify(Inventory.resp_existing_blueprint(INV_EXISTING_SERVICE_TYPE));
                    });
            nock(dh.INVENTORY_URL).put(INV_PATH_DCAE_SERVICES + "/" + DEPLOYMENT_ID_JFL)
                .reply(200, function(uri, requestBody) {
                        console.log(action_timer.step, "put", dh.INVENTORY_URL, uri, JSON.stringify(requestBody));
                        return JSON.stringify(Inventory.resp_put_service(DEPLOYMENT_ID_JFL, INV_EXISTING_SERVICE_TYPE));
                    });
            nock(dh.INVENTORY_URL).delete(INV_PATH_DCAE_SERVICES + "/" + DEPLOYMENT_ID_JFL)
                .reply(200, function(uri) {
                    console.log(action_timer.step, "delete", dh.INVENTORY_URL, uri);
                    return "";
                });

            nock(dh.CLOUDIFY_URL).put("/api/v2.1/blueprints/" + DEPLOYMENT_ID_JFL)
                .reply(200, function(uri, requestBody) {
                        console.log(action_timer.step, "put", dh.CLOUDIFY_URL, uri, JSON.stringify(requestBody));
                        return JSON.stringify(Cloudify.resp_blueprint(DEPLOYMENT_ID_JFL));
                    });

            const depl_rejected = {
                "message": "Required inputs blah...",
                "error_code": "missing_required_deployment_input_error",
                "server_traceback": "Traceback blah..."
            };
            nock(dh.CLOUDIFY_URL).put("/api/v2.1/deployments/" + DEPLOYMENT_ID_JFL)
                .reply(400, function(uri) {
                        console.log(action_timer.step, "put", dh.CLOUDIFY_URL, uri);
                        return JSON.stringify(depl_rejected);
                    });

            chai.request(dh_server.app).put(req_path)
                .set('content-type', 'application/json')
                .send(message)
                .end(function(err, res) {
                    console.log(action_timer.step, "res for", test_txt, res.text);
                    expect(res).to.have.status(400);
                    expect(res.body).to.have.property('message');
                    expect(res.body.message).to.be.equal("Status 400 from CM API -- error code: " + depl_rejected.error_code + " -- message: " + depl_rejected.message);
                    done();
                });
        });
    });
}

function test_put_dcae_deployments_success(dh_server) {
    const req_path = "/dcae-deployments/" + DEPLOYMENT_ID_JFL_1;
    const message = create_main_message(INV_EXISTING_SERVICE_TYPE, true);
    const test_txt = "PUT " + req_path + ": " + JSON.stringify(message);
    const execution_id = "execution_" + DEPLOYMENT_ID_JFL_1;
    describe(test_txt, () => {
        it('Success deploy service', function() {
            const action_timer = new utils.ActionTimer();
            console.log(action_timer.step, test_txt);

            nock(dh.INVENTORY_URL).get(INV_PATH_DCAE_SERVICES + "/" + DEPLOYMENT_ID_JFL_1)
                .reply(404, function(uri) {
                    console.log(action_timer.step, "get", dh.INVENTORY_URL, uri);
                    return JSON.stringify(Inventory.resp_not_found_service(DEPLOYMENT_ID_JFL_1));
                });
            nock(dh.INVENTORY_URL).get(INV_PATH_DCAE_SERVICE_TYPES + INV_EXISTING_SERVICE_TYPE)
                .reply(200, function(uri) {
                    console.log(action_timer.step, "get", dh.INVENTORY_URL, uri);
                    return JSON.stringify(Inventory.resp_existing_blueprint(INV_EXISTING_SERVICE_TYPE));
                });
            nock(dh.INVENTORY_URL).put(INV_PATH_DCAE_SERVICES + "/" + DEPLOYMENT_ID_JFL_1)
                .reply(200, function(uri, requestBody) {
                    console.log(action_timer.step, "put", dh.INVENTORY_URL, uri, JSON.stringify(requestBody));
                    return JSON.stringify(Inventory.resp_put_service(DEPLOYMENT_ID_JFL_1, INV_EXISTING_SERVICE_TYPE));
                });

            nock(dh.CLOUDIFY_URL).put("/api/v2.1/blueprints/" + DEPLOYMENT_ID_JFL_1)
                .reply(200, function(uri, requestBody) {
                    console.log(action_timer.step, "put", dh.CLOUDIFY_URL, uri, JSON.stringify(requestBody));
                    return JSON.stringify(Cloudify.resp_blueprint(DEPLOYMENT_ID_JFL_1));
                });

            nock(dh.CLOUDIFY_URL).put("/api/v2.1/deployments/" + DEPLOYMENT_ID_JFL_1)
                .reply(201, function(uri, requestBody) {
                    console.log(action_timer.step, "put", dh.CLOUDIFY_URL, uri, JSON.stringify(requestBody));
                    return JSON.stringify(Cloudify.resp_deploy(DEPLOYMENT_ID_JFL_1, DEPLOYMENT_ID_JFL_1, message.inputs));
                });

            nock(dh.CLOUDIFY_URL).post("/api/v2.1/executions")
                .reply(201, function(uri, requestBody) {
                    console.log(action_timer.step, "post", dh.CLOUDIFY_URL, uri, JSON.stringify(requestBody));
                    return JSON.stringify(Cloudify.resp_execution(DEPLOYMENT_ID_JFL_1, DEPLOYMENT_ID_JFL_1, execution_id));
                });

            nock(dh.CLOUDIFY_URL).get("/api/v2.1/executions/" + execution_id)
                .reply(200, function(uri) {
                    console.log(action_timer.step, "get", dh.CLOUDIFY_URL, uri);
                    return JSON.stringify(Cloudify.resp_execution(DEPLOYMENT_ID_JFL_1, DEPLOYMENT_ID_JFL_1, execution_id, true));
                });

            nock(dh.CLOUDIFY_URL).get("/api/v2.1/deployments/" + DEPLOYMENT_ID_JFL_1 + "/outputs")
                .reply(200, function(uri) {
                    console.log(action_timer.step, "get", dh.CLOUDIFY_URL, uri);
                    return JSON.stringify(Cloudify.resp_outputs(DEPLOYMENT_ID_JFL_1));
                });

            return chai.request(dh_server.app).put(req_path)
                .set('content-type', 'application/json')
                .send(message)
                .then(function(res) {
                    console.log(action_timer.step, "res for", test_txt, res.text);
                    expect(res).to.have.status(202);
                    expect(res).to.be.json;

                    return utils.sleep(10000);
                })
                .then(function() {
                    console.log(action_timer.step, "the end of test");
                })
                .catch(function(err) {
                    console.error(action_timer.step, "err for", test_txt, err);
                    throw err;
                });
        }).timeout(50000);
    });
}

function test_get_dcae_deployments_operation(dh_server) {
    const execution_id = "execution_" + DEPLOYMENT_ID_JFL_1;
    const req_path = "/dcae-deployments/" + DEPLOYMENT_ID_JFL_1 + "/operation/" + execution_id;
    const test_txt = "GET " + req_path;
    describe(test_txt, () => {
        it('Get operation execution succeeded', function() {
            const action_timer = new utils.ActionTimer();
            console.log(action_timer.step, test_txt);
            nock(dh.CLOUDIFY_URL).get("/api/v2.1/executions/" + execution_id)
                .reply(200, function(uri) {
                    console.log(action_timer.step, "get", dh.CLOUDIFY_URL, uri);
                    return JSON.stringify(Cloudify.resp_execution(DEPLOYMENT_ID_JFL_1, DEPLOYMENT_ID_JFL_1, execution_id, true));
                });

            return chai.request(dh_server.app).get(req_path)
                .then(function(res) {
                    console.log(action_timer.step, "res for", test_txt, res.text);
                    expect(res).to.have.status(200);
                    expect(res).to.be.json;
                })
                .catch(function(err) {
                    console.error(action_timer.step, "err for", test_txt, err);
                    throw err;
                });
        });
    });
}

function test_get_dcae_deployments_service_type_deployed(dh_server) {
    const req_path = "/dcae-deployments?serviceTypeId=" + INV_EXISTING_SERVICE_TYPE;
    const test_txt = "GET " + req_path;
    describe(test_txt, () => {
        it('GET services=deployments of the service-type from inventory', function() {
            const action_timer = new utils.ActionTimer();
            console.log(action_timer.step, test_txt);
            const deployed_count = 10;
            nock(dh.INVENTORY_URL)
                .get(INV_PATH_DCAE_SERVICES + INV_PARAM_TYPE_ID + INV_EXISTING_SERVICE_TYPE)
                .reply(200, function(uri) {
                    console.log(action_timer.step, "get", dh.INVENTORY_URL, uri);
                    return JSON.stringify(Inventory.resp_services(DEPLOYMENT_ID_JFL_1, INV_EXISTING_SERVICE_TYPE, deployed_count));
                });

            return chai.request(dh_server.app).get(req_path)
                .then(function(res) {
                    console.log(action_timer.step, "res for", test_txt, res.text);
                    expect(res).to.have.status(200);
                    expect(res).to.be.json;

                    assert.containsAllKeys(res.body, {"requestId": "", "deployments": []});
                    assert.isString(res.body.requestId);
                    assert.isArray(res.body.deployments);
                    assert.lengthOf(res.body.deployments, deployed_count);
                })
                .catch(function(err) {
                    console.error(action_timer.step, "err for", test_txt, err);
                    throw err;
                });
        });
    });
}

function test_delete_dcae_deployments_success(dh_server) {
    const req_path = "/dcae-deployments/" + DEPLOYMENT_ID_JFL_1;
    const test_txt = "DELETE " + req_path;
    const workflow_id = "uninstall";
    const execution_id = workflow_id + "_" + DEPLOYMENT_ID_JFL_1;
    describe(test_txt, () => {
        it('Success DELETE service', function() {
            const action_timer = new utils.ActionTimer();
            console.log(action_timer.step, test_txt);

            nock(dh.CLOUDIFY_URL).post("/api/v2.1/executions")
                .reply(201, function(uri, requestBody) {
                        console.log(action_timer.step, "post", dh.CLOUDIFY_URL, uri, JSON.stringify(requestBody));
                        return JSON.stringify(Cloudify.resp_execution(DEPLOYMENT_ID_JFL_1, DEPLOYMENT_ID_JFL_1,
                            execution_id, false, workflow_id));
                    });

            nock(dh.INVENTORY_URL).delete(INV_PATH_DCAE_SERVICES + "/" + DEPLOYMENT_ID_JFL_1)
                .reply(200, function(uri) {
                    console.log(action_timer.step, "delete", dh.INVENTORY_URL, uri);
                    return "";
                });

            nock(dh.CLOUDIFY_URL).get("/api/v2.1/executions/" + execution_id)
                .reply(200, function(uri) {
                        console.log(action_timer.step, "get", dh.CLOUDIFY_URL, uri);
                        return JSON.stringify(Cloudify.resp_execution(DEPLOYMENT_ID_JFL_1, DEPLOYMENT_ID_JFL_1,
                            execution_id, true, workflow_id));
                    });

            nock(dh.CLOUDIFY_URL).delete("/api/v2.1/deployments/" + DEPLOYMENT_ID_JFL_1)
                .reply(201, function(uri) {
                    console.log(action_timer.step, "delete", dh.CLOUDIFY_URL, uri);
                    return JSON.stringify(Cloudify.resp_deploy(DEPLOYMENT_ID_JFL_1, DEPLOYMENT_ID_JFL_1));
                });

            nock(dh.CLOUDIFY_URL).delete("/api/v2.1/blueprints/" + DEPLOYMENT_ID_JFL_1)
                .reply(200, function(uri) {
                    console.log(action_timer.step, "delete", dh.CLOUDIFY_URL, uri);
                    return JSON.stringify(Cloudify.resp_blueprint(DEPLOYMENT_ID_JFL_1));
                });

            return chai.request(dh_server.app).delete(req_path)
                .then(function(res) {
                    console.log(action_timer.step, "res for", test_txt, res.text);
                    expect(res).to.have.status(202);
                    expect(res).to.be.json;

                    return utils.sleep(45000);
                })
                .then(function() {
                    console.log(action_timer.step, "the end of test");
                })
                .catch(function(err) {
                    console.error(action_timer.step, "err for", test_txt, err);
                    throw err;
                });
        }).timeout(60000);
    });
}

dh.add_tests([
    test_get_dcae_deployments,
    test_get_dcae_deployments_service_type_unknown,
    test_put_dcae_deployments_i_dont_know,
    test_put_dcae_deployments_missing_input_error,
    test_get_dcae_deployments_operation,
    test_get_dcae_deployments_service_type_deployed,
    test_put_dcae_deployments_success,
    test_delete_dcae_deployments_success
]);
