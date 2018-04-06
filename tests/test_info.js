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

const chai = require('chai')
    , chaiHttp = require('chai-http')
    , expect = chai.expect
    , assert = chai.assert;

chai.use(chaiHttp);

const dh = require('./mock_deployment_handler');
const utils = require('./mock_utils');

function test_get_info(dh_server) {
    const req_path = "/";
    const test_txt = "GET " + req_path;
    describe(test_txt, () => {
        it('GET info', function() {
            const action_timer = new utils.ActionTimer();
            console.log(action_timer.step, test_txt);
            return chai.request(dh_server.app).get(req_path)
                .then(function(res) {
                    console.log(action_timer.step, "res for", test_txt, res.text);
                    expect(res).to.have.status(200);
                    expect(res).to.be.json;

                    const info = res.body;
                    const config = process.mainModule.exports.config;
                    assert.include(config, info.server);
                    assert.deepEqual(config.apiLinks, info.links);
                })
                .catch(function(err) {
                    console.error(action_timer.step, "err for", test_txt, err);
                    throw err;
                });
        });
    });
}

dh.add_tests([test_get_info]);
