/*
Copyright(c) 2017 AT&T Intellectual Property. All rights reserved. 

Licensed under the Apache License, Version 2.0 (the "License"); 
you may not use this file except in compliance with the License.

You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, 
software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. 
See the License for the specific language governing permissions and limitations under the License.
*/

/* Handle the / API that provides API information */

"use strict";

const router = require('express').Router();

/* Pick up config exported by main */
const config = process.mainModule.exports.config;

/* Accept an incoming event */
router.get('/', function(req, res) {
	res.json(
		{
			apiVersion: config.apiVersion,
			serverVersion: config.version,
			links: config.apiLinks
		}
	);
	require('./logging').getLogger().audit(req, 200);
});

module.exports = router;