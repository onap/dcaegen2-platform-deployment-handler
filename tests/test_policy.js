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

const nock = require('nock')
    , chai = require('chai')
    , chaiHttp = require('chai-http')
    , expect = chai.expect
    , assert = chai.assert;

chai.use(chaiHttp);

const dh = require('./mock_deployment_handler');
const utils = require('./mock_utils');

const RUN_TS = new Date();

const POLICY_ID = 'policy_id';
const POLICY_VERSION = "policyVersion";
const POLICY_NAME = "policyName";
const POLICY_BODY = 'policy_body';
const POLICY_CONFIG = 'config';

const BLUEPRINT_ID = "demo_dcaepolicy";
const DEPLOYMENT_ID = "demo_dcae_policy_depl";
const OPERATION_POLICY_UPDATE = "dcae.interfaces.policy.policy_update";
const EXECUTE_OPERATION = "execute_operation";

const MONKEYED_POLICY_ID = "DCAE_alex.Config_peach";
const MONKEYED_POLICY_ID_2 = "DCAE_alex.Config_peach_2";
const MONKEYED_POLICY_ID_3 = "DCAE_alex.Config_peach_3";
const MONKEYED_POLICY_ID_4 = "DCAE_alex.Config_peach_4";
const MONKEYED_POLICY_ID_5 = "DCAE_alex.Config_peach_5";
const MONKEYED_POLICY_ID_6 = "DCAE_alex.Config_peach_6";
const CLAMP_POLICY_ID = "CLAMP.Config_clamp_policy";

const CFY_API = "/api/v2.1";
const CFY_API_NODE_INSTANCES = CFY_API + "/node-instances";
const CFY_API_EXECUTIONS = CFY_API + "/executions";
const CFY_API_EXECUTION = CFY_API_EXECUTIONS + "/";

function create_policy_body(policy_id, policy_version=1, matching_conditions=null) {
    const this_ver = policy_version.toString();

    const matchingConditions = {
        "ONAPName": "DCAE",
        "ConfigName": "alex_config_name"
    };
    if (matching_conditions) {
        Object.assign(matchingConditions, matching_conditions);
    }
    return {
        "policyConfigMessage": "Config Retrieved! ",
        "policyConfigStatus": "CONFIG_RETRIEVED",
        "type": "JSON",
        [POLICY_NAME]: (policy_id && (policy_id + "." + this_ver + ".xml") || null),
        [POLICY_VERSION]: this_ver,
        [POLICY_CONFIG]: {"policy_hello": "world!"},
        "matchingConditions": matchingConditions,
        "responseAttributes": {},
        "property": null
    };
}

function create_policy(policy_id, policy_version=1, matching_conditions=null) {
    return {
        [POLICY_ID] : policy_id,
        [POLICY_BODY] : create_policy_body(policy_id, policy_version, matching_conditions)
    };
}

const message_catch_up = {
    "errored_scopes": [],
    "catch_up": true,
    "scope_prefixes": ["DCAE_alex.Config_", "DCAE.Config_"],
    "errored_policies": {},
    "latest_policies": {}
};

