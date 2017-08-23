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

/* HTTP Basic Authentication  */

"use strict";

/* Extract user name and password from the 'Authorization' header */
const parseAuthHeader = function(authHeader){
	
	var parsedHeader = {};
	
	const authItems = authHeader.split(/\s+/);		// Split on the white space between Basic and the base64 encoded user:password

	if (authItems[0].toLowerCase() === 'basic') {
		if (authItems[1]) {
			const authString = (new Buffer(authItems[1], 'base64')).toString();
			const userpass = authString.split(':');
			if (userpass.length > 1) {
				parsedHeader = {user: userpass[0], password: userpass[1]};
			}
		}
	}
	return parsedHeader;
};

/* Middleware function to check authentication */
exports.checkAuth = function(req, res, next) {
	const auth = process.mainModule.exports.config.auth;
	if (auth) {
		/* Authentication is configured */
		if (req.headers.authorization) {
			const creds = parseAuthHeader(req.headers.authorization);
			if (creds.user && creds.password && (creds.user in auth) && (auth[creds.user] === creds.password)) {
				next();
			}
			else {
				var err = new Error('Authentication required');
				err.status = 403;
				next(err);
			}
		}
		else {
			var errx = new Error ('Authentication required');
			errx.status = 403;
			next(errx);
		}
	}
	else {
		next();		// Nothing to do, no authentication required
	}
};