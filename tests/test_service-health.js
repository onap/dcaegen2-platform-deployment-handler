/*
Copyright(c) 2018-2019 AT&T Intellectual Property. All rights reserved.

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

const fs = require("fs");

const nock = require('nock')
    , chai = require('chai')
    , chaiHttp = require('chai-http')
    , expect = chai.expect
    , assert = chai.assert
    , admzip = require('adm-zip');

chai.use(chaiHttp);

const dh = require('./mock_deployment_handler');
const utils = require('./mock_utils');

const INV_PATH_DCAE_SERVICE_TYPES = "/dcae-service-types/";
const INV_SERVICE_HEALTH = "/servicehealth";

const Inventory = {
    resp_empty: {"links":{"previousLink":null,"nextLink":null},"totalCount":0,"items":[]},
    resp_service_types: function(service_type, totalCount) {
        service_type = service_type || "f93264ee-348c-44f6-af3d-15b157bba735";
        const res = {
            "links": {
                "previousLink": null,
                "nextLink": {
                    "rel": "next",
                    "href": dh.INVENTORY_URL + INV_PATH_DCAE_SERVICE_TYPES + "?onlyLatest=true&onlyActive=true&offset=25"
                }
            },
            "totalCount": totalCount || 1,
            "items": []
        };
        Array.from(Array(totalCount || 1), (_, idx) => idx).forEach(index => {
            //const dpl_id = deployment_id + ((index && "_" + index) || "");
            res.items.push({
                "owner": "dcaeorch",
                "typeName": "svc-type-000",
                "typeVersion": 1,
                "blueprintTemplate": "tosca_definitions_version: cloudify_dsl_1_3\nimports:\n  - \"http://www.getcloudify.org/spec/cloudify/3.4/types.yaml\"\n  - https://nexus.onap.org/service/local/repositories/raw/content/org.onap.dcaegen2.platform.plugins/R4/dockerplugin/3.2.0/dockerplugin_types.yaml\n  - https://nexus.onap.org/service/local/repositories/raw/content/org.onap.dcaegen2.platform.plugins/R4/relationshipplugin/1.0.0/relationshipplugin_types.yaml\n  - https://nexus.onap.org/service/local/repositories/raw/content/org.onap.dcaegen2.platform.plugins/R4/dcaepolicyplugin/2.3.0/dcaepolicyplugin_types.yaml\n\ninputs:\n  dh_override:\n    type: string\n    default: \"dockerhost\"\n  dh_location_id:\n    type: string\n    default: \"zone1\"\n  aaiEnrichmentHost:\n    type: string\n    default: \"none\"\n  aaiEnrichmentPort:\n    type: string    \n    default: 8443\n  enableAAIEnrichment:\n    type: string\n    default: false\n  dmaap_host:\n    type: string\n    default: dmaap.onap-message-router   \n  dmaap_port:\n    type: string\n    default: 3904    \n  enableRedisCaching:\n    type: string\n    default: false    \n  redisHosts:\n    type: string      \n  tag_version:\n    type: string\n    default: \"nexus3.onap.org:10001/onap/org.onap.dcaegen2.deployments.tca-cdap-container:1.0.0\"\n  consul_host:\n    type: string\n    default: consul-server.onap-consul\n  consul_port:\n    type: string\n    default: \"8500\"\n  cbs_host:\n    type: string\n    default: \"config-binding-service.dcae\"\n  cbs_port:\n    type: string\n    default: \"10000\"\n  policy_id:\n    type: string\n    default: \"none\"\n  external_port:\n    type: string\n    description: \"Port for CDAPgui to be exposed\"\n    default: \"32010\"\n  scn_name: \n    default: dcaegen2-analytics_tca_clampinstance_1\n    type: string\nnode_templates:\n  docker_service_host:\n    properties:\n      docker_host_override:\n        get_input: dh_override\n      location_id:\n        get_input: dh_location_id\n    type: dcae.nodes.SelectedDockerHost\n  tca_docker:\n    relationships:\n       - type: dcae.relationships.component_contained_in\n         target: docker_service_host\n       - target: tca_policy\n         type: cloudify.relationships.depends_on        \n    type: dcae.nodes.DockerContainerForComponentsUsingDmaap\n    properties:\n        application_config:\n            app_config:\n                appDescription: DCAE Analytics Threshold Crossing Alert Application\n                appName: dcae-tca\n                tcaAlertsAbatementTableName: TCAAlertsAbatementTable\n                tcaAlertsAbatementTableTTLSeconds: '1728000'\n                tcaSubscriberOutputStreamName: TCASubscriberOutputStream\n                tcaVESAlertsTableName: TCAVESAlertsTable\n                tcaVESAlertsTableTTLSeconds: '1728000'\n                tcaVESMessageStatusTableName: TCAVESMessageStatusTable\n                tcaVESMessageStatusTableTTLSeconds: '86400'\n                thresholdCalculatorFlowletInstances: '2'\n            app_preferences:\n                aaiEnrichmentHost: \n                    get_input: aaiEnrichmentHost\n                aaiEnrichmentIgnoreSSLCertificateErrors: 'true'\n                aaiEnrichmentPortNumber: '8443'\n                aaiEnrichmentProtocol: https\n                aaiEnrichmentUserName: DCAE\n                aaiEnrichmentUserPassword: DCAE\n                aaiVMEnrichmentAPIPath: /aai/v11/search/nodes-query\n                aaiVNFEnrichmentAPIPath: /aai/v11/network/generic-vnfs/generic-vnf\n                enableAAIEnrichment: \n                    get_input: enableAAIEnrichment\n                enableRedisCaching: \n                    get_input: enableRedisCaching\n                redisHosts: \n                    get_input: redisHosts\n                enableAlertCEFFormat: 'false'\n                publisherContentType: application/json\n                publisherHostName: \n                    get_input: dmaap_host\n                publisherHostPort: \n                    get_input: dmaap_port                  \n                publisherMaxBatchSize: '1'\n                publisherMaxRecoveryQueueSize: '100000'\n                publisherPollingInterval: '20000'\n                publisherProtocol: http\n                publisherTopicName: unauthenticated.DCAE_CL_OUTPUT\n                subscriberConsumerGroup: OpenDCAE-c12\n                subscriberConsumerId: c12\n                subscriberContentType: application/json\n                subscriberHostName: \n                    get_input: dmaap_host\n                subscriberHostPort:\n                    get_input: dmaap_port                                  \n                subscriberMessageLimit: '-1'\n                subscriberPollingInterval: '30000'\n                subscriberProtocol: http\n                subscriberTimeoutMS: '-1'\n                subscriberTopicName: unauthenticated.SEC_MEASUREMENT_OUTPUT\n                tca_policy_default: '{\"domain\":\"measurementsForVfScaling\",\"metricsPerEventName\":[{\"eventName\":\"vFirewallBroadcastPackets\",\"controlLoopSchemaType\":\"VNF\",\"policyScope\":\"DCAE\",\"policyName\":\"DCAE.Config_tca-hi-lo\",\"policyVersion\":\"v0.0.1\",\"thresholds\":[{\"closedLoopControlName\":\"ControlLoop-vFirewall-d0a1dfc6-94f5-4fd4-a5b5-4630b438850a\",\"version\":\"1.0.2\",\"fieldPath\":\"$.event.measurementsForVfScalingFields.vNicUsageArray[*].receivedTotalPacketsDelta\",\"thresholdValue\":300,\"direction\":\"LESS_OR_EQUAL\",\"severity\":\"MAJOR\",\"closedLoopEventStatus\":\"ONSET\"},{\"closedLoopControlName\":\"ControlLoop-vFirewall-d0a1dfc6-94f5-4fd4-a5b5-4630b438850a\",\"version\":\"1.0.2\",\"fieldPath\":\"$.event.measurementsForVfScalingFields.vNicUsageArray[*].receivedTotalPacketsDelta\",\"thresholdValue\":700,\"direction\":\"GREATER_OR_EQUAL\",\"severity\":\"CRITICAL\",\"closedLoopEventStatus\":\"ONSET\"}]},{\"eventName\":\"vLoadBalancer\",\"controlLoopSchemaType\":\"VM\",\"policyScope\":\"DCAE\",\"policyName\":\"DCAE.Config_tca-hi-lo\",\"policyVersion\":\"v0.0.1\",\"thresholds\":[{\"closedLoopControlName\":\"ControlLoop-vDNS-6f37f56d-a87d-4b85-b6a9-cc953cf779b3\",\"version\":\"1.0.2\",\"fieldPath\":\"$.event.measurementsForVfScalingFields.vNicUsageArray[*].receivedTotalPacketsDelta\",\"thresholdValue\":300,\"direction\":\"GREATER_OR_EQUAL\",\"severity\":\"CRITICAL\",\"closedLoopEventStatus\":\"ONSET\"}]},{\"eventName\":\"Measurement_vGMUX\",\"controlLoopSchemaType\":\"VNF\",\"policyScope\":\"DCAE\",\"policyName\":\"DCAE.Config_tca-hi-lo\",\"policyVersion\":\"v0.0.1\",\"thresholds\":[{\"closedLoopControlName\":\"ControlLoop-vCPE-48f0c2c3-a172-4192-9ae3-052274181b6e\",\"version\":\"1.0.2\",\"fieldPath\":\"$.event.measurementsForVfScalingFields.additionalMeasurements[*].arrayOfFields[0].value\",\"thresholdValue\":0,\"direction\":\"EQUAL\",\"severity\":\"MAJOR\",\"closedLoopEventStatus\":\"ABATED\"},{\"closedLoopControlName\":\"ControlLoop-vCPE-48f0c2c3-a172-4192-9ae3-052274181b6e\",\"version\":\"1.0.2\",\"fieldPath\":\"$.event.measurementsForVfScalingFields.additionalMeasurements[*].arrayOfFields[0].value\",\"thresholdValue\":0,\"direction\":\"GREATER\",\"severity\":\"CRITICAL\",\"closedLoopEventStatus\":\"ONSET\"}]}]}'\n        service_component_type: dcaegen2-analytics_tca    \n        docker_config:\n            healthcheck:\n               endpoint: /\n               interval: 15s\n               timeout: 1s\n               type: http\n        image:\n            get_input: tag_version   \n        service_component_name_override: \n            get_input: scn_name            \n    interfaces:\n      cloudify.interfaces.lifecycle:\n        start:\n          inputs:\n            envs:\n                DMAAPHOST: \n                    { get_input: dmaap_host }\n                DMAAPPORT:\n                    { get_input: dmaap_port }\n                DMAAPPUBTOPIC: \"unauthenticated.DCAE_CL_OUTPUT\"\n                DMAAPSUBTOPIC: \"unauthenticated.SEC_MEASUREMENT_OUTPUT\"\n                AAIHOST: \n                    { get_input: aaiEnrichmentHost }\n                AAIPORT: \n                    { get_input: aaiEnrichmentPort }\n                CONSUL_HOST: \n                    { get_input: consul_host }\n                CONSUL_PORT: \n                    { get_input: consul_port }\n                CBS_HOST: \n                    { get_input: cbs_host }\n                CBS_PORT: \n                    { get_input: cbs_port }\n                CONFIG_BINDING_SERVICE: \"config_binding_service\"                \n                SERVICE_11011_NAME: \n                    { get_input: scn_name }\n                SERVICE_11015_IGNORE: \"true\"                \n            ports:\n              - concat: [\"11011:\", { get_input: external_port }]        \n        stop:\n          inputs:\n            cleanup_image: true              \n  tca_policy:\n    type: dcae.nodes.policy\n    properties:\n      policy_id:\n           get_input: policy_id\n",
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
            });
        });
        return res;
    }

};

const Cloudify = {
    resp_status: function() {
        return {
            "status": "running",
            "services": [
                {
                    "instances": [
                        {
                            "LoadState": "loaded",
                            "Description": "Cloudify Composer Service",
                            "state": "running",
                            "MainPID": 25094,
                            "Id": "cloudify-composer.service",
                            "ActiveState": "active",
                            "SubState": "running"
                        }
                    ],
                    "display_name": "Cloudify Composer",
                    "unit_id": "cloudify-composer.service"
                },
                {
                    "instances": [
                        {
                            "LoadState": "loaded",
                            "Description": "LSB: Starts Logstash as a daemon.",
                            "state": "running",
                            "MainPID": 0,
                            "Id": "logstash.service",
                            "ActiveState": "active",
                            "SubState": "running"
                        }
                    ],
                    "display_name": "Logstash",
                    "unit_id": "logstash.service"
                },
                {
                    "instances": [
                        {
                            "LoadState": "loaded",
                            "Description": "RabbitMQ Service",
                            "state": "running",
                            "MainPID": 93479,
                            "Id": "cloudify-rabbitmq.service",
                            "ActiveState": "active",
                            "SubState": "running"
                        }
                    ],
                    "display_name": "RabbitMQ",
                    "unit_id": "cloudify-rabbitmq.service"
                },
                {
                    "instances": [
                        {
                            "LoadState": "loaded",
                            "Description": "PostgreSQL 9.5 database server",
                            "state": "running",
                            "MainPID": 70688,
                            "Id": "cloudify-postgresql.service",
                            "ActiveState": "active",
                            "SubState": "running"
                        }
                    ],
                    "display_name": "PostgreSQL",
                    "unit_id": "cloudify-postgresql.service"
                },
                {
                    "instances": [
                        {
                            "LoadState": "loaded",
                            "Description": "nginx - high performance web server",
                            "state": "running",
                            "MainPID": 114673,
                            "Id": "nginx.service",
                            "ActiveState": "active",
                            "SubState": "running"
                        }
                    ],
                    "display_name": "Webserver",
                    "unit_id": "nginx.service"
                },
                {
                    "instances": [
                        {
                            "LoadState": "loaded",
                            "Description": "Cloudify Management Worker Service",
                            "state": "running",
                            "MainPID": 93818,
                            "Id": "cloudify-mgmtworker.service",
                            "ActiveState": "active",
                            "SubState": "running"
                        }
                    ],
                    "display_name": "Management Worker",
                    "unit_id": "cloudify-mgmtworker.service"
                },
                {
                    "instances": [
                        {
                            "LoadState": "loaded",
                            "Description": "syncthing",
                            "state": "running",
                            "MainPID": 102764,
                            "Id": "cloudify-syncthing.service",
                            "ActiveState": "active",
                            "SubState": "running"
                        }
                    ],
                    "display_name": "Syncthing",
                    "unit_id": "cloudify-syncthing.service"
                },
                {
                    "instances": [
                        {
                            "LoadState": "loaded",
                            "Description": "Cloudify Console Service",
                            "state": "running",
                            "MainPID": 25085,
                            "Id": "cloudify-stage.service",
                            "ActiveState": "active",
                            "SubState": "running"
                        }
                    ],
                    "display_name": "Cloudify Console",
                    "unit_id": "cloudify-stage.service"
                },
                {
                    "instances": [
                        {
                            "LoadState": "loaded",
                            "Description": "Cloudify REST Service",
                            "state": "running",
                            "MainPID": 93233,
                            "Id": "cloudify-restservice.service",
                            "ActiveState": "active",
                            "SubState": "running"
                        }
                    ],
                    "display_name": "Manager Rest-Service",
                    "unit_id": "cloudify-restservice.service"
                },
                {
                    "instances": [
                        {
                            "LoadState": "loaded",
                            "Description": "consul",
                            "state": "running",
                            "MainPID": 24394,
                            "Id": "cloudify-consul.service",
                            "ActiveState": "active",
                            "SubState": "running"
                        }
                    ],
                    "display_name": "Consul",
                    "unit_id": "cloudify-consul.service"
                }
            ]
        }
    }
};

function test_service_health(dh_server) {
    const req_path = "/servicehealth";
    const test_txt = "GET " + req_path;
    describe(test_txt, () => {
        it('GET all the dcae-service-types from inventory', function() {
            const action_timer = new utils.ActionTimer();
            console.log(action_timer.step, test_txt);

            //const inv_resp = Inventory.resp_service_types();
            nock(dh.INVENTORY_URL).get(INV_SERVICE_HEALTH)
                .reply(200, function(uri) {
                    console.log(action_timer.step, "get", dh.INVENTORY_URL, uri);
                    return JSON.stringify(Inventory.resp_service_types());
                });

            nock(dh.CLOUDIFY_URL).get(dh.CLOUDIFY_API + "/status")
                .reply(200, function(uri) {
                    console.log(action_timer.step, "get", dh.CLOUDIFY_URL, uri);
                    return JSON.stringify(Cloudify.resp_status());
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



dh.add_tests([test_service_health]);