const cloudify_node_instances = [
    {
        "deployment_id": DEPLOYMENT_ID,
        "id": "host_vm_163f7",
        "runtime_properties": {
            "application_config": {
                "policy_hello": "world!",
                "location": "neverland",
                "location_ts": "2017-09-07T16:54:31.696Z"
            },
            [EXECUTE_OPERATION]: "policy_update",
            "service_component_name": "2caa5ccf-bfc6-4a75-aca7-4af03745f478.unknown.unknown.unknown.dcae.onap.org",
            "exe_task": "node_configure",
            "policies": {
                [MONKEYED_POLICY_ID]: {
                    "policy_required": true,
                    "policy_persistent": true,
                    "policy_body": create_policy_body(MONKEYED_POLICY_ID, 55),
                    "policy_id": MONKEYED_POLICY_ID
                },
                [MONKEYED_POLICY_ID_2]: {
                    "policy_persistent": false,
                    "policy_body": create_policy_body(MONKEYED_POLICY_ID_2, 21, {"key1": "value1"}),
                    "policy_id": MONKEYED_POLICY_ID_2
                },
                [MONKEYED_POLICY_ID_3]: {
                    "policy_persistent": false,
                    "policy_body": create_policy_body(MONKEYED_POLICY_ID_3, 33, {"service": "alex_service"}),
                    "policy_id": MONKEYED_POLICY_ID_3
                },
                [MONKEYED_POLICY_ID_5]: {
                    "policy_persistent": false,
                    "policy_body": create_policy_body(MONKEYED_POLICY_ID_5, 1),
                    "policy_id": MONKEYED_POLICY_ID_5
                },
                [CLAMP_POLICY_ID]: {
                    "policy_persistent": false,
                    "policy_body": create_policy_body(CLAMP_POLICY_ID, 9),
                    "policy_id": CLAMP_POLICY_ID
                }
            },
            "policy_filters": {
                "db_client_policies_c83de": {
                    "policy_filter_id": "db_client_policies_c83de",
                    "policy_filter": {
                        "policyName": MONKEYED_POLICY_ID_2 + ".*",
                        "unique": false,
                        "onapName": "DCAE",
                        "configName": "alex_config_name",
                        "configAttributes": {"key1": "value1"}
                    }
                },
                "db_client_policies_microservice_09f09": {
                    "policy_filter_id": "db_client_policies_microservice_09f09",
                    "policy_filter": {
                        "policyName": MONKEYED_POLICY_ID + ".*",
                        "unique": false,
                        "onapName": "DCAE",
                        "configName": "alex_config_name",
                        "configAttributes": {"service": "alex_service"}
                    }
                },
                "policy_filter_by_id_02d02": {
                    "policy_filter_id": "policy_filter_by_id_02d02",
                    "policy_filter": {
                        "policyName": MONKEYED_POLICY_ID_6
                    }
                },
                "new_policies_09f09": {
                    "policy_filter_id": "new_policies_09f09",
                    "policy_filter": {
                        "policyName": MONKEYED_POLICY_ID_4 + ".*",
                        "unique": false,
                        "onapName": "DCAE",
                        "configName": "alex_config_name",
                        "configAttributes": {"service": "alex_service"}
                    }
                },
                "db_client_policies_not_found_cfed6": {
                    "policy_filter_id": "db_client_policies_not_found_cfed6",
                    "policy_filter": {
                        "configAttributes": {"not-to-be-found": "ever"},
                        "unique": false,
                        "onapName": "DCAE",
                        "policyName": "DCAE_alex.Config_not_found_ever_.*"
                    }
                },
                "filter_without_policy_name_22abcd": {
                    "policy_filter_id": "filter_without_policy_name",
                    "policy_filter": {"onapName": "DCAE"}
                },
                "db_client_policies_no_match_afed8": {
                    "policy_filter_id": "db_client_policies_no_match_afed8",
                    "policy_filter": {
                        "policyName": "DCAE_alex.Config_not_found_ever_.*"
                    }
                }
            }
        }
    },
    {
        "deployment_id": DEPLOYMENT_ID,
        "id": "no_policies_on_node_1212beef",
        "runtime_properties": {"application_config": {}}
    },
    {
        "deployment_id": DEPLOYMENT_ID,
        "id": "no_policy_filters_on_node_55ham",
        "runtime_properties": {
            "application_config": {},
            "policies": {}
        }
    }
];

function nock_cfy_node_instances(action_timer) {
    nock(dh.CLOUDIFY_URL).get(CFY_API_NODE_INSTANCES).query(true)
        .reply(200, function(uri) {
            console.log(action_timer.step, "get", dh.CLOUDIFY_URL, uri);
            return JSON.stringify({
                "items": cloudify_node_instances,
                "metadata": {"pagination": {"total": cloudify_node_instances.length, "offset": 0, "size": 10000}}
            });
        });
}

