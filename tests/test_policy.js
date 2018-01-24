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

const RUN_TS = new Date();
const RUN_TS_HOURS = RUN_TS.getHours();

const POLICY_ID = 'policy_id';
const POLICY_VERSION = "policyVersion";
const POLICY_NAME = "policyName";
const POLICY_BODY = 'policy_body';
const POLICY_CONFIG = 'config';

const MONKEYED_POLICY_ID = "DCAE_alex.Config_peach"
const MONKEYED_POLICY_ID_2 = "DCAE_alex.Config_peach_2"

function create_policy_body(policy_id, policy_version=1) {
    const prev_ver = policy_version - 1;
    const timestamp = new Date(RUN_TS.getTime());
    timestamp.setHours(RUN_TS_HOURS + prev_ver);

    const this_ver = policy_version.toString();
    const config = {
        "policy_updated_from_ver": prev_ver.toString(),
        "policy_updated_to_ver": this_ver.toString(),
        "policy_hello": "world!",
        "policy_updated_ts": timestamp,
        "updated_policy_id": policy_id
    };
    return {
        "policyConfigMessage": "Config Retrieved! ",
        "policyConfigStatus": "CONFIG_RETRIEVED",
        "type": "JSON",
        POLICY_NAME: policy_id + "." + this_ver + ".xml",
        POLICY_VERSION: this_ver,
        POLICY_CONFIG: config,
        "matchingConditions": {
            "ONAPName": "DCAE",
            "ConfigName": "alex_config_name"
        },
        "responseAttributes": {},
        "property": null
    };
}

function create_policy(policy_id, policy_version=1) {
    return {
        POLICY_ID : policy_id,
        POLICY_BODY : MonkeyedPolicyBody.create_policy_body(policy_id, policy_version)
    };
}

nock(dh.CLOUDIFY_URL).persist().get(/[/]api[/]v2[.]1[/]node-instances/)
    .reply(200, {
        "items": [
            {
                "deployment_id": "demo_dcae_policy_depl",
                "id": "host_vm_163f7",
                "runtime_properties": {
                    "application_config": {
                        "capacity_ts": "2017-09-07T16:54:31.696Z",
                        "capacity": "123",
                        "policy_hello": "world!",
                        "policy_updated_ts": "2017-09-05T18:09:54.109548Z",
                        "policy_updated_from_ver": "20",
                        "location": "neverland",
                        "updated_policy_id": MONKEYED_POLICY_ID_2,
                        "policy_updated_to_ver": "21",
                        "location_ts": "2017-09-07T16:54:31.696Z"
                    },
                    "execute_operation": "policy_update",
                    "service_component_name": "2caa5ccf-bfc6-4a75-aca7-4af03745f478.unknown.unknown.unknown.dcae.onap.org",
                    "exe_task": "node_configure",
                    "policies": {
                        "DCAE_alex.Config_host_location_policy_id_value": {
                            "policy_required": true,
                            "policy_body": create_policy_body(MONKEYED_POLICY_ID, 55),
                            "policy_id": MONKEYED_POLICY_ID
                        },
                        "DCAE_alex.Config_host_capacity_policy_id_value": {
                            "policy_required": true,
                            "policy_body": create_policy_body(MONKEYED_POLICY_ID_2, 21),
                            "policy_id": MONKEYED_POLICY_ID_2
                        }
                    }
                }
            }
        ],
        "metadata": {
            "pagination": {
                "total": 1,
                "offset": 0,
                "size": 10000
            }
        }
    }
);

function test_get_policy_components(dh_server) {
    const req_path = "/policy/components";
    const test_txt = "GET " + req_path;
    describe(test_txt, () => {
        console.log(test_txt);
        it('GET all the components with policy from cloudify', function() {
            return chai.request(dh_server.app).get(req_path)
                .then(function(res) {
                    console.log("res for", test_txt, res.text);
                    expect(res).to.have.status(200);
                    expect(res).to.be.json;
                })
                .catch(function(err) {
                    console.error("err for", test_txt, err);
                    throw err;
                });
        });
    });
}

dh.add_tests([test_get_policy_components]);
