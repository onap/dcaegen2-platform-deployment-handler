/*
Copyright(c) 2017-2020 AT&T Intellectual Property. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.

You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and limitations under the License.
*/

"use strict";

const uuid = require('uuid');

// Utility functions

/* Does object 'o' have property 'key' */
exports.hasProperty = function(o, key) {
	return key.split('.').every(function(e){
		if (typeof(o) === 'object' && o !== null && (e in o) &&  (typeof o[e] !== 'undefined')) {
			o = o[e];
			return true;
		}
		else {
			return false;
		}
	});
};

/* Generate a random ID string */
exports.generateId = function() {
	return uuid.v4();
};

const hide_fields = ["passphrase", "pfx"];
exports.hideSecrets = function(key, value) {
	return (key && hide_fields.includes(key) && "*") || value;
};