function test_get_policy_components(dh_server) {
    const req_path = "/policy/components";
    const test_txt = "GET " + req_path;
    describe(test_txt, () => {
        it('GET all the components with policy from cloudify', function() {
            const action_timer = new utils.ActionTimer();
            console.log(action_timer.step, test_txt);
            nock_cfy_node_instances(action_timer);

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

function test_put_policy_catch_up(dh_server) {
    const req_path = "/policy";
    const message = JSON.parse(JSON.stringify(message_catch_up));
    message.errored_scopes = ["CLAMP.Config_"];
    message.latest_policies = {
        [MONKEYED_POLICY_ID]: create_policy(MONKEYED_POLICY_ID, 55),
        [MONKEYED_POLICY_ID_2]: create_policy(MONKEYED_POLICY_ID_2, 22, {"key1": "value1"}),
        [MONKEYED_POLICY_ID_4]: create_policy(MONKEYED_POLICY_ID_4, 77, {"service": "alex_service"}),
        [MONKEYED_POLICY_ID_5]: create_policy(MONKEYED_POLICY_ID_5, "nan_version"),
        [MONKEYED_POLICY_ID_6]: create_policy(MONKEYED_POLICY_ID_6, 66),
        "junk_policy": create_policy("junk_policy", "nan_version"),
        "fail_filtered": create_policy("fail_filtered", 12, {"ONAPName": "not-match"}),
        "fail_filtered_2": create_policy("fail_filtered_2", 32, {"ConfigName": "not-match2"}),
        "": create_policy("", 1)
    };
    const test_txt = "put " + req_path + " - catchup " + JSON.stringify(message);
    describe(test_txt, () => {
        it('put policy-update - catchup', function() {
            const action_timer = new utils.ActionTimer();
            console.log(action_timer.step, test_txt);
            const execution_id = "policy_catch_up";
            const resp_to_exe = {"status": "none"};
            nock_cfy_node_instances(action_timer);

            nock(dh.CLOUDIFY_URL).put(CFY_API_EXECUTIONS)
                .reply(201, function(uri, requestBody) {
                    requestBody = JSON.stringify(requestBody);
                    console.log(action_timer.step, "on_put", dh.CLOUDIFY_URL, uri, requestBody);
                    Object.assign(resp_to_exe, JSON.parse(requestBody));
                    resp_to_exe.status = "pending";
                    resp_to_exe.created_at = RUN_TS;
                    resp_to_exe.workflow_id = EXECUTE_OPERATION;
                    resp_to_exe.is_system_workflow = false;
                    resp_to_exe.blueprint_id = BLUEPRINT_ID;
                    resp_to_exe.error = "";
                    resp_to_exe.id = execution_id;
                    resp_to_exe.parameters.run_by_dependency_order = false;
                    resp_to_exe.parameters.operation = OPERATION_POLICY_UPDATE;
                    resp_to_exe.parameters.type_names = [];

                    console.log(action_timer.step, "reply to put", dh.CLOUDIFY_URL, uri, JSON.stringify(resp_to_exe));

                    return JSON.stringify(resp_to_exe);
                });

            nock(dh.CLOUDIFY_URL).get(CFY_API_EXECUTION + execution_id)
                .reply(200, function(uri) {
                    resp_to_exe.status = "pending";
                    console.log(action_timer.step, "get", dh.CLOUDIFY_URL, uri, JSON.stringify(resp_to_exe));
                    return JSON.stringify(resp_to_exe);
                });
            nock(dh.CLOUDIFY_URL).get(CFY_API_EXECUTION + execution_id)
                .times(2)
                .reply(200, function(uri) {
                    resp_to_exe.status = "started";
                    console.log(action_timer.step, "get", dh.CLOUDIFY_URL, uri, JSON.stringify(resp_to_exe));
                    return JSON.stringify(resp_to_exe);
                });
            nock(dh.CLOUDIFY_URL).get(CFY_API_EXECUTION + execution_id)
                .reply(200, function(uri) {
                    resp_to_exe.status = "terminated";
                    console.log(action_timer.step, "get", dh.CLOUDIFY_URL, uri, JSON.stringify(resp_to_exe));
                    return JSON.stringify(resp_to_exe);
                });

            for (var extra_i = 1; extra_i <= 100000; extra_i++) {
                const policy_id = "extra_" + extra_i;
                message.latest_policies[policy_id] = create_policy(policy_id, extra_i);
            }

            return chai.request(dh_server.app).put(req_path)
                .set('content-type', 'application/json')
                .set('X-ECOMP-RequestID', 'test_put_policy_catch_up')
                .send(message)
                .then(function(res) {
                    console.log(action_timer.step, "res for", test_txt, res.text);
                    expect(res).to.have.status(200);
                    expect(res).to.be.json;

                    return utils.sleep(25000);
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

function test_fail_cfy_policy_catch_up(dh_server) {
    const req_path = "/policy";
    const message = JSON.parse(JSON.stringify(message_catch_up));
    message.latest_policies = {
        [MONKEYED_POLICY_ID_6]: create_policy(MONKEYED_POLICY_ID_6, 66)
    };
    const test_txt = "fail put " + req_path + " - catchup without execution_id " + JSON.stringify(message);
    describe(test_txt, () => {
        it('fail put policy-update - catchup without execution_id', function() {
            const action_timer = new utils.ActionTimer();
            console.log(action_timer.step, test_txt);
            const execution_id = "policy_catch_up";
            const resp_to_exe = {"status": "none"};
            nock_cfy_node_instances(action_timer);

            nock(dh.CLOUDIFY_URL).put(CFY_API_EXECUTIONS)
                .reply(201, function(uri, requestBody) {
                    requestBody = JSON.stringify(requestBody);
                    console.log(action_timer.step, "on_put", dh.CLOUDIFY_URL, uri, requestBody);
                    Object.assign(resp_to_exe, JSON.parse(requestBody));
                    resp_to_exe.status = "pending";

                    console.log(action_timer.step, "reply to put", dh.CLOUDIFY_URL, uri, JSON.stringify(resp_to_exe));

                    return JSON.stringify(resp_to_exe);
                });

            return chai.request(dh_server.app).put(req_path)
                .set('content-type', 'application/json')
                .set('X-ECOMP-RequestID', 'test_put_policy_catch_up')
                .send(message)
                .then(function(res) {
                    console.log(action_timer.step, "res for", test_txt, res.text);
                    expect(res).to.have.status(200);
                    expect(res).to.be.json;

                    return utils.sleep(1000);
                })
                .then(function() {
                    console.log(action_timer.step, "the end of test");
                })
                .catch(function(err) {
                    console.error(action_timer.step, "err for", test_txt, err);
                    throw err;
                });
        }).timeout(30000);
    });
}

function test_fail_400_cfy_policy_catch_up(dh_server) {
    const req_path = "/policy";
    const message = JSON.parse(JSON.stringify(message_catch_up));
    message.latest_policies = {
        [MONKEYED_POLICY_ID_6]: create_policy(MONKEYED_POLICY_ID_6, 66)
    };
    const test_txt = "fail 400 put " + req_path + " - existing_running_execution_error " + JSON.stringify(message);
    describe(test_txt, () => {
        it('fail 400 put policy-update - existing_running_execution_error', function() {
            const action_timer = new utils.ActionTimer();
            console.log(action_timer.step, test_txt);
            const execution_id = "policy_catch_up";
            const resp_to_exe = {"error_code": "existing_running_execution_error"};
            nock_cfy_node_instances(action_timer);

            nock(dh.CLOUDIFY_URL).put(CFY_API_EXECUTIONS).times(5)
                .reply(400, function(uri, requestBody) {
                    console.log(action_timer.step, "on_put", dh.CLOUDIFY_URL, uri, JSON.stringify(requestBody));
                    console.log(action_timer.step, "reply to put", dh.CLOUDIFY_URL, uri, JSON.stringify(resp_to_exe));
                    return JSON.stringify(resp_to_exe);
                });

            return chai.request(dh_server.app).put(req_path)
                .set('content-type', 'application/json')
                .set('X-ECOMP-RequestID', 'test_put_policy_catch_up')
                .send(message)
                .then(function(res) {
                    console.log(action_timer.step, "res for", test_txt, res.text);
                    expect(res).to.have.status(200);
                    expect(res).to.be.json;

                    return utils.sleep(25000);
                })
                .then(function() {
                    console.log(action_timer.step, "the end of test");
                })
                .catch(function(err) {
                    console.error(action_timer.step, "err for", test_txt, err);
                    throw err;
                });
        }).timeout(30000);
    });
}

function test_fail_404_cfy_policy_catch_up(dh_server) {
    const req_path = "/policy";
    const message = JSON.parse(JSON.stringify(message_catch_up));
    message.latest_policies = {
        [MONKEYED_POLICY_ID_6]: create_policy(MONKEYED_POLICY_ID_6, 66)
    };
    const test_txt = "fail 404 put " + req_path + " - not_found_error " + JSON.stringify(message);
    describe(test_txt, () => {
        it('fail 404 put policy-update - not_found_error', function() {
            const action_timer = new utils.ActionTimer();
            console.log(action_timer.step, test_txt);
            const execution_id = "policy_catch_up";
            const resp_to_exe = {"error_code": "not_found_error"};
            nock_cfy_node_instances(action_timer);

            nock(dh.CLOUDIFY_URL).put(CFY_API_EXECUTIONS).times(5)
                .reply(404, function(uri, requestBody) {
                    console.log(action_timer.step, "on_put", dh.CLOUDIFY_URL, uri, JSON.stringify(requestBody));
                    console.log(action_timer.step, "reply to put", dh.CLOUDIFY_URL, uri, JSON.stringify(resp_to_exe));
                    return JSON.stringify(resp_to_exe);
                });

            return chai.request(dh_server.app).put(req_path)
                .set('content-type', 'application/json')
                .set('X-ECOMP-RequestID', 'test_put_policy_catch_up')
                .send(message)
                .then(function(res) {
                    console.log(action_timer.step, "res for", test_txt, res.text);
                    expect(res).to.have.status(200);
                    expect(res).to.be.json;

                    return utils.sleep(1000);
                })
                .then(function() {
                    console.log(action_timer.step, "the end of test");
                })
                .catch(function(err) {
                    console.error(action_timer.step, "err for", test_txt, err);
                    throw err;
                });
        }).timeout(30000);
    });
}

dh.add_tests([
    test_get_policy_components,
    test_put_policy_catch_up,
    test_fail_cfy_policy_catch_up,
    test_fail_400_cfy_policy_catch_up,
    test_fail_404_cfy_policy_catch_up
]);
