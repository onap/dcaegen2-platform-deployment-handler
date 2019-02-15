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
 * mock-deployment_handler - base server for all other tests
 */

"use strict";

const nock = require('nock');
const utils = require('./mock_utils');

const MAIN_PATH = './../';
const LOG_PATH = './log/';

const CONSUL_URL = 'http://consul:8500';
const MOCK_CLOUDIFY_MANAGER = "mock_cloudify_manager";
const CLOUDIFY_URL = "http://" + MOCK_CLOUDIFY_MANAGER + ":80";
//const CLOUDIFY_API = "/api/v2.1";
const CLOUDIFY_API = "/api/v3.1";

const MOCK_INVENTORY = "mock_inventory";
const INVENTORY_URL = "https://" + MOCK_INVENTORY + ":8080";

nock(CONSUL_URL).persist().get('/v1/kv/deployment_handler?raw')
    .reply(200, {"logLevel": "DEBUG", "cloudify": {"protocol": "http"}});

nock(CONSUL_URL).persist().get('/v1/catalog/service/cloudify_manager')
    .reply(200, [{
        "ID":"deadbeef-dead-beef-dead-beefdeadbeef",
        "Node":"devorcl00",
        "Address": MOCK_CLOUDIFY_MANAGER,
        "Datacenter":"rework-central",
        "TaggedAddresses":{"lan": MOCK_CLOUDIFY_MANAGER,"wan": MOCK_CLOUDIFY_MANAGER},
        "NodeMeta":{},
        "ServiceID":"cloudify_manager",
        "ServiceName":"cloudify_manager",
        "ServiceTags":["http://" + MOCK_CLOUDIFY_MANAGER + CLOUDIFY_API],
        "ServiceAddress": MOCK_CLOUDIFY_MANAGER,
        "ServicePort":80,
        "ServiceEnableTagOverride":false,
        "CreateIndex":16,
        "ModifyIndex":16
    }]);

nock(CONSUL_URL).persist().get('/v1/catalog/service/inventory')
    .reply(200, [{
        "ID": "",
        "Node": "inventory_mock_node",
        "Address": MOCK_INVENTORY,
        "Datacenter": "rework-central",
        "TaggedAddresses": null,
        "NodeMeta": null,
        "ServiceID": "inventory",
        "ServiceName": "inventory",
        "ServiceTags": [],
        "ServiceAddress": "",
        "ServicePort": 8080,
        "ServiceEnableTagOverride": false,
        "CreateIndex": 8068,
        "ModifyIndex": 8068
    }]);

const tests = [];

const run_dh = function() {
    describe('run deployment-handler', () => {
        it('starting deployment-handler server', function() {
            console.log("starting deployment-handler server");
            const dh_server = require(MAIN_PATH + 'deployment-handler');

            return utils.sleep(5000).then(function() {
                console.log("starting tests: count =", tests.length);
                if (Array.isArray(tests)) {
                    tests.forEach(test => {
                        test(dh_server);
                    });
                }
            })
            .catch(function(e) {
                const error = "test of deployment-handler exiting due to test problem: " + e.message
                            + " " + (e.stack || "").replace(/\n/g, " ");
                console.error(error);
                throw e;
            });
        }).timeout(10000);
    });
};

module.exports.INVENTORY_URL = INVENTORY_URL;
module.exports.CLOUDIFY_URL = CLOUDIFY_URL;
module.exports.CLOUDIFY_API = CLOUDIFY_API;
module.exports.LOG_PATH = LOG_PATH;
module.exports.add_tests = function(new_tests) {Array.prototype.push.apply(tests, new_tests);};
module.exports.run_dh = run_dh;
