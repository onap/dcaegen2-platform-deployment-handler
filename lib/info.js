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

/* Handle the / API that provides API information */

"use strict";

const router = require('express').Router();
const logger = require('./logging').getLogger();

/* Accept an incoming event */
router.get('/', function(req, res) {
	/* Pick up config exported by main */
	const config = process.mainModule.exports.config;
	const info = {
		"server" : {
			"name": config.name,
			"description": config.description,
			"version": config.version,
			"branch": config.branch,
			"commit": config.commit,
			"commit_datetime": config.commit_datetime,
			"server_instance_uuid": config.server_instance_uuid
		},
		"apiVersion": config.apiVersion,
		"links": config.apiLinks
	};
	res.json(info);
	logger.audit(req, 200, JSON.stringify(info));
});

module.exports = router;
