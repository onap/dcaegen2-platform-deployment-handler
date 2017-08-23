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

"use strict";

/*
 *   Extend the standard Error type by appending fields to capture more information at the 
 *   point of detection.  The error information guides dispatcher's response to the incoming HTTP request
 *   that triggered the error and helps make the error log more specific and meaningful.
 *   This type of Error typically reports on problems encountered when attempting to use a downstream API.  
 *   
 *   The standard Error has two fields:
 *     - name: the name of the Error, which is 'Error'
 *     - message: a text description of the error
 *     
 *   For dispatcher purposes, we add:
 *     - status: the HTTP status code that dispatcher should use in its response
 *     - type: "system" or "api" depending on whether the error was the result of a failed system call or
 *           an error reported by the downstream API.
 *     - logCode: the error code to use in the log entry.
 *     - target: the downstream system dispatcher was attempting to interact with
 *           
 *   Note that we're not defining a new class, just adding fields to the existing Error type.  This pattern is
 *   used in Node for system errors.
 */

/* Create an error given the parameters */
exports.createDispatcherError = function(message, status, type, logCode, target) {
	var e = new Error();
	
	e.message = message || 'no error information';
	e.status = status || 500;
	e.type = type;
	e.logCode = logCode || 900;
	e.target = target || '';
	
	return e;	
};


