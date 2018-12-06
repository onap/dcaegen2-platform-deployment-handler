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

/* Low-level routines for using the Consul REST API */

const KEY = '/v1/kv/';
const SERVICE = '/v1/catalog/service/';
const CONSUL = 'consul';
const CONSUL_URL = process.env.CONSUL_URL || ('http://' + (process.env.CONSUL_HOST || CONSUL) + ':8500');

const doRequest = require('./promise_request').doRequest;

module.exports = {
    /* Fetch (a promise for) the decoded value of a single key from Consul KV store.
        * If the value is a string representation of a JSON object, return as an object.
        * If there is no such key, resolve to null.
        */
    getKey: function(key) {
        return doRequest(null, {method: 'GET', uri: CONSUL_URL + KEY + key + '?raw'}, null, CONSUL)
            .then(function(res) {
                return res.json || res.body;
            })
            .catch(function(err) {
                if (err.status === 404) {
                    /* Key wasn't found */
                    return null;
                }
                else {
                    /* Some other error, rethrow it */
                    throw err;
                }
            });
    },

    /* Retrieve (a promise for) address:port information for a named service from the Consul service catalog.
        * If the service has tag(s), return the first one.  (Should be the full URL of the service if it exists.
        * Since a service can be registered at multiple nodes, the result is an array.
        * If the service is not found, returns a zero-length array.
        */
    getService: function(serviceId) {
        return doRequest(null, {method: 'GET', uri: CONSUL_URL + SERVICE + serviceId}, null, CONSUL)
            .then(function(res){
                return res.json.map(function(r) {
                    /* Address for external service is in r.Address with r.ServiceAddress empty */
                    return {address: r.ServiceAddress || r.Address, port: r.ServicePort, url: r.ServiceTags ? r.ServiceTags[0] : ""};
                });
            });
    }
};
